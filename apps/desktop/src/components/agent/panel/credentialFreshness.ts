import type { AgentCredentialSelection } from '../../../api'

type SelectionKey = keyof AgentCredentialSelection

/** Options present in `available` that were not there when the selection was last saved. */
export function unseenCredentials(
  available: AgentCredentialSelection,
  seen: Partial<AgentCredentialSelection> | undefined,
): AgentCredentialSelection | undefined {
  if (!seen) return undefined
  const result = { ...available }

  for (const key of Object.keys(available) as SelectionKey[]) {
    const known = new Set(seen[key] ?? [])

    result[key] = available[key].filter((id) => !known.has(id))
  }

  return result
}

export function hasUnseenCredentials(unseen: AgentCredentialSelection | undefined): boolean {
  return unseen !== undefined && Object.values(unseen).some((ids) => ids.length > 0)
}

export function debounced(fn: () => void, ms: number): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    trigger: () => {
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        fn()
      }, ms)
    },
    cancel,
  }
}
