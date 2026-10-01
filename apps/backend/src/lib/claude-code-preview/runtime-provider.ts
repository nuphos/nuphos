/** Legacy records without a provider belong to Claude Code. */
export type OpenAbProvider = 'claude-code' | 'codex'

export function runtimeProvider(value?: string): OpenAbProvider {
  return value === 'codex' ? 'codex' : 'claude-code'
}

export function runtimeLabel(provider: OpenAbProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

/** "Claude Code", then "Claude Code 2", … so a new agent never reuses a name in its team. */
export function defaultRuntimeLabel(provider: OpenAbProvider, taken: readonly string[]): string {
  const base = runtimeLabel(provider)
  const used = new Set(taken)
  let n = 1

  while (used.has(n === 1 ? base : `${base} ${String(n)}`)) n += 1

  return n === 1 ? base : `${base} ${String(n)}`
}

export function runtimeErrorPrefix(provider: OpenAbProvider): string {
  return provider === 'codex' ? 'codex' : 'claude_code'
}
