import { createContext, useContext } from 'react'

/**
 * The kubeconfig context name that descendants should route k8s IPC through.
 * Provided per workspace tab so two tabs on different clusters render the
 * correct rows without sharing global state.
 *
 * `null` means there is no cluster selected for this subtree — components that
 * need a context should render a placeholder and not issue any IPC.
 *
 * The provider lives in `KubeContextProvider.tsx` — a module that exports a
 * component alongside hooks breaks Fast Refresh.
 */
export const KubeContextContext = createContext<string | null>(null)

/** Returns the cluster context for the current tab, or null if none is set. */
export function useKubeContext(): string | null {
  return useContext(KubeContextContext)
}

/**
 * Like `useKubeContext` but throws when no context is set. Use inside views
 * that should only ever render after a cluster has been chosen — callers
 * higher up are responsible for gating on `kubeconfigContext != null`.
 */
export function useRequiredKubeContext(): string {
  const ctx = useContext(KubeContextContext)

  if (!ctx) {
    throw new Error('useRequiredKubeContext: no kubeconfig context is set')
  }

  return ctx
}
