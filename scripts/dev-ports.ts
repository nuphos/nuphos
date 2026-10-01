// Never steal a busy port — keep bumping until an available one is found.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function isPortFree(port: number): Promise<boolean> {
  try {
    const s = Bun.listen({ hostname: '0.0.0.0', port, socket: { data() {} } })

    s.stop()

    return true
  } catch {
    return false
  }
}

// The backend binds its port a few seconds after spawn, so probing alone lets
// two parallel worktrees pick the same "free" port. An exclusive-create lock
// file reserves a port immediately; stale locks (owner dead) are stolen.
const LOCK_DIR = join(tmpdir(), 'nuphos-dev-port-locks')
const claimedPorts = new Set<number>()
const lockPath = (p: number) => join(LOCK_DIR, `port-${p}`)

function lockOwnerAlive(p: number): boolean {
  try {
    const pid = Number(readFileSync(lockPath(p), 'utf8').trim())

    if (!pid || pid === process.pid) return false
    process.kill(pid, 0) // throws ESRCH if the owner is gone

    return true
  } catch {
    return false
  }
}
function tryClaimPort(p: number): boolean {
  // A lock owned by this process may belong to another service in the same
  // stack. Do not treat it as stale and hand the port out twice.
  if (claimedPorts.has(p)) return false
  try {
    mkdirSync(LOCK_DIR, { recursive: true })
  } catch {
    /* exists */
  }
  try {
    writeFileSync(lockPath(p), String(process.pid), { flag: 'wx' }) // atomic create
    claimedPorts.add(p)

    return true
  } catch {
    if (!lockOwnerAlive(p)) {
      try {
        writeFileSync(lockPath(p), String(process.pid))
        claimedPorts.add(p)

        return true
      } catch {
        /* lost the race */
      }
    }

    return false
  }
}
export function releasePort(p: number) {
  claimedPorts.delete(p)
  try {
    if (Number(readFileSync(lockPath(p), 'utf8').trim()) === process.pid) unlinkSync(lockPath(p))
  } catch {
    /* already gone */
  }
}
export function releaseAllPorts() {
  for (const p of claimedPorts) releasePort(p)
}

export async function findFreePort(
  start: number,
  probe: (port: number) => Promise<boolean> = isPortFree,
): Promise<number> {
  for (let p = start; p < start + 40; p++) {
    if ((await probe(p)) && tryClaimPort(p)) return p
  }

  throw new Error(`no free port found in ${start}-${start + 39}`)
}
