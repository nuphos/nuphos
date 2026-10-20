/** The agents a computer can run for Nuphos. */
export const LOCAL_AGENT_PROVIDERS = ['claude-code', 'codex', 'grok', 'opencode'] as const

export type LocalAgentProvider = (typeof LOCAL_AGENT_PROVIDERS)[number]

/**
 * Grok Build and OpenCode run behind the image's ACP shim, whose /home/node this home
 * stands in for. openab runs their login wrapper under its own HOME, so the shim and the
 * wrapper are both told the CLI and the home.
 */
export function shimEnv(cliPath: string, home: string): Record<string, string> {
  return { HOME: home, NUPHOS_AGENT_EXECUTABLE: cliPath, NUPHOS_AGENT_HOME: home }
}
