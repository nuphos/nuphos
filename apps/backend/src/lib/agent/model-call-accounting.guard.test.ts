// Static guard over the whole backend: every production model call that
// succeeds must persist an agent_token_usage row, and must AWAIT that write.
//
// Both halves come from the same incident. Reconciling Mongo against the GCP
// billing export for 2026-07-31..08-07 found ~$55.58 of Vertex Claude spend
// with no Mongo row at all — judges and memory jobs that simply never recorded.
// The follow-on hazard is subtler: a detached (`void`) accounting write is
// dropped whenever the process shuts down or the request tears down before it
// settles, so the rows go missing again, and preferentially during a drain.
//
// These are grep guards rather than behavioural tests on purpose: the failure
// mode is a NEW call site forgetting to account, which no existing test can
// observe. Adding a model call to this codebase should fail here until it is
// wired up.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { byCodeUnit } from './sort-order'

const SRC_ROOT = path.join(import.meta.dir, '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)

    if (statSync(full).isDirectory()) return sourceFiles(full)

    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [full] : []
  })
}

function relative(file: string): string {
  return path.relative(SRC_ROOT, file)
}

const PRODUCTION_FILES = sourceFiles(SRC_ROOT)
  .filter((file) => !file.includes(`${path.sep}test${path.sep}`))
  .filter((file) => !file.endsWith('test-preload.ts'))

// Any call that persists token usage, under any of its three entry points.
const ACCOUNTING_CALL = /\b(recordAgentTokenUsageRecords|record[A-Za-z]*TokenUsage)\s*\(/
const DETACHED_ACCOUNTING = /\bvoid\s+(recordAgentTokenUsageRecords|record[A-Za-z]*TokenUsage)\s*\(/
const AWAITED_ACCOUNTING = /\bawait\s+(recordAgentTokenUsageRecords|record[A-Za-z]*TokenUsage)\s*\(/

// A production model call. streamText is included: its usage arrives via
// onFinish, which must still account.
const MODEL_CALL = /\b(generateText|generateObject|streamText|streamObject)\s*\(\s*\{/

// Files that make a model call but legitimately account somewhere else. Each
// needs a reason, and the file it defers to must itself be covered.
const ACCOUNTS_ELSEWHERE: Record<string, string> = {}

describe('no production model call fires its accounting and forgets it', () => {
  test('accounting writes are always awaited, never detached with void', () => {
    const offenders = PRODUCTION_FILES.filter((file) =>
      DETACHED_ACCOUNTING.test(readFileSync(file, 'utf8')),
    ).map(relative)

    expect(offenders).toEqual([])
  })

  test('every file that persists usage awaits at least one of those writes', () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8')

      // The modules that DEFINE the helpers call them under other names.
      if (/token-usage(-side-call)?\.ts$/.test(file)) return false

      return ACCOUNTING_CALL.test(source) && !AWAITED_ACCOUNTING.test(source)
    }).map(relative)

    expect(offenders).toEqual([])
  })
})

describe('every production model call accounts for its tokens', () => {
  test('a file calling generateText/generateObject/streamText records usage', () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8')

      if (!MODEL_CALL.test(source)) return false
      if (relative(file) in ACCOUNTS_ELSEWHERE) return false

      return !ACCOUNTING_CALL.test(source)
    }).map(relative)

    expect(offenders).toEqual([])
  })

  test('the deferred-accounting allowlist stays honest', () => {
    for (const [file, reason] of Object.entries(ACCOUNTS_ELSEWHERE)) {
      const source = readFileSync(path.join(SRC_ROOT, file), 'utf8')

      // Still a model call site — a stale entry must not silently excuse a file
      // that no longer calls a model (or worse, one that now accounts inline).
      expect(MODEL_CALL.test(source)).toBe(true)
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  test('every side-call operation is wired up, by name', () => {
    const operations = PRODUCTION_FILES.flatMap((file) => [
      ...readFileSync(file, 'utf8').matchAll(
        /await recordSideCallTokenUsage\(\{\s+operation: '([^']+)'/g,
      ),
    ])
      .map((match) => match[1])
      .filter((operation): operation is string => operation !== undefined)

    expect(operations.toSorted(byCodeUnit)).toEqual([
      'auto_mode.judge',
      'cost_insight',
      'memory.attribution_judge',
      'memory.conflict',
      'memory.distill',
      'memory.rerank',
      'starter_suggestions',
      'thread_addressing.judge',
    ])
  })

  test('the known model-call sites are all accounted for, by name', () => {
    const accounted = PRODUCTION_FILES.filter((file) => {
      const source = readFileSync(file, 'utf8')

      return MODEL_CALL.test(source) && ACCOUNTING_CALL.test(source)
    }).map(relative)

    expect(accounted.toSorted(byCodeUnit)).toEqual([
      'lib/agent/auto-mode/judge.ts',
      'lib/agent/memory-native/conflict.ts',
      'lib/agent/memory-native/distill.ts',
      'lib/agent/memory-native/rerank.ts',
      'lib/agent/memory-slots/attribution-judge.ts',
      'lib/agent/starter-suggestions.ts',
      'lib/agent/thread-addressing.ts',
      'lib/agent/title-generator.ts',
      'lib/dashboards/insight/model.ts',
    ])
  })
})

// Attribution must come from metadata that is genuinely available at the call
// site. A synthetic `<operation>:<userId>` session is the last resort, not the
// default — a row that cannot be traced to its conversation is much weaker
// evidence during a reconciliation.
describe('memory side calls carry real conversation metadata', () => {
  const read = (file: string) => readFileSync(path.join(SRC_ROOT, file), 'utf8')

  test('the conflict check receives and forwards the triggering conversation', () => {
    expect(read('lib/agent/memory-native/ingest-turn.ts')).toContain(
      'sessionId: digest.conversationId',
    )
    expect(read('lib/agent/memory-native/conflict.ts')).toContain('sessionId: input.sessionId')
  })

  test('both rerank paths pass the conversation through', () => {
    expect(read('lib/agent/memory-native/index.ts')).toContain('sessionId: conversationId')
    expect(read('lib/agent/memory-native/tools-get.ts')).toContain('sessionId: conversationId')
  })

  test('the attribution judge already used the conversation id', () => {
    expect(read('lib/agent/memory-slots/attribution-judge.ts')).toContain(
      'sessionId: input.conversationId',
    )
  })
})
