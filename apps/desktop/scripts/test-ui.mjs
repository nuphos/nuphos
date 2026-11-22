import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Every component test, each in its own `bun test` process: their `mock.module`
// registrations are process-wide. Found by name, so a new test runs without
// editing a shared list that every pull request appends to.
const files = globSync('src/**/*.test.tsx')
  .map((file) => file.replaceAll('\\', '/'))
  .sort()

for (const file of files) {
  const { status } = spawnSync('bun', ['test', file], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (status !== 0) process.exit(status ?? 1)
}
