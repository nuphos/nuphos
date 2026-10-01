// Process-wide lifecycle state. Flipped on the first SIGTERM/SIGINT so the
// readiness probe can return 503 before we actually stop accepting traffic,
// giving the load balancer time to deregister this pod from the Service.

let _shuttingDown = false

export function isShuttingDown(): boolean {
  return _shuttingDown
}

export function markShuttingDown(): void {
  _shuttingDown = true
}

/**
 * Abort reason for a run a draining replica lets go of. The runtime keeps the
 * turn going; another replica picks up its remaining output.
 */
export class RunHandoff extends Error {
  override name = 'RunHandoff'
}
