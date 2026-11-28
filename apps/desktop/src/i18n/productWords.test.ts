import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

import { MESSAGES } from './index.ts'

// People meet Bots and Tasks, never "agents" (#3246). AWS names its own ECS container agent.
const SRC = join(import.meta.dirname, '..')
const AWS_TERMS = new Set(['views/ecs/EcsInfrastructureView.tsx'])
// The AI data notice reads word for word as the versioned notice iOS shows and the account accepts.
const LEGAL_NOTICE = new Set(['views/onboarding/AIConsentStep.tsx'])
// Names that contain the word but are not about agents: ssh-agent, AGENTS.md, a log file, a skills folder.
const NAMES = /ssh-agent|AGENTS\.md|nuphos-agent\.log|~\/\.agents\//g
const call = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

const sources = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.'))
  .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
  .filter((path) => !AWS_TERMS.has(path) && !LEGAL_NOTICE.has(path))
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

// Every machine is a computer; there is no "cloud computer" (or cloud machine) beside it.
const CLOUD_COMPUTER = [
  /cloud[ -]?(?:computer|machine)/iu,
  /(?:computer|machine)s? in the cloud/iu,
  /雲端電腦|雲電腦|云电脑|云端电脑|雲端 ?Linux/u,
  /クラウドコンピュータ|クラウド上の(?:Linux )?(?:マシン|コンピュータ)/u,
  /클라우드 컴퓨터/u,
  /(?:computadora|ordenador|máquina)\w* (?:Linux )?en la nube/iu,
  /komputer cloud|(?:mesin|komputer) (?:Linux )?di cloud/iu,
  /คอมพิวเตอร์คลาวด์|บนคลาวด์ที่มี/u,
]
const saysCloudComputer = (text: string) => CLOUD_COMPUTER.some((pattern) => pattern.test(text))

test('no text or translation calls a computer a cloud computer', () => {
  const found = [
    ...sources.flatMap((path) =>
      keys(path)
        .filter((key) => saysCloudComputer(key))
        .map((key) => `${path}: ${key}`),
    ),
    ...Object.entries(MESSAGES).flatMap(([code, messages]) =>
      Object.entries(messages)
        .filter(([key, value]) => saysCloudComputer(key) || saysCloudComputer(value))
        .map(([key]) => `${code}: ${key}`),
    ),
  ]

  assert.deepEqual(found, [])
})
