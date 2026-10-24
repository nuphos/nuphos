// A download of an artifact that works anywhere, offline and forever: one file,
// named after its title. Nuphos hosts nothing; the user decides where it goes.
//
// A page may load libraries, fonts and images from public CDNs (the tool allows
// it), so its download fetches each one and inlines it, then pins a policy
// that forbids any further network fetch. What could not be fetched is listed,
// so the user hears about it instead of finding a broken page later.
import { artifactFileName, artifactMimeType } from './artifactPayload.ts'
import { Inliner } from './artifactInliner.ts'
import { withArtifactHead } from './artifactSandbox.ts'

import type { ArtifactVersion } from './artifactPayload.ts'

export type FetchedAsset = { contentType: string; bytes: Uint8Array }
export type FetchAsset = (url: string) => Promise<FetchedAsset | null>

export type ArtifactExport = {
  fileName: string
  mimeType: string
  content: string
  /** Remote files the page loads that could not be inlined. */
  missing: string[]
}

/** Nothing in the file can reach the network: all it needs is inline. */
export const EXPORT_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const MAX_ASSET_BYTES = 10 * 1024 * 1024

/** The renderer's fetch: no cookies, no referrer. Most CDNs allow the read. */
export const fetchAsset: FetchAsset = async (url) => {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())

    if (bytes.byteLength > MAX_ASSET_BYTES) return null

    return { contentType: response.headers.get('content-type') ?? '', bytes }
  } catch {
    return null
  }
}

export async function exportArtifact(
  version: ArtifactVersion,
  fetcher: FetchAsset = fetchAsset,
): Promise<ArtifactExport> {
  const file = { fileName: artifactFileName(version), mimeType: artifactMimeType(version.kind) }

  if (version.kind === 'markdown' || version.kind === 'code') {
    return { ...file, content: version.content, missing: [] }
  }
  const inliner = new Inliner(fetcher)
  const content =
    version.kind === 'svg'
      ? await inliner.markup(version.content)
      : withArtifactHead(
          await inliner.markup(version.content),
          `<meta http-equiv="Content-Security-Policy" content="${EXPORT_POLICY}">` +
            `<title>${escapeText(version.title)}</title>`,
        )

  // Data a script asks for at run time cannot be saved ahead; say so.
  if (LIVE_FETCH.test(version.content)) inliner.missing.add('live data the page loads from the web')

  return { ...file, content, missing: [...inliner.missing] }
}

const LIVE_FETCH = /\b(?:fetch|EventSource|WebSocket)\s*\(\s*["'`](?:https?|wss?):/

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
