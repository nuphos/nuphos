import { faCheck, faCopy, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Copy, Download, ExternalLink, File as FileIcon, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { DetailSidebarTransition } from '../../components/DetailSidebarTransition'

import { isImageObject, isTextObject, s3ConsoleObjectUrl, s3Uri } from './s3-helpers'
import { basename, formatBytes } from './shared'

import type { AwsS3Bucket, AwsS3Object, AwsS3ObjectPreview } from '../../types'

export function S3ObjectPreviewPanel({
  bucket,
  object,
  onClose,
  onDownload,
  getDownloadUrl,
  getPreview,
}: {
  bucket: AwsS3Bucket
  object: AwsS3Object
  onClose: () => void
  onDownload: () => void
  getDownloadUrl?: (key: string) => Promise<string>
  getPreview?: (key: string) => Promise<AwsS3ObjectPreview>
}) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<AwsS3ObjectPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [copiedContent, setCopiedContent] = useState(false)
  const copyResetRef = useRef<number | undefined>(undefined)

  const looksImage = isImageObject(object.key)
  const looksText = isTextObject(object.key)

  // The loader props are inline closures recreated on every parent render
  // (the app-level poll tick re-renders the view every few seconds), so the
  // fetch effects must not key off their identity — only off the object and
  // the manual reload counter.
  const getDownloadUrlRef = useRef(getDownloadUrl)
  const getPreviewRef = useRef(getPreview)

  useEffect(() => {
    getDownloadUrlRef.current = getDownloadUrl
    getPreviewRef.current = getPreview
  })

  useEffect(() => () => window.clearTimeout(copyResetRef.current), [])

  useEffect(() => {
    const load = getDownloadUrlRef.current

    if (!load) return
    let cancelled = false

    load(object.key)
      .then((url) => {
        if (!cancelled) setDownloadUrl(url)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPreviewError(String(e instanceof Error ? e.message : e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [object.key, reloadTick])

  useEffect(() => {
    const load = getPreviewRef.current

    if (!looksText || !load) return
    let cancelled = false

    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    load(object.key)
      .then((p) => {
        if (cancelled) return
        setPreview(p)
        setPreviewLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setPreviewError(String(e instanceof Error ? e.message : e))
        setPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [object.key, looksText, reloadTick])

  const copyContent = () => {
    if (!preview) return
    void navigator.clipboard.writeText(preview.text)
    setCopiedContent(true)
    window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => setCopiedContent(false), 1500)
  }

  return (
    <DetailSidebarTransition
      onClose={onClose}
      className="w-[420px] shrink-0 flex flex-col border-l border-zGray-800 bg-zGray-950 min-h-0"
    >
      {(requestClose) => (
        <>
          <header className="px-3 py-2 border-b border-zGray-800 flex items-center gap-2">
            <FileIcon className="w-3.5 h-3.5 text-tertiary shrink-0" strokeWidth={1.8} />
            <span className="text-[12px] text-main truncate" title={object.key}>
              {basename(object.key)}
            </span>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="ml-auto text-tertiary hover:text-main shrink-0"
              title="Reload preview"
            >
              <FontAwesomeIcon
                icon={faRotateRight}
                className={`w-3.5 h-3.5${previewLoading ? ' animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={requestClose}
              className="text-tertiary hover:text-main shrink-0"
              title="Close preview"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.8} />
            </button>
          </header>

          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
            <dl className="px-3 py-2 grid grid-cols-[88px,1fr] gap-x-3 gap-y-1 text-[11.5px]">
              <dt className="text-tertiary uppercase tracking-wider self-baseline">Key</dt>
              <dd className="font-mono text-secondary break-all">{object.key}</dd>
              <dt className="text-tertiary uppercase tracking-wider self-baseline">Size</dt>
              <dd className="text-secondary tabular-nums">
                {formatBytes(object.size)}
                <span className="text-tertiary"> · {object.size.toLocaleString()} bytes</span>
              </dd>
              <dt className="text-tertiary uppercase tracking-wider self-baseline">Modified</dt>
              <dd className="text-secondary">{object.lastModified ?? '—'}</dd>
              <dt className="text-tertiary uppercase tracking-wider self-baseline">Storage</dt>
              <dd className="text-secondary">{object.storageClass ?? 'STANDARD'}</dd>
              {(preview?.contentType || !(preview === null && previewLoading)) && (
                <>
                  <dt className="text-tertiary uppercase tracking-wider self-baseline">Type</dt>
                  <dd className="text-secondary truncate" title={preview?.contentType ?? ''}>
                    {preview?.contentType ?? '—'}
                  </dd>
                </>
              )}
              <dt className="text-tertiary uppercase tracking-wider self-baseline">ETag</dt>
              <dd className="font-mono text-secondary text-[11px] break-all">
                {object.etag ?? '—'}
              </dd>
            </dl>

            <div className="px-3 pb-3">
              {looksImage && downloadUrl && (
                <div className="border border-zGray-800 rounded bg-zGray-900 p-2 flex items-center justify-center">
                  <img
                    src={downloadUrl}
                    alt={basename(object.key)}
                    className="max-w-full max-h-[400px] object-contain"
                  />
                </div>
              )}
              {looksImage && !downloadUrl && previewError && (
                <div className="text-error text-[12px]">{previewError}</div>
              )}
              {looksImage && !downloadUrl && !previewError && (
                <div className="text-tertiary text-[12px]">Loading preview…</div>
              )}

              {looksText && (
                <div className="border border-zGray-800 rounded bg-zGray-900">
                  {previewLoading && (
                    <div className="px-2 py-3 text-tertiary text-[12px]">Loading…</div>
                  )}
                  {previewError && (
                    <div className="px-2 py-3 text-error text-[12px]">{previewError}</div>
                  )}
                  {preview && (
                    <>
                      <pre className="px-2 py-2 text-[11px] font-mono whitespace-pre-wrap break-all text-secondary max-h-[480px] overflow-auto scrollbar-thin">
                        {preview.text || '(empty file)'}
                      </pre>
                      {preview.truncated && (
                        <div className="px-2 py-1.5 border-t border-zGray-800 text-[11px] text-tertiary">
                          Showing first {formatBytes(preview.text.length)} of{' '}
                          {formatBytes(preview.size)} — download to view full file.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {!looksImage && !looksText && (
                <div className="text-tertiary text-[12px] italic">
                  Cannot preview this file type. Use Download to inspect.
                </div>
              )}
            </div>
          </div>

          <footer className="px-3 py-2 border-t border-zGray-800 flex items-center gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={!getDownloadUrl}
              className="inline-flex items-center gap-1 text-[12px] text-zViolet-accent hover:underline disabled:opacity-50 disabled:no-underline"
              title="Download via presigned URL"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
              Download
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(s3Uri(bucket.name, object.key))}
              className="inline-flex items-center gap-1 text-[12px] text-tertiary hover:text-main"
            >
              <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
              Copy URI
            </button>
            {looksText && preview && (
              <button
                type="button"
                onClick={copyContent}
                className="inline-flex items-center gap-1 text-[12px] text-tertiary hover:text-main"
                title={
                  preview.truncated
                    ? 'Copy the previewed portion (file is truncated)'
                    : 'Copy the full file content'
                }
              >
                <FontAwesomeIcon icon={copiedContent ? faCheck : faCopy} className="w-3.5 h-3.5" />
                {copiedContent ? 'Copied' : 'Copy content'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void api.appOpenExternal(s3ConsoleObjectUrl(bucket, object.key))}
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-tertiary hover:text-main"
            >
              <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
              AWS console
            </button>
          </footer>
        </>
      )}
    </DetailSidebarTransition>
  )
}
