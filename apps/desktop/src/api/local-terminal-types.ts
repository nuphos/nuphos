export type LocalTerminalEvent =
  { id: string; type: 'data'; data: string } | { id: string; type: 'exit'; code: number }
