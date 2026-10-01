import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// npm's node-pty prebuilds can lose the helper's executable bit on unpack.
const require = createRequire(import.meta.url)
const root = dirname(require.resolve('node-pty/package.json'))

for (const arch of ['arm64', 'x64']) {
  const helper = join(root, 'prebuilds', `darwin-${arch}`, 'spawn-helper')

  if (existsSync(helper)) chmodSync(helper, 0o755)
}
