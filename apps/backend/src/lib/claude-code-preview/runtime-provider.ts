/** Every agent a runtime image can carry; the identifier is also the image variant. */
export const OPENAB_PROVIDERS = ['claude-code', 'codex', 'grok', 'antigravity', 'opencode'] as const

export type OpenAbProvider = (typeof OPENAB_PROVIDERS)[number]

// `shim`: the agent speaks ACP itself and the image's ACP shim adds the Nuphos layer
// in front of it (apps/runtime/image/acp-shim.mjs) instead of a patched adapter.
const PROVIDERS: Record<
  OpenAbProvider,
  { label: string; errorPrefix: string; short: string; shim: boolean }
> = {
  'claude-code': { label: 'Claude Code', errorPrefix: 'claude_code', short: 'claude', shim: false },
  codex: { label: 'Codex', errorPrefix: 'codex', short: 'codex', shim: false },
  grok: { label: 'Grok Build', errorPrefix: 'grok', short: 'grok', shim: true },
  antigravity: {
    label: 'Antigravity',
    errorPrefix: 'antigravity',
    short: 'antigravity',
    shim: true,
  },
  opencode: { label: 'OpenCode', errorPrefix: 'opencode', short: 'opencode', shim: true },
}

export function isOpenAbProvider(value: unknown): value is OpenAbProvider {
  return typeof value === 'string' && Object.hasOwn(PROVIDERS, value)
}

/** Legacy records without a provider belong to Claude Code. */
export function runtimeProvider(value?: unknown): OpenAbProvider {
  return isOpenAbProvider(value) ? value : 'claude-code'
}

export function runtimeLabel(provider: OpenAbProvider): string {
  return PROVIDERS[provider].label
}

/** The short name Kubernetes objects and ConfigMaps carry: `openab-<short>-…`. */
export function runtimeShortName(provider: OpenAbProvider): string {
  return PROVIDERS[provider].short
}

/** "Claude Code", then "Claude Code 2", … so a new agent never reuses a name in its team. */
export function defaultRuntimeLabel(provider: OpenAbProvider, taken: readonly string[]): string {
  const base = runtimeLabel(provider)
  const used = new Set(taken)
  let n = 1

  while (used.has(n === 1 ? base : `${base} ${String(n)}`)) n += 1

  return n === 1 ? base : `${base} ${String(n)}`
}

export function runsBehindAcpShim(provider: OpenAbProvider): boolean {
  return PROVIDERS[provider].shim
}

export function runtimeErrorPrefix(provider: OpenAbProvider): string {
  return PROVIDERS[provider].errorPrefix
}
