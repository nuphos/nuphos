import { useEffect, useRef, useState } from 'react'

import { api } from '../api.ts'
import { toast } from '../components/ui/toast.ts'
import { runtimeFilePreview } from '../lib/runtimeFileLink.ts'

type Source = { teamId: string; sessionId: string; runtimeId: string; label: string }
type Directory = { entries: { name: string; kind: 'directory' | 'file' }[]; truncated: boolean }
type Result = {
  source: Source | null
  directory: Directory | null
  preview: ReturnType<typeof runtimeFilePreview>
  loading: boolean
}

export function useRuntimeFiles(
  teamId: string,
  conversationId: string | null | undefined,
  isActive: boolean,
  refreshKey: number,
) {
  const source = useRef<Source | null>(null)
  const [path, setPath] = useState('/workspace')
  const [fileName, setFileName] = useState('')
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

    async function load() {
      setResult({ source: source.current, directory: null, preview: null, loading: true })
      try {
        if (!source.current && conversationId) {
          const conversation = await api.agentGetConversation(conversationId, teamId, { tail: 1 })

          if (cancelled) return
          if (!conversation.runtimeId) {
            toast.error(
              'No runtime selected',
              'Select a runtime for this conversation, then refresh Files.',
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
          const file = await api.atlasReadRuntimeFile(
            target.teamId,
            target.runtimeId,
            target.sessionId,
            `${path}/${fileName}`,
          )

          if (cancelled) return
          const preview = runtimeFilePreview(file)

          if (!preview) toast.error('Preview unavailable', 'This file format cannot be previewed.')
          setResult({ source: target, directory: null, preview, loading: false })
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
        toast.apiError('Could not load runtime files', error)
        setResult({ source: source.current, directory: null, preview: null, loading: false })
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [teamId, conversationId, isActive, path, fileName, refreshKey, retry])

  function navigate(nextPath: string) {
    setFileName('')
    setPath(nextPath)
  }

  return {
    ...result,
    path,
    fileName,
    navigate,
    openFile: setFileName,
    refresh: () => setRetry((value) => value + 1),
  }
}
