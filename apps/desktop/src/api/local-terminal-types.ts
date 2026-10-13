export type LocalTerminalEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number }
  // Ends a replay. `resumed`: an earlier view already answered its queries.
  | { id: string; type: 'replayed'; resumed: boolean }

export type TerminalTarget = { teamId: string; sessionId: string }

export type DockTerminalRequest = { id: string; teamId: string; sessionId: string }
