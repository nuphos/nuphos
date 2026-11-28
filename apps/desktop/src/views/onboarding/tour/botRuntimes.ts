import { STARTER_LOCAL_PROVIDERS } from './starterSelection.ts'

import type { LocalAgentProvider } from '../../../api/local-agent-providers.ts'
import type { AgentProvider } from '../../../types/runtime.ts'

/** What Frida works with on each side. */
export type BotRuntimes = Record<'here' | 'box', AgentProvider>

/**
 * What the tour shows Frida working with: on this computer, the runtime the first Bot would
 * start on (Claude Code, then Codex, then Grok Build), else the first other one installed, or
 * Claude Code as an example when it has none, since the switch is an illustration either way;
 * on the Box, OpenCode, its default.
 */
export function botRuntimes(installed: readonly LocalAgentProvider[]): BotRuntimes {
  const here =
    STARTER_LOCAL_PROVIDERS.find((provider) => installed.includes(provider)) ?? installed.at(0)

  return { here: here ?? 'claude-code', box: 'opencode' }
}
