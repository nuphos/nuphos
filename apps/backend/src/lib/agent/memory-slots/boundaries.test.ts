// T7: dependency-rule grep guards for the Memory Provider SPI (spec §
// "Module layout and the dependency rule", enforcement layer 2 — the ESLint
// no-restricted-imports zones are deferred; this is the env-sync-test
// precedent applied to module boundaries). Rules:
//
//   (a) memory-native/** importable only from memory-slots/native.ts and
//       from inside memory-native itself — plus a shrinking allowlist below.
//   (b) the SPI file-set (types.ts + types-*.ts) imports nothing but 'ai'
//       and its own members.
//   (c) only memory-slots/index.ts imports the native provider bundle.
//   (d) provider code (memory-native/** + memory-slots/native.ts) never
//       references memory_runtime_* collections nor imports attribution-*
//       (checklist item 10: no effectiveness writes).
//   (e) Phase 2 call-site guard (checklist item 12): the chat/tool call sites
//       import memory symbols exclusively from memory-slots/**.
//
// Production sources only — test files legitimately mock across boundaries.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, test } from 'bun:test'

const SRC_DIR = join(import.meta.dir, '..', '..', '..')

// ── Rule (a) allowlists ─────────────────────────────────────────────────────

// Phase 2 PR 3 emptied the call-site allowlist: the chat path (recall, tools,
// finalizer, save frames) now resolves everything through the memory-slots
// runtime. What remains is the single grandfathered import below.

// REMOVAL TRIGGER — delete after one release cycle (once every live desktop
// has re-fetched its historical chips at least once, ~one release after the
// PR 3 deploy): routes/agent/routes-memories.ts keeps ONE memory-native import,
// listAutoLearnedIngestItems, as the GET /memories/ingest/:sessionId fallback
// for conversations that predate memory_runtime_ingest_events snapshots (the
// desktop's MemoryIngestPartView fetches by eventId when a persisted chip has
// no inline memories — that can target pre-deploy turns). Exact (file,
// specifier) pair: any other memory-native import in that file fails.
const INGEST_FALLBACK_GRANDFATHER = {
  file: 'routes/agent/routes-memories.ts',
  specifier: '@/lib/agent/memory-native/records-api',
}

/** The one sanctioned (file, specifier) exemption — shared by rules (a) and
 * (e) so the two checks can never drift apart. */
const isGrandfatheredIngestFallback = (rel: string, specifier: string): boolean =>
  rel === INGEST_FALLBACK_GRANDFATHER.file && specifier === INGEST_FALLBACK_GRANDFATHER.specifier

// Track A grandfather: the runtime-owned measurement layer predates the SPI
// and still leans on native types/handles. Shrinks with the Track B refactor
// that makes attribution fully provider-neutral.
const ATTRIBUTION_GRANDFATHER = new Set([
  'lib/agent/memory-slots/attribution-store.ts', // teamMemories handle for retention rollup
  'lib/agent/memory-slots/attribution-judge.ts', // AutomaticRecallEntry type
  'lib/agent/memory-slots/attribution-types.ts', // TeamMemoryApplicationAction type
])

// ── Rule (d) grandfather ────────────────────────────────────────────────────

// Exact shipped line: the retention-ranking read is the ONE sanctioned
// native→attribution-store touch point until rerank ordering moves
// runtime-side. Any drift from this precise (file, line) pair fails.
const RULE_D_GRANDFATHER = {
  file: 'lib/agent/memory-native/index.ts',
  line: "import { fetchRetentionOrderScores } from '../memory-slots/attribution-store'",
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function listSourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)

    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }

  return out
}

function isTestFile(path: string): boolean {
  return (
    path.endsWith('.test.ts') ||
    path.endsWith('.spec.ts') ||
    /(^|\/)(__tests__|tests?)\//.test(path)
  )
}

const productionFiles = (): { rel: string; text: string }[] =>
  listSourceFiles(SRC_DIR)
    .filter((f) => !isTestFile(f))
    .map((f) => ({ rel: relative(SRC_DIR, f), text: readFileSync(f, 'utf8') }))

const isCommentLine = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/** Every module specifier in import/export-from/dynamic-import position.
 * Comment lines are dropped first: prose like "moved from './memory-native'"
 * or a commented-out import must not produce false offenders — a guard that
 * fails for the wrong reason is worse than one that misses. */
function importSpecifiers(text: string): string[] {
  const code = text
    .split('\n')
    .filter((line) => !isCommentLine(line))
    .join('\n')
  const out: string[] = []
  // `\s` spans newlines and `^` is multiline, so `^\s*` could start on any
  // earlier blank line and cover the same text — that ambiguity is what made
  // this pattern backtrack super-linearly. Leading indentation is only ever
  // spaces or tabs.
  const re = /(?:from\s*|import\s*\(\s*|^[ \t]*import\s+)['"](?=([^'"]+))\1['"]/gm

  for (const m of code.matchAll(re)) out.push(m[1]!)

  return out
}

// ── The rules ───────────────────────────────────────────────────────────────

describe('memory SPI dependency rules (grep guards)', () => {
  test('(a) memory-native/** importable only from native.ts, itself, and the shrinking allowlist', () => {
    const offenders: string[] = []

    for (const { rel, text } of productionFiles()) {
      if (rel.startsWith('lib/agent/memory-native/')) continue
      if (rel === 'lib/agent/memory-slots/native.ts') continue
      if (ATTRIBUTION_GRANDFATHER.has(rel)) continue
      const hits = importSpecifiers(text)
        .filter((s) => /(?:^|\/)memory-native(?:\/|$)/.test(s))
        .filter((s) => !isGrandfatheredIngestFallback(rel, s))

      if (hits.length > 0) offenders.push(`${rel} → ${hits.join(', ')}`)
    }
    expect(
      offenders,
      `These production files import memory-native directly. Route through the ` +
        `memory-slots SPI instead (or, for a Phase 2 call-site still mid-swap, ` +
        `extend the allowlist consciously):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test("(b) the SPI file-set imports nothing but 'ai' and its own members", () => {
    const SPI_FILES = ['types.ts', 'types-events.ts', 'types-ingest.ts', 'types-records.ts']
    const allowed = new Set([
      'ai',
      './types',
      './types-events',
      './types-ingest',
      './types-records',
    ])

    for (const file of SPI_FILES) {
      const text = readFileSync(join(SRC_DIR, `lib/agent/memory-slots/${file}`), 'utf8')
      const specifiers = importSpecifiers(text)

      expect(specifiers.length).toBeGreaterThan(0)
      expect(
        specifiers.filter((s) => !allowed.has(s)),
        `${file} may import only 'ai' or SPI file-set members`,
      ).toEqual([])
    }
  })

  test('(c) only memory-slots/index.ts imports the native provider bundle', () => {
    const offenders: string[] = []

    for (const { rel, text } of productionFiles()) {
      if (rel === 'lib/agent/memory-slots/index.ts') continue
      if (rel === 'lib/agent/memory-slots/native.ts') continue // self
      const inSlotsDir = rel.startsWith('lib/agent/memory-slots/')
      const hits = importSpecifiers(text).filter(
        (s) =>
          s.endsWith('memory-slots/native') ||
          (inSlotsDir && (s === './native' || s === './native.ts')),
      )

      if (hits.length > 0) offenders.push(`${rel} → ${hits.join(', ')}`)
    }
    expect(
      offenders,
      `Provider bundles are registry-resolved; only memory-slots/index.ts may ` +
        `import an adapter:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('(d) provider code never touches memory_runtime_* or attribution-* (item 10)', () => {
    const offenders: string[] = []

    for (const { rel, text } of productionFiles()) {
      const isProviderCode =
        rel.startsWith('lib/agent/memory-native/') || rel === 'lib/agent/memory-slots/native.ts'

      if (!isProviderCode) continue
      // Import side: attribution-* modules are runtime-owned.
      for (const spec of importSpecifiers(text)) {
        if (!spec.includes('attribution-')) continue
        const grandfathered =
          rel === RULE_D_GRANDFATHER.file &&
          text.split('\n').some((l) => l.trim() === RULE_D_GRANDFATHER.line)

        if (grandfathered && spec === '../memory-slots/attribution-store') continue
        offenders.push(`${rel} imports ${spec}`)
      }
      // Collection side: memory_runtime_* is the runtime's measurement plane.
      // Comment-only mentions are documentation, not access.
      text.split('\n').forEach((line, i) => {
        if (isCommentLine(line)) return
        if (line.includes('memory_runtime_'))
          offenders.push(`${rel}:${String(i + 1)} references memory_runtime_`)
      })
    }
    expect(
      offenders,
      `Provider code paths must never write or read the runtime measurement ` +
        `plane (decision 6 — no effectiveness self-report):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('(d-fixture) the grandfathered import still exists exactly as encoded', () => {
    // If the retention-ranking import moves or is rewritten, the grandfather
    // above silently stops matching anything — this test forces the encoded
    // line to track reality (either update both or delete both).
    const text = readFileSync(join(SRC_DIR, RULE_D_GRANDFATHER.file), 'utf8')

    expect(text.split('\n').some((l) => l.trim() === RULE_D_GRANDFATHER.line)).toBe(true)
  })

  test('(e) call sites import memory symbols only from memory-slots/', () => {
    // Checklist item 12: after the Phase 2 call-site swap, routes/agent.ts,
    // tools-skilled.ts (chat/tools path) and models.ts (setup path) import
    // memory symbols exclusively from memory-slots/**. The one exception is
    // the grandfathered ingest fallback (INGEST_FALLBACK_GRANDFATHER above).
    // Entry files or their split-module directories (routes/agent/**, tools-skilled/**).
    const CALL_SITES = ['routes/agent', 'lib/agent/tools-skilled', 'models.ts']
    const offenders: string[] = []

    for (const { rel, text } of productionFiles()) {
      const isCallSite = CALL_SITES.some(
        (site) => rel === site || rel === `${site}.ts` || rel.startsWith(`${site}/`),
      )

      if (!isCallSite) continue
      // Relative specifiers are call-site-internal siblings; each sibling's own
      // imports are checked by this same loop.
      const hits = importSpecifiers(text)
        .filter((s) => !s.startsWith('.'))
        .filter((s) => s.includes('memory'))
        .filter((s) => !/(?:^|\/)memory-slots(?:\/|$)/.test(s))
        .filter((s) => !isGrandfatheredIngestFallback(rel, s))

      if (hits.length > 0) offenders.push(`${rel} → ${hits.join(', ')}`)
    }
    expect(
      offenders,
      `Call sites resolve memory through the memory-slots SPI only:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('(e-fixture) the grandfathered ingest-fallback import still exists exactly as encoded', () => {
    // Same forcing function as (d-fixture): when the fallback import is
    // removed (its REMOVAL TRIGGER above), this test forces deleting the
    // grandfather too instead of leaving a silent no-op allowlist entry.
    const text = readFileSync(join(SRC_DIR, INGEST_FALLBACK_GRANDFATHER.file), 'utf8')
    const specifiers = importSpecifiers(text)

    expect(specifiers).toContain(INGEST_FALLBACK_GRANDFATHER.specifier)
  })
})
