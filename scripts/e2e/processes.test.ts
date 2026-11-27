import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.E2E_ARTIFACTS = mkdtempSync(join(tmpdir(), 'nuphos-e2e-ports-'))
const { freePorts } = await import('./processes.ts')

// #4394: a stack's ports are closed before they are bound, so a later call must not hand one out again.
test('separate freePorts calls never hand out the same port', async () => {
  const ports = [...(await freePorts(3000)), ...(await freePorts(3000)), ...(await freePorts(3000))]

  assert.equal(new Set(ports).size, ports.length)
})
