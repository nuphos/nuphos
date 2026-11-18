import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { BOX_INSTALL_COMMAND, oneInstallAtATime } from './box-instabox-client'

// The install a Box runs, and runs again after a dropped connection, takes a lock so two never
// run side by side. A process it leaves running must not hold that lock, or the next install
// would wait for it forever. Runs the real shell, as the Box does.

const hasFlock = Bun.spawnSync(['sh', '-c', 'command -v flock']).exitCode === 0
const dirs: string[] = []
const daemons: number[] = []

afterEach(() => {
  for (const pid of daemons.splice(0)) Bun.spawnSync(['kill', String(pid)])
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function lockFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-lock-'))

  dirs.push(dir)

  return path.join(dir, 'install.lock')
}

/** Runs the lines as one script under `shell`; resolves with its stdout. */
async function run(shell: string, lines: string[]) {
  const child = Bun.spawn([shell, '-c', ['set -e', ...lines].join('\n')], { stdout: 'pipe' })

  await child.exited

  return new Response(child.stdout).text()
}

for (const shell of ['bash', 'sh'])
  test.skipIf(!hasFlock)(
    `${shell}: a process an install leaves running does not hold the lock`,
    async () => {
      const lock = lockFile()
      const left = await run(
        shell,
        oneInstallAtATime(['setsid sleep 30 </dev/null >/dev/null 2>&1 & echo $!'], lock),
      )

      daemons.push(Number(left.trim()))
      const started = Date.now()

      expect(await run(shell, oneInstallAtATime(['echo next'], lock))).toBe('next\n')
      expect(Date.now() - started).toBeLessThan(2_000)
    },
  )

test.skipIf(!hasFlock)('a second install waits for the first to finish', async () => {
  const lock = lockFile()
  const first = run(
    'bash',
    oneInstallAtATime(['echo first-start', 'sleep 1', 'echo first-end'], lock),
  )

  await Bun.sleep(200)
  const second = run('bash', oneInstallAtATime(['echo second'], lock))
  const order = (await Promise.all([first, second])).join('')

  expect(order).toBe('first-start\nfirst-end\nsecond\n')
})

test('the Box install takes the lock around everything it runs', () => {
  const lines = BOX_INSTALL_COMMAND.split('\n')

  expect(lines.slice(0, 3)).toEqual(['set -e', 'exec 9>/tmp/nuphos-install.lock && flock 9', '{'])
  expect(lines.at(-1)).toBe('} 9>&-')
})
