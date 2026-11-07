import { execFile } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { cpus, freemem, homedir, tmpdir, totalmem } from 'node:os'
import { promisify } from 'node:util'

import type { DeviceMetrics } from '../../src/api/device-types.ts'
import type { StatsFs } from 'node:fs'

function cpuTimes() {
  return cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  )
}

/** The fullest filesystem, so a full root disk is not hidden behind a roomy data disk. */
export function fullestDisk(filesystems: Pick<StatsFs, 'blocks' | 'bfree' | 'bsize'>[]) {
  const fullest = filesystems
    .map((fs) => ({ used: (fs.blocks - fs.bfree) * fs.bsize, total: fs.blocks * fs.bsize }))
    .filter((disk) => disk.total > 0)
    .toSorted((a, b) => b.used / b.total - a.used / a.total)
    .at(0)

  if (!fullest) throw new Error('No filesystem could be read')

  return fullest
}

let sample: { at: number; value: Promise<DeviceMetrics | null>; pending: boolean } | undefined

/** Shared by the tunnel's 5-second report and this computer's own devices list; one sample per 5 seconds. */
export function readDeviceMetrics(): Promise<DeviceMetrics | null> {
  if (sample && (sample.pending || Date.now() - sample.at < 5_000)) return sample.value
  const value = (async () => {
    const before = cpuTimes()

    await new Promise((resolve) => setTimeout(resolve, 500))
    const after = cpuTimes()
    const delta = after.total - before.total

    if (delta <= 0) return null
    const total = totalmem()
    let available = freemem()

    if (process.platform === 'linux') {
      const mem = await readFile('/proc/meminfo', 'utf8')
      const match = /^MemAvailable:\s+(\d+)/mu.exec(mem)

      if (match) available = Number(match[1]) * 1024
    }
    if (process.platform === 'darwin') {
      const { stdout } = await promisify(execFile)('/usr/bin/vm_stat', [], {
        timeout: 2_000,
        maxBuffer: 16_384,
      })
      const pageSize = Number(/page size of (\d+) bytes/u.exec(stdout)?.[1])
      const pages = (name: string) =>
        Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'mu').exec(stdout)?.[1] ?? 0)

      if (pageSize > 0)
        available = (pages('free') + pages('inactive') + pages('speculative')) * pageSize
    }
    const paths = [...(process.platform === 'win32' ? [] : ['/']), homedir(), tmpdir()]
    const filesystems = await Promise.all(paths.map((path) => statfs(path).catch(() => null)))

    return {
      sampledAt: new Date().toISOString(),
      cpuPercent: Math.max(0, Math.min(100, (1 - (after.idle - before.idle) / delta) * 100)),
      memory: { used: Math.max(0, Math.min(total, total - available)), total },
      disk: fullestDisk(filesystems.filter((fs) => fs !== null)),
    }
  })().catch(() => null)

  const next = { at: Date.now(), value, pending: true }

  sample = next
  void value.then((result) => {
    next.pending = false
    if (!result) next.at = Date.now()
  })

  return value
}
