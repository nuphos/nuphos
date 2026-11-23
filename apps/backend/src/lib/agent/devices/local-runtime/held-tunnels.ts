/** Service Restart: the computer redials at once and reaches a replica that is still serving. */
export const TUNNEL_CLOSE_RESTART = 1012

/** Each tunnel this replica holds right now, by the function that closes it. */
export const heldTunnels = new Set<(code: number, reason: string) => void>()

/** Computers whose tunnel this replica holds right now. */
export function connectedComputerCount(): number {
  return heldTunnels.size
}

/**
 * Closes every tunnel held here before shutdown, so its computer moves to another
 * replica instead of being cut when the server is force-stopped. Spread over
 * `spreadMs` so the computers do not all redial at once; resolves once the last is closed.
 */
export async function closeTunnelsForRestart(spreadMs = 2_000): Promise<void> {
  const shuts = [...heldTunnels]

  await Promise.all(
    shuts.map(
      (shut, i) =>
        new Promise<void>((resolve) => {
          setTimeout(
            () => {
              shut(TUNNEL_CLOSE_RESTART, 'Server restarting')
              resolve()
            },
            (spreadMs * i) / shuts.length,
          )
        }),
    ),
  )
}
