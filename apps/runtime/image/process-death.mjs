import { readFileSync as nuphosDeathRead } from 'node:fs'
import { dirname as nuphosDeathDirname } from 'node:path'

// Why the agent's CLI (Claude Code, Codex) died, in words the person can act on.
// A SIGKILL while this cgroup's OOM kill count went up is the memory limit; any
// other death keeps its own reason. Either way the next message resumes the session.
const NUPHOS_CGROUP_ROOT = '/sys/fs/cgroup'

function nuphosDeathText(file) {
  try {
    return nuphosDeathRead(file, 'utf8')
  } catch {
    return null
  }
}

export function nuphosOwnCgroup(procCgroup = nuphosDeathText('/proc/self/cgroup')) {
  const path = procCgroup
    ?.split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3)

  return path ? `${NUPHOS_CGROUP_ROOT}${path}` : null
}

export function nuphosOomKills(cgroup) {
  const events = cgroup && nuphosDeathText(`${cgroup}/memory.events`)

  return Number(/^oom_kill (\d+)$/m.exec(events ?? '')?.[1] ?? 0)
}

/** The tightest memory limit above this cgroup, as "3.5 GB". */
function nuphosMemoryLimit(cgroup) {
  let limit = Infinity

  for (
    let dir = cgroup;
    dir.startsWith(NUPHOS_CGROUP_ROOT) && dir !== NUPHOS_CGROUP_ROOT;
    dir = nuphosDeathDirname(dir)
  ) {
    const max = Number(nuphosDeathText(`${dir}/memory.max`)?.trim())

    if (max > 0 && max < limit) limit = max
  }

  return Number.isFinite(limit) ? `${(limit / 1e9).toFixed(1)} GB` : null
}

const nuphosCgroup = nuphosOwnCgroup()
const nuphosOomKillsAtStart = nuphosOomKills(nuphosCgroup)

export function nuphosProcessDeathMessage(
  agent,
  reason,
  cgroup = nuphosCgroup,
  oomKillsBefore = nuphosOomKillsAtStart,
) {
  const signal = /terminated by signal (\w+)/.exec(reason)?.[1]

  if (signal === 'SIGKILL' && cgroup && nuphosOomKills(cgroup) > oomKillsBefore) {
    const limit = nuphosMemoryLimit(cgroup)

    return `${agent} ran out of memory: this computer's agents reached their memory limit${limit ? ` (${limit})` : ''} and the system stopped it. Send a message to continue.`
  }

  return `${agent} stopped unexpectedly (${reason}). Send a message to continue.`
}
