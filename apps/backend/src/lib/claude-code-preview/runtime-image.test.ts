import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { managedRuntimeImage } from './runtime-image'

import { config } from '@/config'
import { DEFAULT_NUPHOS_RUNTIME_VERSION } from '@/config/claude-code-preview'

const provisioner = config.claudeCodeRuntimeProvisioner
const original = { ...provisioner }
const COMPOSE_DIR = join(import.meta.dir, '../../../../../deploy/compose')

afterEach(() => {
  Object.assign(provisioner, original)
})

test('managed agents run the published nuphos-runtime image of the configured version', () => {
  provisioner.runtimeVersion = '0.2.3'

  expect(managedRuntimeImage('claude-code')).toBe('ghcr.io/zeabur/nuphos-runtime:0.2.3-claude-code')
  expect(managedRuntimeImage('codex')).toBe('ghcr.io/zeabur/nuphos-runtime:0.2.3-codex')
})

test('self-hosted compose pins the release managed agents default to', () => {
  const tag = `${DEFAULT_NUPHOS_RUNTIME_VERSION}-claude-code`

  expect(readFileSync(join(COMPOSE_DIR, 'docker-compose.yml'), 'utf8')).toContain(
    `ghcr.io/zeabur/nuphos-runtime:\${RUNTIME_TAG:-${tag}}`,
  )
  expect(readFileSync(join(COMPOSE_DIR, '.env.example'), 'utf8')).toContain(`RUNTIME_TAG=${tag}\n`)
})

test('a user-requested runtime upgrade survives reconciliation without downgrading a newer fleet default', () => {
  provisioner.runtimeVersion = '0.1.2'
  expect(managedRuntimeImage('codex', '0.1.4')).toBe('ghcr.io/zeabur/nuphos-runtime:0.1.4-codex')
  provisioner.runtimeVersion = '0.1.5'
  expect(managedRuntimeImage('codex', '0.1.4')).toBe('ghcr.io/zeabur/nuphos-runtime:0.1.5-codex')
  expect(managedRuntimeImage('codex', 'latest')).toBe('ghcr.io/zeabur/nuphos-runtime:0.1.5-codex')
})
