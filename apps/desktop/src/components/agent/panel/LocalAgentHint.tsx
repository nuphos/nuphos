import { Monitor } from 'lucide-react'

import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { localAgentReady } from '../../../lib/localAgentReady'
import { LocalClaudeSignIn } from '../../../views/settings/LocalClaudeSignIn'

/** A quiet pointer to set up the local agent, shown only while this computer has none ready. */
export function LocalAgentHint() {
  const state = useLocalRuntimeState()
  const claude = state?.agents['claude-code']

  if (claude?.available && claude.cli?.installed && claude.cli.loggedIn !== true)
    return (
      <div className="mt-3 space-y-2 text-center text-[12px] text-tertiary">
        <p>Use Claude on this computer. Sign in once for Nuphos, separately from your terminal.</p>
        <LocalClaudeSignIn />
      </div>
    )
  if (localAgentReady(state) !== false) return null

  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-tertiary">
      <Monitor strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0" />
      Install and sign in to Claude Code or Codex to run the agent on this computer — see User
      settings › This computer › Local agent.
    </p>
  )
}
