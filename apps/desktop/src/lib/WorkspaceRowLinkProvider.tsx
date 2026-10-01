import { WorkspaceRowLinkContext } from './workspaceRowLink'

import type { WorkspaceRowLinkValue } from './workspaceRowLink'
import type { ReactNode } from 'react'

export function WorkspaceRowLinkProvider({
  value,
  children,
}: {
  value: WorkspaceRowLinkValue
  children: ReactNode
}) {
  return (
    <WorkspaceRowLinkContext.Provider value={value}>{children}</WorkspaceRowLinkContext.Provider>
  )
}
