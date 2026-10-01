export type MessagePartOrderInput = {
  type: string
  text?: string
}

// The finalizer's provenance frame replaces the turn-start one by removing and
// re-appending it, so a provenance part can sit at the tail of the array while
// a final text chunk is still buffered. Late text belongs before it either way
// — render order is decided by the normalizer below, not by arrival.
export function textDeltaInsertionIndex(parts: readonly MessagePartOrderInput[]): number {
  let index = parts.length

  while (index > 0 && parts[index - 1]?.type === 'memory-provenance') {
    index -= 1
  }

  return index
}

// Recall is the first thing that happens in a turn — before any tool runs —
// so it renders first, as the step it was. Arrival order cannot express that:
// the finalizer re-appends the part mid-turn, and older transcripts have it
// buried between text chunks. Normalizing at render puts it back where it
// belongs chronologically, keeps the answer's text contiguous, and leaves
// post-hoc ingest cards at the bottom where they did happen last.
export function normalizeRecallFirstOrder<T extends MessagePartOrderInput>(
  parts: readonly T[],
): T[] {
  const provenance = parts.filter((part) => part.type === 'memory-provenance')

  if (provenance.length === 0) return [...parts]

  const content: T[] = []
  const ingest: T[] = []
  let provenanceSplitText = false

  for (const part of parts) {
    if (part.type === 'memory-provenance') {
      provenanceSplitText = content.at(-1)?.type === 'text'
      continue
    }
    if (part.type === 'memory-ingest') {
      ingest.push(part)
      provenanceSplitText = false
      continue
    }
    const previous = content[content.length - 1]

    if (
      provenanceSplitText &&
      part.type === 'text' &&
      previous?.type === 'text' &&
      typeof part.text === 'string' &&
      typeof previous.text === 'string'
    ) {
      content[content.length - 1] = {
        ...previous,
        text: previous.text + part.text,
      }
      provenanceSplitText = false
      continue
    }
    content.push(part)
    provenanceSplitText = false
  }

  return [...provenance, ...content, ...ingest]
}

// How many normalized parts belong ABOVE the collapsed-work fold.
//
// A finished turn with tool activity folds everything before its final answer
// into a closed "Worked for Xs" disclosure. Recall now sits at index 0, so it
// lands inside that fold — invisible until clicked, which is less visible than
// the footer it replaced, not more. Recall is not work; it is the state the
// turn started from, so it stays out of the fold entirely.
export function recallLeadCount(parts: readonly MessagePartOrderInput[]): number {
  let count = 0

  while (parts[count]?.type === 'memory-provenance') count += 1

  return count
}
