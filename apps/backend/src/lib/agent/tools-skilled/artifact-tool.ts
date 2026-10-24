import { tool } from 'ai'
import { z } from 'zod'

import { labelField } from './labeling'

export const ARTIFACT_KINDS = ['html', 'markdown', 'svg', 'code'] as const

/** Large enough for a full single-page app, small enough to keep a transcript openable. */
export const ARTIFACT_MAX_CHARS = 250_000

export function createArtifactTool() {
  return tool({
    description:
      'Show an artifact: a substantial, self-contained piece of content the user will want to view, ' +
      'reuse, or keep editing, such as a document or report, a single-page HTML app, page mockup or ' +
      'interactive visualization, an SVG diagram, or a complete code file. It opens in a panel beside ' +
      'the chat with a preview, its source, copy and download, and earlier versions stay available. ' +
      'Use it when the content runs past about 15 lines and stands on its own. Do not use it for short ' +
      'answers, snippets the user reads once, or content that only makes sense next to the chat. ' +
      'Numeric charts belong to render_chart. ' +
      'To change an artifact, call this again with the same artifactId and the complete new content; ' +
      'each call adds a version. Do not paste the content into your reply as well. After the call, say ' +
      'in one or two sentences what it is or what changed. ' +
      'html: one complete document with inline <style> and <script>. It runs in a sandbox with no ' +
      "access to Nuphos, the user's session, cookies or storage, so it cannot call Nuphos APIs. It may " +
      "load libraries from public https CDNs, and its links open in the user's browser. " +
      'markdown: a document. svg: a single <svg> element with a viewBox. code: one file; set language. ' +
      'People open artifacts in a narrow side panel, on phones, tablets and foldables, so write HTML ' +
      'mobile-first and fluid: include <meta name="viewport" content="width=device-width, initial-scale=1">, ' +
      'size with %, rem, fr and clamp() rather than fixed pixel widths, let flex and grid rows wrap, keep ' +
      'media at max-width:100%, make tap targets at least 44px, and never require horizontal scrolling. ' +
      'It should read well from 320px to a full desktop. On a foldable, let the layout reflow; viewport ' +
      'segments are not exposed inside the artifact frame. People may download a page as one file to ' +
      'send on, so prefer inline code and data over files fetched at run time. ' +
      'Give an svg a viewBox and no fixed width or height so it scales.',
    inputSchema: z.object({
      label: labelField,
      artifactId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Use a short lowercase kebab-case id')
        .describe(
          'Short kebab-case id, e.g. "q3-cost-report". Reuse it to publish a new version of an ' +
            'artifact shown earlier in this conversation; use a new id for a different artifact.',
        ),
      title: z.string().trim().min(1).max(120).describe('Title shown on the card and the panel.'),
      kind: z
        .enum(ARTIFACT_KINDS)
        .describe(
          'html for pages, apps and visualizations, markdown for documents, svg for diagrams, code for a source file.',
        ),
      language: z
        .string()
        .trim()
        .max(40)
        .optional()
        .describe('Language of a code artifact, e.g. "python" or "yaml". Ignored for other kinds.'),
      content: z
        .string()
        .min(1)
        .max(ARTIFACT_MAX_CHARS)
        .describe('The complete artifact content. Every call carries all of it, never a diff.'),
    }),
    // The card is drawn from the call's input. Echoing the content back would
    // spend the model's context on a copy it already wrote.
    execute: ({ artifactId, title, kind, content }) => ({
      artifactId,
      title,
      kind,
      characters: content.length,
      shown: 'The artifact is open beside the chat.',
    }),
  })
}
