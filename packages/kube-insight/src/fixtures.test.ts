import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { BUILTIN_RULES, diagnose } from './diagnose/index.ts'
import { podHealth, workloadHealth } from './status/index.ts'

// Every case under fixtures/<area>/<case>/ is plain data: case.json says what
// is tested, input.json holds the Kubernetes objects, expected.json the result.
// KUBE_INSIGHT_UPDATE_FIXTURES=1 rewrites expected.json; review the diff.

const ROOT = path.join(import.meta.dirname, '..', 'fixtures')
const UPDATE = process.env.KUBE_INSIGHT_UPDATE_FIXTURES === '1'

type Case = { description: string; operation: string; params?: { now?: string } }

function cases(area: string) {
  const dir = path.join(ROOT, area)

  return readdirSync(dir).map((name) => {
    const read = (file: string): unknown =>
      JSON.parse(readFileSync(path.join(dir, name, file), 'utf8'))

    return {
      name,
      dir: path.join(dir, name),
      kase: read('case.json') as Case,
      input: read('input.json'),
    }
  })
}

function run(kase: Case, input: unknown): unknown {
  switch (kase.operation) {
    case 'diagnose':
      return diagnose({ ...(input as Parameters<typeof diagnose>[0]), now: kase.params?.now })
    case 'status.pod':
      return podHealth(input as Parameters<typeof podHealth>[0])
    case 'status.workload':
      return workloadHealth(input as Parameters<typeof workloadHealth>[0])
    default:
      throw new Error(`unknown operation ${kase.operation}`)
  }
}

for (const area of ['diagnose', 'status']) {
  describe(`fixtures/${area}`, () => {
    for (const { name, dir, kase, input } of cases(area)) {
      it(`${name}: ${kase.description}`, () => {
        const actual = JSON.parse(JSON.stringify(run(kase, input))) as unknown
        const file = path.join(dir, 'expected.json')

        if (UPDATE) writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)
        assert.deepEqual(actual, JSON.parse(readFileSync(file, 'utf8')))
      })
    }
  })
}

describe('rule coverage', () => {
  it('every built-in rule fires in at least one diagnose fixture', () => {
    const fired = new Set(
      cases('diagnose').flatMap(({ dir }) =>
        (
          JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8')) as { ruleId: string }[]
        ).map((d) => d.ruleId),
      ),
    )

    for (const rule of BUILTIN_RULES) assert.ok(fired.has(rule.id), `${rule.id} has no fixture`)
  })
})
