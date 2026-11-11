// The document an HTML *file* previews as. Unlike an artifact (HTML the
// user's own agent wrote for this chat), a file can come from anyone in a
// chat or channel, so its preview never runs code: no sandbox flag at all (no
// scripts, popups, forms, modals or same-origin) and a policy that refuses
// every network load. What the page shows is its own markup, inline styles and
// data: images. A link has nowhere to go: `_blank` needs the popups the
// sandbox withholds, and the main process stops the frame navigating itself
// (FILE_PREVIEW_FRAME_NAME, electron/main/file-preview-guard.ts). Resource
// hints, which a CSP does not cover, are removed from the file (resourceHints.ts)
// and DNS prefetching is turned off.

import { withArtifactHead } from './artifactSandbox.ts'
import { stripResourceHints } from './resourceHints.ts'

import type { HtmlParser } from './resourceHints.ts'

/** No `allow-*` flags: the strictest sandbox there is. */
export const FILE_PREVIEW_SANDBOX = ''

export const FILE_PREVIEW_CSP = [
  "default-src 'none'",
  'img-src data:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export { FILE_PREVIEW_FRAME_NAME } from './filePreviewFrameName.ts'

/** The file's markup, without resource hints, with the policy ahead of anything it could load. */
export function filePreviewSrcDoc(html: string, parse?: HtmlParser): string {
  return withArtifactHead(
    stripResourceHints(html, parse),
    `<meta http-equiv="Content-Security-Policy" content="${FILE_PREVIEW_CSP}">` +
      '<meta http-equiv="x-dns-prefetch-control" content="off"><base target="_blank">',
  )
}
