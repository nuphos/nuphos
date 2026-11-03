const listeners = new Set<() => void>()
let open = false

function set(next: boolean) {
  open = next
  for (const listener of listeners) listener()
}

export const agentSetup = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  current: () => open,
  close: () => set(false),
}

/** The setup a new workspace's creator gets, for anyone who has no runtime yet. */
export function openAgentSetup(): void {
  set(true)
}
