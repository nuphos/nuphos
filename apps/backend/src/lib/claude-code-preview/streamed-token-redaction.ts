import { codexFileCitationScanner } from './codex-file-citations'
import { redactSignedTokens } from './mcp-token'
import { previewTextMetadata } from './preview-text-metadata'

import type { OpenAbSessionUpdate } from './openab-acp-updates'
import type { PreviewTextMetadata } from './preview-agent-update'

// How every token this backend signs begins.
const TOKEN_STARTS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.', // b64url of the fixed HS256 JWT header
  'nuphos-runtime-skills-v1.',
]
const SEPARATORS = new Set([' ', '\n', '\r', '\t', '"', "'", '\\'])

/** Where an unfinished token may begin at the end of `text`; text.length when none. */
function pendingTokenStart(text: string): number {
  let run = text.length

  while (run > 0 && !SEPARATORS.has(text[run - 1] ?? ' ')) run--
  const tail = text.slice(run)
  const starts = TOKEN_STARTS.flatMap((start) => {
    const inside = tail.indexOf(start.slice(0, 3))

    if (inside >= 0) return [run + inside]
    // The run ends partway into a token's fixed beginning.
    for (let at = 0; at < tail.length - 1; at++)
      if (start.startsWith(tail.slice(at))) return [run + at]

    return []
  })

  return Math.min(text.length, ...starts)
}

const sameOwner = (a?: PreviewTextMetadata, b?: PreviewTextMetadata) =>
  a?.messageId === b?.messageId && a?.phase === b?.phase

function heldBack(emit: (text: string, metadata?: PreviewTextMetadata) => void) {
  // The last character already sent: a token split right after it still matches.
  let sent = ''
  let held = ''
  let sentOwner: PreviewTextMetadata | undefined
  let owners: { length: number; metadata?: PreviewTextMetadata }[] = []
  const consume = (value: string, remember = true) => {
    let from = 0

    while (from < value.length) {
      const owner = owners[0]
      const length = Math.min(owner?.length ?? value.length, value.length - from)

      emit(value.slice(from, from + length), owner?.metadata)
      if (remember) sentOwner = owner?.metadata
      from += length
      if (owner) {
        owner.length -= length
        if (owner.length === 0) owners.shift()
      }
    }
  }
  const replaceOwners = (length: number, borrowedContext = false) => {
    const first = owners[0]?.metadata
    const same =
      owners.every((owner) => sameOwner(owner.metadata, first)) &&
      (!borrowedContext || sameOwner(sentOwner, first))

    // Mixed redacted text stays unphased; no source-message classification is guessed.
    owners = length ? [{ length, metadata: same ? first : undefined }] : []
  }

  return {
    push(text: string, metadata?: PreviewTextMetadata) {
      const previous = owners.at(-1)

      if (text.length) {
        if (previous && sameOwner(previous.metadata, metadata)) previous.length += text.length
        else owners.push({ length: text.length, metadata })
      }
      const raw = sent + held + text
      const all = redactSignedTokens(raw)
      const fresh = all.startsWith(sent) ? all.slice(sent.length) : all
      const context = all.startsWith(sent) ? sent : ''
      const cut = Math.max(0, pendingTokenStart(context + fresh) - context.length)

      if (all !== raw) replaceOwners(fresh.length, Boolean(sent) && !context)
      held = fresh.slice(cut)
      if (cut > 0) {
        consume(fresh.slice(0, cut))
        sent = fresh.slice(cut - 1, cut)
      }
    },
    flush() {
      const rest = held

      held = ''
      const safe = redactSignedTokens(rest)

      if (safe !== rest) replaceOwners(safe.length)
      if (safe) consume(safe, false)
    },
  }
}

// Each source message is its own Markdown document; a turn end closes the last.
function citationLinks(emit: (text: string, metadata?: PreviewTextMetadata) => void) {
  let scan = codexFileCitationScanner()
  let owner: PreviewTextMetadata | undefined
  const flush = () => {
    const rest = scan('', true)

    if (rest) emit(rest, owner)
    scan = codexFileCitationScanner()
  }

  return {
    push: (text: string, metadata?: PreviewTextMetadata) => {
      if (!sameOwner(owner, metadata)) flush()
      owner = metadata
      const ready = scan(text)

      if (ready) emit(ready, metadata)
    },
    flush,
  }
}

// A completion, an interruption, or the runtime thread leaving `active`.
const turnEnds = (update: OpenAbSessionUpdate) =>
  update.kind === 'complete' ||
  update.kind === 'interrupted' ||
  (update.kind === 'status' && update.status !== 'active')

/**
 * Wraps a session-update handler so streamed agent text and thoughts never
 * carry a backend token, even one split across chunks, and Codex file
 * citations in agent text arrive as Markdown links. Only text that may begin
 * a token or a citation is held, and it stays held across other updates until the
 * token resolves, the turn ends, or flush() is called.
 */
export function redactStreamedUpdates(handler: (update: OpenAbSessionUpdate) => void) {
  const links = citationLinks((value, metadata) => {
    handler({ kind: 'text', text: value, ...metadata })
  })
  const text = heldBack(links.push)
  const thought = heldBack((value) => {
    handler({ kind: 'agent', update: { kind: 'thought', text: value } })
  })
  const flush = () => {
    text.flush()
    links.flush()
    thought.flush()
  }

  return {
    deliver: (update: OpenAbSessionUpdate) => {
      if (update.kind === 'text') text.push(update.text, previewTextMetadata(update))
      else if (update.kind === 'agent' && update.update.kind === 'thought')
        thought.push(update.update.text)
      else {
        if (turnEnds(update)) flush()
        handler(update)
      }
    },
    flush,
  }
}
