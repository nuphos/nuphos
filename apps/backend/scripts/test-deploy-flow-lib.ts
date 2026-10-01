// Mirror what the renderer does: build assistant messages from streamed parts.
export type AssistantPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool'
      toolCallId: string
      toolName: string
      state: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
  | { type: 'step-start' }

export function applyEvent(parts: AssistantPart[], ev: any): AssistantPart[] {
  const t = ev.type as string | undefined

  if (!t) return parts
  if (t === 'text-start') return [...parts, { type: 'text', text: '' }]
  if (t === 'text-delta') {
    const delta = (ev.delta as string) ?? ''

    if (!delta) return parts
    const last = parts[parts.length - 1]

    if (last?.type === 'text') {
      const next = parts.slice()

      next[parts.length - 1] = { ...last, text: last.text + delta }

      return next
    }

    return [...parts, { type: 'text', text: delta }]
  }
  if (t === 'text-end') return parts
  if (t === 'start-step') return [...parts, { type: 'step-start' }]
  if (t === 'finish-step') return parts
  if (t === 'tool-input-start') {
    const id = ev.toolCallId as string

    if (parts.some((p) => p.type === 'tool' && p.toolCallId === id)) return parts

    return [
      ...parts,
      {
        type: 'tool',
        toolCallId: id,
        toolName: (ev.toolName as string) ?? 'tool',
        state: 'input-streaming',
      },
    ]
  }
  if (t === 'tool-input-available') {
    const id = ev.toolCallId as string

    if (!parts.some((p) => p.type === 'tool' && p.toolCallId === id)) {
      return [
        ...parts,
        {
          type: 'tool',
          toolCallId: id,
          toolName: (ev.toolName as string) ?? 'tool',
          state: 'input-available',
          input: ev.input,
        },
      ]
    }

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === id
        ? {
            ...p,
            toolName: (ev.toolName as string) ?? p.toolName,
            state: 'input-available',
            input: ev.input,
          }
        : p,
    )
  }
  if (t === 'tool-output-available') {
    const id = ev.toolCallId as string

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === id
        ? { ...p, state: 'output-available', output: ev.output }
        : p,
    )
  }
  if (t === 'tool-output-error') {
    const id = ev.toolCallId as string

    return parts.map((p) =>
      p.type === 'tool' && p.toolCallId === id
        ? { ...p, state: 'output-error', errorText: (ev.errorText as string) ?? 'Tool error' }
        : p,
    )
  }

  return parts
}

export function shorten(s: unknown, n = 200): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s)

  if (!str) return ''

  return str.length > n ? `${str.slice(0, n)}…` : str
}

const CONFIRM_HINTS = [/要不要.*?(部署|安裝|繼續|執行)/, /confirm/i, /proceed/i, /continue\??$/im]

const CONFIRM_VERBS = ['部署', '安裝', '繼續', '執行']

// "要我 … <verb> … 嗎/?" within one line. Scanned rather than matched: as a
// regex this is `要我.*?(?:verb).*?[嗎?]`, whose two lazy runs backtrack
// quadratically, and bounding them would quietly stop matching any sentence
// that puts more words than the bound between the markers — prose has no
// honest upper length.
function asksToProceedInChinese(text: string): boolean {
  for (const line of text.split('\n')) {
    const asked = line.indexOf('要我')

    if (asked === -1) continue
    const afterAsk = line.slice(asked)

    for (const verb of CONFIRM_VERBS) {
      const at = afterAsk.indexOf(verb)

      if (at === -1) continue
      const tail = afterAsk.slice(at + verb.length)

      if (tail.includes('嗎') || tail.includes('?')) return true
    }
  }

  return false
}

export function looksLikeConfirmationAsk(text: string): boolean {
  return CONFIRM_HINTS.some((re) => re.test(text)) || asksToProceedInChinese(text)
}
