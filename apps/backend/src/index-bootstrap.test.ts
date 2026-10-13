import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

// Telemetry must be set up before any module caches a metric instrument, or
// every metric stays a no-op. Import sorting once moved this import down and
// metrics silently stopped being exported.
test('the telemetry bootstrap is the first import of the entrypoint', () => {
  const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
  const firstImport = source.split('\n').find((line) => line.startsWith('import '))

  expect(firstImport).toBe("import '@/otel/bootstrap'")
})
