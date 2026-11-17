import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { MESSAGES } from './index.ts'

// People meet Bots and Tasks, never "agents" (#3246). AWS names its own ECS container agent.
const SRC = join(import.meta.dirname, '..')
const AWS_TERMS = new Set([join(SRC, 'views', 'ecs', 'EcsInfrastructureView.tsx')])
const label = /\bt\(\s*'Agents?'/g

test('no label names an agent', () => {
  const found = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.'),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !AWS_TERMS.has(path))
    .flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(label)].map((m) => `${path}: ${m[0]}`),
    )

  assert.deepEqual(found, [])
})

test('no locale shows a bare "Agent" except for AWS', () => {
  const bare = Object.entries(MESSAGES).flatMap(([code, messages]) =>
    Object.entries(messages)
      .filter(([key, value]) => /^Agents?$/.test(value.trim()) && key !== 'Agent')
      .map(([key]) => `${code}: ${key}`),
  )

  assert.deepEqual(bare, [])
})
