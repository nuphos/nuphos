/** OpenCode 2.x prints "opencode v2.1.4"; the others print the bare version. */
export function versionOf(output: string): string | undefined {
  return output
    .split(/\s+/u)
    .find((token) => /^v?\d+\.\d+\.\d+/u.test(token))
    ?.replace(/^v/u, '')
}

/** False when either version is unreadable: only a version known to be older blocks a runtime. */
export function olderThan(version: string, minimum: string): boolean {
  const have = version.split('.').map(Number)

  for (const [i, part] of minimum.split('.').map(Number).entries())
    if (have[i] !== part) return (have[i] ?? 0) < part

  return false
}

/**
 * Older Codex CLIs list models OpenAI no longer serves to ChatGPT sign-ins, so every turn on
 * them fails. 0.155.0 is the first release whose list has none of the models seen rejected.
 */
export const CODEX_MIN_VERSION = '0.155.0'
