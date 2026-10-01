import { KubeContextContext } from './useKubeContext'

import type { ReactNode } from 'react'

export function KubeContextProvider({
  context,
  children,
}: {
  context: string | null
  children: ReactNode
}) {
  return <KubeContextContext.Provider value={context}>{children}</KubeContextContext.Provider>
}
