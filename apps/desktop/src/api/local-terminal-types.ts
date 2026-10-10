export type LocalTerminalEvent =
  { id: string; type: 'data'; data: string } | { id: string; type: 'exit'; code: number }

export type TerminalTarget = { teamId: string; sessionId: string }

export type DockTerminalRequest = { id: string; teamId: string; sessionId: string }
