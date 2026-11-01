import { useEffect, useRef, useState } from 'react'

import { parseAtlasError } from '../api/errors.ts'
import { api } from '../api.ts'
import { toast } from '../components/ui/toast.ts'
import { t } from '../i18n/index.ts'
import { runtimeFilePreview } from '../lib/runtimeFileLink.ts'

type Source = {
  teamId: string
  sessionId: string
  runtimeId: string
  label: string
  /** The open file was read from this computer rather than the agent's workspace. */
  local?: boolean
}
type Directory = { entries: { name: string; kind: 'directory' | 'file' }[]; truncated: boolean }
type Transfer = Awaited<ReturnType<typeof api.atlasTransferRuntimeFile>>
type MediaKind = 'image' | 'video' | 'audio' | 'pdf'
type Result = {
  source: Source | null
  directory: Directory | null
  preview: ReturnType<typeof runtimeFilePreview>
  loading: boolean
  /** Played or rendered from the transfer store; saved from there too. */
  media?: { kind: MediaKind; url: string; transfer: Transfer }
  /** Over the inline limit and not media: offered as a download instead. */
  tooLarge?: boolean
  /** Over the transfer store's limit as well: nothing to offer. */
  overLimit?: boolean
}

const MEDIA: [MediaKind, RegExp][] = [
  ['image', /\.(png|jpe?g|gif|webp|bmp|svg)$/i],
  ['video', /\.(mp4|mov|m4v|webm)$/i],
  ['audio', /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i],
  ['pdf', /\.pdf$/i],
]
const mediaKind = (name: string) => MEDIA.find(([, pattern]) => pattern.test(name))?.[0]
const tooLargeError = (error: unknown) => parseAtlasError(error).code === 'file_too_large'

// The inline read caps at 512 KiB, so media goes through the transfer store:
// the runtime uploads it once, and it plays (with seeking) from a presigned
// URL. A PDF is fetched whole, since the viewer needs its type.
async function transferMedia(target: Source, path: string, kind: MediaKind, linkedPath: string) {
  const transfer = await (
    path === linkedPath ? api.atlasTransferLinkedFile : api.atlasTransferRuntimeFile
  )(target.teamId, target.runtimeId, target.sessionId, path)
  const url =
    kind === 'pdf'
      ? URL.createObjectURL(
          new Blob([await (await fetch(transfer.url)).arrayBuffer()], { type: 'application/pdf' }),
        )
      : transfer.url

  return { kind, url, transfer }
}

// The file a chat link named may be on this computer or the agent's, and the
// pane says which: a local copy can differ from the agent's. Anything browsed
// from there on is the agent's workspace.
async function readFile(target: Source, path: string, linkedPath: string) {
  const args = [target.teamId, target.runtimeId, target.sessionId, path] as const

  if (path !== linkedPath) return { file: await api.atlasReadRuntimeFile(...args), shown: target }
  const file = await api.atlasReadLinkedFile(...args)

  return {
    file,
    shown:
      file.origin === 'this-computer'
        ? { ...target, label: t('This computer'), local: true }
        : target,
  }
}

export function useRuntimeFiles(
  teamId: string,
  conversationId: string | null | undefined,
  isActive: boolean,
  refreshKey: number,
  filePath = '/workspace/',
) {
  const source = useRef<Source | null>(null)
  const slash = filePath.lastIndexOf('/')
  const [path, setPath] = useState(filePath.slice(0, slash))
  const [fileName, setFileName] = useState(filePath.slice(slash + 1))
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Result>({
    source: null,
    directory: null,
    preview: null,
    loading: true,
  })

  useEffect(() => {
    if (!isActive || (!source.current && !conversationId)) return
    let cancelled = false
    // A PDF is held as a blob URL; let it go with the preview.
    let blob: string | undefined

    async function load() {
      setResult({ source: source.current, directory: null, preview: null, loading: true })
      try {
        if (!source.current && conversationId) {
          const conversation = await api.agentGetConversation(conversationId, teamId, { tail: 1 })

          if (cancelled) return
          if (!conversation.runtimeId) {
            toast.error(
              t('No runtime selected'),
              t('Select a runtime for this agent, then refresh Files.'),
            )
            setResult({ source: null, directory: null, preview: null, loading: false })

            return
          }
          source.current = {
            teamId,
            sessionId: conversationId,
            runtimeId: conversation.runtimeId,
            label: conversation.runtimeLabel || 'Runtime',
          }
        }
        const target = source.current

        if (!target) return
        // Exactly one request owns the visible pane. Refresh reloads that same target.
        if (fileName) {
          const kind = mediaKind(fileName)
          // Images small enough still come inline; other media always streams.
          const inline =
            kind && kind !== 'image'
              ? null
              : await readFile(target, `${path}/${fileName}`, filePath).catch((error: unknown) => {
                  if (kind && tooLargeError(error)) return null
                  throw error
                })

          if (cancelled) return
          if (inline) {
            const preview = runtimeFilePreview(inline.file)

            if (!preview)
              toast.error(t('Preview unavailable'), t('This file format cannot be previewed.'))
            setResult({ source: inline.shown, directory: null, preview, loading: false })
          } else if (kind) {
            const media = await transferMedia(target, `${path}/${fileName}`, kind, filePath)

            // The load owns a PDF's blob URL; one that lands after cleanup is let go here.
            if (cancelled) {
              if (kind === 'pdf') URL.revokeObjectURL(media.url)

              return
            }
            if (kind === 'pdf') blob = media.url
            const shown =
              'origin' in media.transfer && media.transfer.origin === 'this-computer'
                ? { ...target, label: t('This computer'), local: true }
                : target

            setResult({ source: shown, directory: null, preview: null, loading: false, media })
          }
        } else {
          const directory = await api.atlasListRuntimeFiles(
            target.teamId,
            target.runtimeId,
            target.sessionId,
            path,
          )

          if (!cancelled) setResult({ source: target, directory, preview: null, loading: false })
        }
      } catch (error) {
        if (cancelled) return
        const tooLarge = tooLargeError(error)
        const details = parseAtlasError(error).details
        const local =
          details &&
          typeof details === 'object' &&
          'origin' in details &&
          details.origin === 'this-computer'
        // Media reached the transfer store, which refused it too.
        const overLimit = tooLarge && Boolean(mediaKind(fileName))

        if (!tooLarge) toast.apiError(t('Could not load runtime files'), error)
        setResult({
          source:
            local && source.current
              ? { ...source.current, label: t('This computer'), local: true }
              : source.current,
          directory: null,
          preview: null,
          loading: false,
          tooLarge: tooLarge && !overLimit,
          overLimit,
        })
      }
    }

    void load()

    return () => {
      cancelled = true
      if (blob) URL.revokeObjectURL(blob)
    }
  }, [teamId, conversationId, isActive, path, fileName, filePath, refreshKey, retry])

  function navigate(nextPath: string) {
    setFileName('')
    setPath(nextPath)
  }

  async function download() {
    const target = result.source

    if (!target) return
    try {
      const file =
        result.media?.transfer ??
        (await (
          filePath === `${path}/${fileName}`
            ? api.atlasTransferLinkedFile
            : api.atlasTransferRuntimeFile
        )(target.teamId, target.runtimeId, target.sessionId, `${path}/${fileName}`))
      const saved = await api.fileTransferDownloadOne({
        teamId: target.teamId,
        groupId: file.groupId,
        fileId: file.fileId,
        fileName: file.fileName,
      })

      if (saved.saved && saved.path) {
        const savedPath = saved.path

        toast.success(t('Saved'), file.fileName, {
          action: {
            label: t('Open in folder'),
            onClick: () => void api.fileTransferRevealInFolder(savedPath),
          },
        })
      }
    } catch (error) {
      toast.apiError(t('Download failed'), error)
    }
  }

  async function openInBrowser() {
    const target = result.source

    if (!target) return
    try {
      await api.atlasOpenHtmlFile(
        Boolean(target.local),
        target.teamId,
        target.runtimeId,
        target.sessionId,
        `${path}/${fileName}`,
      )
    } catch (error) {
      toast.apiError(t('Could not open in browser'), error)
    }
  }

  return {
    ...result,
    path,
    fileName,
    download,
    openInBrowser,
    navigate,
    openFile: setFileName,
    refresh: () => setRetry((value) => value + 1),
  }
}
