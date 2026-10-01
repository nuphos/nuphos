// Pure transcript helpers for Auto Mode session context. Zero imports
// (no @/config) so tests load it standalone — same split as judge-core.ts.

// Tools the approval governs. bash executes server-side (SDK runs it on
// approve); local_exec is a client tool — the desktop executes it after the
// user approves and returns the result with the approval response.
// port_forward_start has no command string, so the fail-safe makes it
// always require approval (a standing local network action).
export const GOVERNED_TOOLS = new Set(['bash', 'local_exec', 'port_forward_start'])

export function commandFromInput(input: unknown): string | null {
  if (input && typeof input === 'object') {
    const c = (input as { command?: unknown }).command

    if (typeof c === 'string' && c.trim()) return c
  }

  return null
}

/**
 * Commands of governed tools that already EXECUTED in this transcript, oldest
 * first. Fed to the judge as session context so it can resolve indirection the
 * command text alone can't (a kubeconfig context created by an earlier
 * get-credentials, an exported variable, a selected project) — without this,
 * a rule naming "cluster X" can never match a command that reaches X through
 * an alias, and the user gets re-prompted despite an explicit standing rule.
 */
export function executedGovernedCommands(
  messages: readonly { role: string; parts: unknown[] }[],
): string[] {
  const commands: string[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (typeof part !== 'object' || part === null) continue
      const candidate = part as { type?: unknown; state?: unknown; input?: unknown }

      if (typeof candidate.type !== 'string' || !candidate.type.startsWith('tool-')) continue
      if (!GOVERNED_TOOLS.has(candidate.type.slice('tool-'.length))) continue
      if (candidate.state !== 'output-available') continue
      const command = commandFromInput(candidate.input)

      if (command) commands.push(command)
    }
  }

  return commands
}
