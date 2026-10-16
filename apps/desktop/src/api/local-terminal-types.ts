export type LocalTerminalEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number }
  // Ends a replay. `resumed`: an earlier view already answered its queries.
  | { id: string; type: 'replayed'; resumed: boolean }

export type TerminalTarget = { teamId: string; sessionId: string }

/** A conversation's desktop on its Box: the X display the Box gave it. */
export type DesktopTarget = TerminalTarget & { display: number }

/** Frames of a desktop stream, base64 RFB bytes; `open` once the backend accepted the viewer. */
export type RuntimeDesktopEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'close' }

export type DockTerminalRequest = { id: string; teamId: string; sessionId: string }
