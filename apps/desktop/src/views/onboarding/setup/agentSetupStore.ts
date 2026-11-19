/** Which setup is open over the app: the new-user one, or adding a runtime to a team. */
export type AgentSetupRequest =
  { kind: 'local'; teamId?: string } | { kind: 'runtime'; teamId: string; box?: boolean }

/** A cloud computer made from a new user's setup: the Computers page opens, where its card adds runtimes. */
export const OPEN_COMPUTERS = 'nuphos:open-computers'

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
export function openAgentSetup(teamId?: string): void {
  set({ kind: 'local', teamId })
}

/** Settings › Runtimes' own "Add new runtime" dialog, e.g. for a cloud runtime. */
export function openAddRuntime(teamId: string): void {
  set({ kind: 'runtime', teamId })
}

/** The same dialog on its cloud computer, for a new user; once one is made, the Computers page. */
export function openCloudComputer(teamId: string): void {
  set({ kind: 'runtime', teamId, box: true })
}
