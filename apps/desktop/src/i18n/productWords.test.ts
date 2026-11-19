import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

import { MESSAGES } from './index.ts'

// People meet Bots and Tasks, never "agents" (#3246). AWS names its own ECS container agent.
const SRC = join(import.meta.dirname, '..')
const AWS_TERMS = new Set(['views/ecs/EcsInfrastructureView.tsx'])
// Names that contain the word but are not about agents: ssh-agent, AGENTS.md, a log file, a skills folder.
const NAMES = /ssh-agent|AGENTS\.md|nuphos-agent\.log|~\/\.agents\//g
const call = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

const sources = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.'))
  .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
  .filter((path) => !AWS_TERMS.has(path))
const keys = (path: string) =>
  [...readFileSync(join(SRC, path), 'utf8').matchAll(call)].map((m) => m[2])

test('no label names an agent', () => {
  const found = sources.flatMap((path) =>
    keys(path)
      .filter((key) => /^Agents?$/.test(key))
      .map((key) => `${path}: ${key}`),
  )

  assert.deepEqual(found, [])
})

test('no text names an agent', () => {
  const found = sources.flatMap((path) =>
    keys(path)
      .filter((key) => /\bagents?\b/i.test(key.replace(NAMES, '')))
      .map((key) => `${path}: ${key}`),
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
