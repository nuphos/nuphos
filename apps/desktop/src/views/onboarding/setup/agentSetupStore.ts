/** Which setup is open over the app: the new-user one, or adding a runtime to a team. */
export type AgentSetupRequest = { kind: 'local' } | { kind: 'runtime'; teamId: string }

const listeners = new Set<() => void>()
let request: AgentSetupRequest | null = null

function set(next: AgentSetupRequest | null) {
  request = next
  for (const listener of listeners) listener()
}

export const agentSetup = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  current: () => request,
  close: () => set(null),
}

/** The setup a new workspace's creator gets, for anyone who has no runtime yet. */
export function openAgentSetup(): void {
  set({ kind: 'local' })
}

/** Settings › Runtimes' own "Add new runtime" dialog, e.g. for a cloud runtime. */
export function openAddRuntime(teamId: string): void {
  set({ kind: 'runtime', teamId })
}
