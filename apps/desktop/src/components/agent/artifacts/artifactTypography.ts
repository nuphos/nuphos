/**
 * A document artifact reads as a document, not a chat reply: the chat's
 * headings sit one step above body text, a document's need a real scale.
 * Applied to MessageResponse, whose own heading classes these outrank.
 */
export const ARTIFACT_DOCUMENT_TYPE =
  'text-[15px] leading-7 ' +
  '[&_h1]:mb-5 [&_h1]:mt-0 [&_h1]:text-[26px] [&_h1]:leading-[1.2] [&_h1]:tracking-[-0.015em] ' +
  '[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-[19px] [&_h2]:leading-snug ' +
  '[&_h3]:mb-2 [&_h3]:mt-7 [&_h3]:text-[16px]'
