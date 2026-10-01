// Guard test for the module-doubling discipline. bun's module-mock registry is
// PROCESS-WIDE, so a stub one test file installs is live for every file that
// runs after it — and bun discovers files in a different order on macOS than on
// CI Linux, so two files doubling the same module pass or fail by platform.
//
// src/lib/test/doubles/ gives each module ONE registration resolved per call.
//
// The registry is only reachable through the `bun:test` module — bun exposes no
// global for it — so this guard is anchored on the import rather than on call
// sites: import syntax cannot be computed, whereas a call site can be aliased.
// `bun:test` exports three handles onto the same registry: `mock.module()`,
// `jest.mock()` and `vi.mock()`.
//
// Known limit: a file could still obfuscate the specifier (`import('bun' +
// ':test')`). Nothing here catches that.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const TEST_DIR = import.meta.dir
const SRC_DIR = join(TEST_DIR, '..', '..')
const APP_DIR = join(SRC_DIR, '..')
const DOUBLES_DIR = 'src/lib/test/doubles'
// Excluded from the scan: this file's patterns and failure messages spell out
// the very calls it bans.
const SELF = 'src/lib/test/mock-module-guard.test.ts'

// The only files allowed to reach the registry from outside doubles/. Every
// entry is a file whose stub survives into later test files, so adding one is a
// real cost — prefer restructuring the test. The reason string says why the
// registry cannot express what it needs.
const ALLOWLIST = new Map<string, string>([
  [
    'src/lib/agent/memory-slots/native.test.ts',
    '@/config is a value export (export const config), not interceptable by buildDouble',
  ],
  [
    'src/lib/agent/memory-slots/native.conformance.test.ts',
    '@/config is a value export (export const config), not interceptable by buildDouble',
  ],
  [
    'src/lib/byos/gcp-wif.test.ts',
    '@/config is a value export (export const config), not interceptable by buildDouble',
  ],
  [
    'src/lib/byos/huawei.test.ts',
    '@/config is a value export (export const config), not interceptable by buildDouble',
  ],
  [
    'src/lib/agent/tools-team-skills.e2e.test.ts',
    'stubs a static on the SkillsS3Client class, which buildDouble passes through by design',
  ],
])

function listSourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }

  return out
}

// Comments routinely *discuss* these calls, parentheses and all, so matching
// raw text would flag prose.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*/gm, '$1')
}

function stripQuotedStrings(text: string): string {
  return text.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
}

const BUN_TEST_MENTION = /['"`]bun:test['"`]/g
const BUN_TEST_IMPORT = /\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]bun:test['"]/g
// mock.module(), jest.mock() and vi.mock() are three doors onto one registry.
const REGISTRY_HANDLES = new Set(['mock', 'jest', 'vi', 'default'])
const RESTORE = /\bmock\s*\.\s*(?:restore|clearAllMocks)\s*\(/

function relative(file: string): string {
  return file.slice(APP_DIR.length + 1)
}

/** Every src/ .ts file this guard inspects, by repo-relative path (minus itself). */
function scannedFiles(): string[] {
  return listSourceFiles(SRC_DIR)
    .map(relative)
    .filter((file) => file !== SELF)
    .sort((a, b) => a.localeCompare(b))
}

function sourceOf(file: string): string {
  return stripComments(readFileSync(join(APP_DIR, file), 'utf8'))
}

type Binding = { imported: string; local: string }

function bunTestBindings(source: string): Binding[] {
  const out: Binding[] = []

  for (const match of source.matchAll(BUN_TEST_IMPORT)) {
    for (const raw of match[1]!.split(',')) {
      const clause = raw.trim().replace(/^type\s+/, '')

      if (!clause) continue
      const [imported, local] = clause.replace(/\s+/g, ' ').split(' as ')

      out.push({ imported: imported!.trim(), local: (local ?? imported)!.trim() })
    }
  }

  return out
}

/**
 * Every use of the `mock` identifier that is not the plain spy factory
 * `mock(...)`, with the surrounding text so the failure names what it found.
 * Property reads (`spy.mock.calls`) are not uses of the import.
 */
function mockIdentifierUses(source: string): string[] {
  const code = stripQuotedStrings(source.replace(BUN_TEST_IMPORT, ''))
  const out: string[] = []

  for (const match of code.matchAll(/(.{0,12})\bmock\b(.{0,18})/gs)) {
    if (/^\s*\(/.test(match[2]!)) continue
    if (/\.\s*$/.test(match[1]!)) continue
    out.push(`mock${match[2]!.replace(/\s+/g, ' ')}`.trim())
  }

  return out
}

function reachesRegistry(file: string): boolean {
  return mockIdentifierUses(sourceOf(file)).length > 0
}

/** Every doubles/ file with the module specifiers it registers, in scan order. */
function registrationsByFile(): [string, string[]][] {
  return scannedFiles()
    .filter((file) => file.startsWith(DOUBLES_DIR))
    .map((file) => [
      file,
      [...sourceOf(file).matchAll(/\bmock\s*\.\s*module\s*\(\s*'([^']+)'/g)].map((m) => m[1]!),
    ])
}

describe('the bun:test import is the only door to the module registry', () => {
  test('every bun:test reference is a plain named import', () => {
    const offenders: string[] = []

    for (const file of scannedFiles()) {
      const source = sourceOf(file)
      const mentions = (source.match(BUN_TEST_MENTION) ?? []).length
      const imports = [...source.matchAll(BUN_TEST_IMPORT)].length

      if (mentions !== imports)
        offenders.push(`${file} (${String(mentions)} references, ${String(imports)} named imports)`)
    }
    expect(
      offenders,
      `bun:test must be reached with a static \`import { … } from 'bun:test'\` and ` +
        `nothing else. A namespace import, a default import, require() or a dynamic ` +
        `import hands the file the whole module — including the registry — past every ` +
        `check below:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('the registry handles are never aliased, and only mock is imported', () => {
    const offenders: string[] = []

    for (const file of scannedFiles()) {
      for (const { imported, local } of bunTestBindings(sourceOf(file))) {
        if (imported !== 'mock' && REGISTRY_HANDLES.has(imported)) {
          offenders.push(`${file} imports \`${imported}\``)
        } else if (imported === 'mock' && local !== 'mock') {
          offenders.push(`${file} imports \`mock as ${local}\``)
        }
      }
    }
    expect(
      offenders,
      `\`jest\` and \`vi\` are bun's compatibility handles onto the same process-wide ` +
        `registry (jest.mock() / vi.mock() register a module exactly as mock.module() ` +
        `does), and an alias hides \`mock\` from the identifier check. Import \`mock\` ` +
        `under its own name, and nothing else:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('the module registry goes through the shared doubles', () => {
  test('outside src/lib/test/doubles/, mock is only ever the spy factory', () => {
    const offenders: string[] = []

    for (const file of scannedFiles()) {
      if (file.startsWith(DOUBLES_DIR) || ALLOWLIST.has(file)) continue
      for (const use of mockIdentifierUses(sourceOf(file))) offenders.push(`${file}: ${use}`)
    }
    expect(
      offenders,
      `Outside ${DOUBLES_DIR}/ the \`mock\` import may only be called as \`mock(fn)\` ` +
        `to make a spy. Anything else — \`mock.module(…)\`, \`mock['module'](…)\`, ` +
        `\`mock?.module(…)\`, or copying it into another binding — reaches the ` +
        `process-wide registry, so the stub leaks into every test file that runs later ` +
        `and the winner is decided by file order, which differs between macOS and CI ` +
        `Linux. Add a double under ${DOUBLES_DIR}/ (copy an existing one, change the ` +
        `specifier) and call its use*() installer instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('inside src/lib/test/doubles/, mock only ever registers a module', () => {
    const offenders: string[] = []

    for (const file of scannedFiles().filter((f) => f.startsWith(DOUBLES_DIR))) {
      for (const use of mockIdentifierUses(sourceOf(file))) {
        if (!use.startsWith('mock.module(')) offenders.push(`${file}: ${use}`)
      }
    }
    expect(
      offenders,
      `A file in ${DOUBLES_DIR}/ may only use \`mock\` as \`mock.module(…)\` or ` +
        `\`mock(fn)\`:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('every double registers exactly one module, and only its own', () => {
    const wrong: string[] = []

    for (const [file, specs] of registrationsByFile()) {
      if (specs.length !== 1)
        wrong.push(`${file} (registers ${String(specs.length)} modules, expected 1)`)
    }
    expect(
      wrong,
      `Each file in ${DOUBLES_DIR}/ must register exactly one module:\n  ${wrong.join('\n  ')}`,
    ).toEqual([])
  })

  // The specifier is compared as written, so two spellings of one module —
  // '@/lib/byos/gcp' and './../../byos/gcp' — would read as two modules and slip
  // past the collision check below. Pinning every double to the '@/' form makes
  // the written specifier canonical, so string equality is enough.
  test('every double registers its module by its @/ specifier', () => {
    const offenders: string[] = []

    for (const [file, specs] of registrationsByFile()) {
      for (const spec of specs.filter((s) => !s.startsWith('@/'))) {
        offenders.push(`${file} registers '${spec}'`)
      }
    }
    expect(
      offenders,
      `A double must name its module by the '@/' alias. A relative specifier is the ` +
        `same module under a different string, which would let two doubles claim it ` +
        `without colliding by name:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('no module is registered by two different doubles', () => {
    const claimants = new Map<string, string[]>()

    for (const [file, specs] of registrationsByFile()) {
      for (const spec of specs) claimants.set(spec, [...(claimants.get(spec) ?? []), file])
    }
    const collisions = [...claimants]
      .filter(([, files]) => files.length > 1)
      .map(([spec, files]) => `${spec} <- ${files.join(', ')}`)
      .sort((a, b) => a.localeCompare(b))

    expect(
      collisions,
      `Two doubles registering one module is the process-wide collision this whole ` +
        `directory exists to prevent: the second mock.module() replaces the first, so ` +
        `one file's installer writes to a registry nothing reads and its overrides ` +
        `silently do nothing. Keep one double per module and have both suites import ` +
        `it — extend the existing double rather than adding a second:\n  ${collisions.join('\n  ')}`,
    ).toEqual([])
  })

  test('no file calls mock.restore() / mock.clearAllMocks()', () => {
    const offenders = scannedFiles().filter((file) => RESTORE.test(sourceOf(file)))

    expect(
      offenders,
      `mock.restore() clears the whole process-wide registry, including doubles ` +
        `belonging to other test files. The installers returned by makeInstaller ` +
        `already reset in beforeEach and tear down in afterAll:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('the allowlist cannot rot', () => {
  test('every allowlisted file still exists', () => {
    const present = new Set(scannedFiles())
    const stale = [...ALLOWLIST.keys()]
      .filter((file) => !present.has(file))
      .sort((a, b) => a.localeCompare(b))

    expect(
      stale,
      `These files are in ALLOWLIST but no longer exist. Drop them:\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })

  test('every allowlisted file still reaches the registry', () => {
    const present = new Set(scannedFiles())
    const unused = [...ALLOWLIST.keys()]
      .filter((file) => present.has(file) && !reachesRegistry(file))
      .sort((a, b) => a.localeCompare(b))

    expect(
      unused,
      `These files are in ALLOWLIST but no longer register a module — they have been ` +
        `migrated to ${DOUBLES_DIR}/. Remove their entries so the exemption cannot be ` +
        `reused by a future edit:\n  ${unused.join('\n  ')}`,
    ).toEqual([])
  })
})
