import { faArrowsRotate, faUpload } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'

import { CfDetailActionBar } from './cf-shared'
import { R2CredentialsGate } from './cloudflare-r2-dialogs'
import { R2ObjectPreviewPanel, R2ObjectsTable } from './cloudflare-r2-objects-table'
import { ErrorBlock } from './ErrorBlock'
import { basename, formatBytes } from './shared'

import type { R2Row } from './cloudflare-r2-objects-table'
import type { CloudflareR2CredentialsStatus, CloudflareR2Object } from '../../types'

// The inline upload path base64-encodes the whole file in the renderer, and the
// backend caps the base64 body at 20 MiB — keep raw files under that (base64
// inflates ~4/3, so 15 MiB raw ≈ 20 MiB encoded).
const MAX_R2_INLINE_UPLOAD_BYTES = 15 * 1024 * 1024

export function CloudflareR2BucketDetailView({
  teamId,
  accountId,
  bucketName,
  prefix,
  onNavigate,
  onLoading,
}: {
  teamId: string
  accountId: string
  bucketName: string
  prefix: string
  onNavigate: (prefix: string) => void
  onLoading?: (loading: boolean) => void
}) {
  const [creds, setCreds] = useState<CloudflareR2CredentialsStatus | null>(null)
  const [credsLoading, setCredsLoading] = useState(true)
  const setPrefix = onNavigate
  const [objects, setObjects] = useState<CloudflareR2Object[]>([])
  const [prefixes, setPrefixes] = useState<string[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [paging, setPaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; text: string; truncated: boolean } | null>(
    null,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const genRef = useRef(0)

  useReportLoading(loading || credsLoading, onLoading)

  useResetOnKey(`${teamId}|${accountId}`, () => setCredsLoading(true))
  useEffect(() => {
    api
      .atlasGetCloudflareR2Credentials(teamId, accountId)
      .then((c) => {
        setCreds(c)
        setCredsLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e instanceof Error ? e.message : e))
        setCredsLoading(false)
      })
  }, [teamId, accountId])

  const fetchObjects = useCallback(
    (nextPrefix: string) => {
      const gen = ++genRef.current

      api
        .atlasListCloudflareR2Objects(teamId, accountId, bucketName, nextPrefix, null)
        .then((res) => {
          if (genRef.current !== gen) return
          setObjects(res.objects)
          setPrefixes(res.prefixes)
          setCursor(res.nextContinuationToken)
          setTruncated(res.isTruncated)
          setLoading(false)
        })
        .catch((e: unknown) => {
          if (genRef.current !== gen) return
          setError(String(e instanceof Error ? e.message : e))
          setLoading(false)
        })
    },
    [teamId, accountId, bucketName],
  )

  // Manual refresh/navigation handlers keep using `loadObjects` for the
  // spinner; the credentials-gated listing gets it from the render-time reset.
  const loadObjects = useCallback(
    (nextPrefix: string) => {
      setLoading(true)
      setError(null)
      fetchObjects(nextPrefix)
    },
    [fetchObjects],
  )

  useResetOnKey(
    `${teamId}|${accountId}|${bucketName}|${String(creds?.bound ?? false)}|${prefix}`,
    () => {
      if (!creds?.bound) return
      setLoading(true)
      setError(null)
    },
  )
  useEffect(() => {
    if (creds?.bound) fetchObjects(prefix)
  }, [creds?.bound, prefix, fetchObjects])

  const loadMore = useCallback(() => {
    if (!cursor || paging) return
    const gen = genRef.current

    setPaging(true)
    api
      .atlasListCloudflareR2Objects(teamId, accountId, bucketName, prefix, cursor)
      .then((res) => {
        if (genRef.current !== gen) return
        setObjects((p) => [...p, ...res.objects])
        setPrefixes((p) => [...p, ...res.prefixes])
        setCursor(res.nextContinuationToken)
        setTruncated(res.isTruncated)
        setPaging(false)
      })
      .catch(() => setPaging(false))
  }, [cursor, paging, teamId, accountId, bucketName, prefix])

  async function handleUpload(file: File) {
    if (file.size > MAX_R2_INLINE_UPLOAD_BYTES) {
      toast.error(
        'File is too large',
        `This upload path supports files up to ${formatBytes(MAX_R2_INLINE_UPLOAD_BYTES)}.`,
      )

      return
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    let binary = ''

    for (const byte of buf) binary += String.fromCharCode(byte)
    const contentBase64 = btoa(binary)

    await api.atlasPutCloudflareR2Object(teamId, accountId, bucketName, {
      key: prefix + file.name,
      contentBase64,
      contentType: file.type || undefined,
    })
    toast.success(`Uploaded ${file.name}`)
    loadObjects(prefix)
  }

  const rows: R2Row[] = [
    ...prefixes.map((p) => ({
      kind: 'prefix' as const,
      key: `p:${p}`,
      name: basename(p),
      prefix: p,
    })),
    ...objects.map((o) => ({
      kind: 'object' as const,
      key: `o:${o.key}`,
      name: basename(o.key),
      object: o,
    })),
  ]

  if (credsLoading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
          Loading…
        </div>
      </div>
    )
  }

  // A failed credential-status request must not masquerade as "no R2
  // credentials bound" — surface the actual error instead of the bind prompt.
  if (error && !creds) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ErrorBlock message={error} />
      </div>
    )
  }

  if (!creds?.bound) {
    return (
      <R2CredentialsGate
        onBind={async (input) => {
          const status = await api.atlasBindCloudflareR2Credentials(teamId, accountId, input)

          setCreds(status)
          toast.success('R2 credentials bound')
        }}
      />
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CfDetailActionBar>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="h-7 px-2.5 rounded-md bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main text-[12.5px] flex items-center gap-1.5"
        >
          <FontAwesomeIcon icon={faUpload} className="w-3.5 h-3.5" /> Upload
        </button>
        <button
          onClick={() => loadObjects(prefix)}
          className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
          title="Refresh"
        >
          <FontAwesomeIcon icon={faArrowsRotate} className="w-3.5 h-3.5" />
        </button>
      </CfDetailActionBar>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]

          if (file)
            void handleUpload(file).catch((err: unknown) =>
              toast.apiError('Failed to upload object', err, {
                fallback: 'Check your connection and try again.',
              }),
            )
          e.target.value = ''
        }}
      />
      {error ? (
        <ErrorBlock message={error} />
      ) : (
        <R2ObjectsTable
          teamId={teamId}
          accountId={accountId}
          bucketName={bucketName}
          loading={loading}
          rows={rows}
          truncated={truncated}
          paging={paging}
          cursor={cursor}
          onLoadMore={loadMore}
          onNavigate={setPrefix}
          onPreview={setPreview}
          onDeleted={() => loadObjects(prefix)}
        />
      )}

      {preview && (
        <R2ObjectPreviewPanel
          preview={preview}
          bucketName={bucketName}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
