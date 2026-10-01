// Guard test enforcing the env-var discipline documented in the repo-root
// CLAUDE.md: the config module is the single source of truth for backend env
// vars. "The config module" is `src/config.ts` plus the section files under
// `src/config/` it composes — one surface, split only to keep each file
// readable (and under the max-lines rule).
//
//   1. The config module and .env.example declare EXACTLY the same set of env
//      keys (minus a tiny allowlist of runtime/platform-injected vars).
//   2. No source file outside the config module reads process.env / Bun.env
//      directly. This covers BOTH src/ and scripts/ — the Dockerfile ships
//      scripts/ into the runtime image, so it is not "just dev tooling".
//
// When a PR adds, removes, or renames an env var, it must update BOTH the
// config module and .env.example, or this test fails. If you truly need to read
// an env var elsewhere, the right fix is almost always to expose it on `config`.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const SRC_DIR = import.meta.dir
const APP_DIR = join(SRC_DIR, '..')
const SCRIPTS_DIR = join(APP_DIR, 'scripts')
const CONFIG_PATH = join(SRC_DIR, 'config.ts')
const CONFIG_SECTIONS_DIR = join(SRC_DIR, 'config')
const ENV_EXAMPLE_PATH = join(APP_DIR, '.env.example')

// Runtime/platform-injected vars that config.ts reads but that a user never
// sets in .env — the container runtime, k8s, or the build supplies them. These
// are intentionally NOT documented in .env.example.
const INFRA_ALLOWLIST = new Set([
  'HOSTNAME',
  'TMPDIR',
  'POD_NAMESPACE',
  'NODE_NAME',
  'GIT_SHA',
  'ATLAS_BACKEND_VERSION',
  // Mirrors the Deployment's terminationGracePeriodSeconds, set by the manifest
  // next to the field it echoes rather than by hand.
  'TERMINATION_GRACE_SECONDS',
])

// Files permitted to touch process.env directly. The config module IS the
// source of truth, so config.ts and the sections it imports qualify — the set
// is walked from config.ts rather than listed, so adding a section needs no
// edit here and a file that stops being part of the module loses the exemption
// automatically. Reachability, NOT directory membership, is what grants it: a
// module dropped under src/config/ that config.ts never imports is not part of
// the config module and gets no exemption (and the last test below fails it
// loudly rather than letting it sit there quietly exempt).
// test-preload.ts must seed env before the config singleton freezes (see
// bunfig.toml [test].preload). Test files are also exempt (see isTestFile): the
// rule targets shipped production source, and tests legitimately set env
// fixtures — several already do (oauth, aws-marketplace, run-store).
const BYPASS_ALLOWLIST = new Set([
  ...configModuleFiles().map((f) => f.slice(APP_DIR.length + 1)),
  'src/test-preload.ts',
  // Exported JavaScript source, executed only inside the selected OpenAB
  // container via private Kubernetes exec. Its process.env is the native
  // runtime's environment, never the backend's config. The protocol tests
  // verify that transport/skills secrets are stripped from the adapter env.
  'src/lib/claude-code-preview/runtime-model-probe.ts',
])

// `scripts/` is also scanned (the Dockerfile does `COPY apps/backend/scripts
// ./scripts`, so these files ship inside the image). The entries below are the
// ones audited and consciously exempted; anything NEW added under scripts/ that
// reads process.env trips this test and has to justify itself here.
const SCRIPTS_BYPASS_ALLOWLIST = new Set([
  // Pre-boot launcher shim. `scripts/start-with-tailscale.sh` runs this as a
  // readiness probe BEFORE `bun run src/index.ts` starts, and the sibling shell
  // script reads the same variable straight from the environment. Importing
  // config.ts here would boot (and freeze) the config singleton — including
  // every `required()` check — inside a probe whose whole job is to run before
  // the app exists. The env var IS the interface at this layer.
  'scripts/wait-for-tailscale-dialer.ts',

  // Developer-only harnesses and manual smoke tools. Never imported by src/,
  // never on a request path, and never run in production — they are inside the
  // image only because the Dockerfile copies scripts/ wholesale for the
  // operational one-offs next to them (upload-skills, grandfather-teams, …).
  // They read ad-hoc knobs a developer exports for one run, which is exactly
  // the kind of var that should NOT be in config.ts or .env.example.
  'scripts/agent-drive.ts',
  'scripts/cache-smoke.ts',
  'scripts/test-deploy-flow.ts',
  'scripts/thinking-smoke.ts',
  'scripts/xtrace-webhook.ts',
])

/**
 * Block and line comments out, everything else byte-for-byte. Quote-aware so a
 * `//` inside a string literal (`'https://…'`) is not mistaken for a comment
 * and does not swallow the rest of the line.
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0

  while (i < src.length) {
    const two = src.slice(i, i + 2)

    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)

      i = end === -1 ? src.length : end + 2
      continue
    }
    const ch = src[i]!

    if (ch === "'" || ch === '"' || ch === '`') {
      // Copy the literal whole, honouring backslash escapes, so its contents are
      // never scanned for comment markers.
      out += ch
      i++
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') {
          out += src[i]! + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]!
        i++
      }
      out += src[i] ?? ''
      i++
      continue
    }
    out += ch
    i++
  }

  return out
}

/** `./env` -> `src/config/env.ts`, or null when the specifier leaves the module. */
function resolveConfigImport(fromFile: string, specifier: string): string | null {
  // Only relative specifiers can stay inside the module: `@/lib/...` and bare
  // package imports are by definition somewhere else.
  if (!specifier.startsWith('.')) return null
  const base = join(fromFile, '..', specifier)
  const candidate = [`${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p))

  if (!candidate) return null

  return candidate === CONFIG_PATH || candidate.startsWith(`${CONFIG_SECTIONS_DIR}/`)
    ? candidate
    : null
}

// Every file making up the config module: config.ts plus everything it reaches
// through relative imports, transitively. Both halves of this test read the
// whole set, so a key declared in a section counts exactly as it did when
// config.ts was one file.
//
// Walked rather than globbed on purpose. The exemption below has to track "is
// part of the config module", and a file's directory does not establish that —
// only config.ts importing it does.
function configModuleFiles(): string[] {
  const seen = new Set<string>()
  const queue = [CONFIG_PATH]

  while (queue.length > 0) {
    const file = queue.pop()!

    if (seen.has(file)) continue
    seen.add(file)

    // Comments are stripped first: a `from './x'` written inside one is not an
    // import, and counting it would make a stranded file look reachable — the
    // exact over-inclusion this walk exists to prevent.
    const src = stripComments(readFileSync(file, 'utf8'))

    // `from '...'` covers both `import … from` and `export … from`; the type-only
    // forms match too, which is what we want — a type-only section is still part
    // of the module.
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveConfigImport(file, m[1]!)

      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }

  return [...seen].sort((a, b) => a.localeCompare(b))
}

function configEnvKeys(): Set<string> {
  const src = configModuleFiles()
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  const keys = new Set<string>()
  // Keys passed to the env-reading helpers (\s* spans multi-line calls).
  const helper =
    /(?:required|optional|optionalList|optionalEnum|bool|boundedInt|boundedFloat|modelId)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g
  // Bare process.env.KEY and process.env['KEY'] reads.
  const dot = /process\.env\.([A-Z][A-Z0-9_]+)/g
  const bracket = /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g

  for (const re of [helper, dot, bracket]) {
    for (const m of src.matchAll(re)) keys.add(m[1]!)
  }

  return keys
}

function exampleEnvKeys(): Set<string> {
  const text = readFileSync(ENV_EXAMPLE_PATH, 'utf8')
  const keys = new Set<string>()
  // Match `KEY=` and commented `# KEY=` (optional vars shown with their default
  // still count as documented).
  const re = /^[ \t]*(?:#[ \t]*)?([A-Z][A-Z0-9_]+)=/gm

  for (const m of text.matchAll(re)) keys.add(m[1]!)

  return keys
}

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

function isTestFile(path: string): boolean {
  return (
    path.endsWith('.test.ts') ||
    path.endsWith('.spec.ts') ||
    /(^|\/)(__tests__|tests?)\//.test(path)
  )
}

describe('.env.example ⇄ config module sync', () => {
  test('every config-module env key is documented in .env.example', () => {
    const undocumented = [...configEnvKeys()]
      .filter((k) => !INFRA_ALLOWLIST.has(k))
      .filter((k) => !exampleEnvKeys().has(k))
      .sort((a, b) => a.localeCompare(b))

    expect(
      undocumented,
      `These env vars are read in the config module but missing from .env.example. ` +
        `Add them (or, if runtime-injected, to INFRA_ALLOWLIST):\n  ${undocumented.join('\n  ')}`,
    ).toEqual([])
  })

  test('every .env.example key is actually read by the config module (no dead entries)', () => {
    const configKeys = configEnvKeys()
    const orphans = [...exampleEnvKeys()]
      .filter((k) => !configKeys.has(k))
      .sort((a, b) => a.localeCompare(b))

    expect(
      orphans,
      `These keys are in .env.example but not read by the config module. ` +
        `Remove them or wire them into a config section:\n  ${orphans.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('the config module is the only reader of process.env', () => {
  test('no source file outside the config module reads process.env / Bun.env', () => {
    const offenders: string[] = []
    // Bare word-boundary match so every access form trips: `process.env.X`,
    // `process.env['X']`, `const { X } = process.env`, `const e = process.env`.
    const reader = /\b(?:process\.env|Bun\.env)\b/
    const allowed = new Set([...BYPASS_ALLOWLIST, ...SCRIPTS_BYPASS_ALLOWLIST])

    for (const file of [...listSourceFiles(SRC_DIR), ...listSourceFiles(SCRIPTS_DIR)]) {
      // Label relative to apps/backend so `src/` and `scripts/` are distinct.
      const base = file.slice(APP_DIR.length + 1)

      if (allowed.has(base) || isTestFile(file)) continue
      const text = readFileSync(file, 'utf8')

      if (reader.test(text)) offenders.push(base)
    }
    expect(
      [...offenders].sort((a, b) => a.localeCompare(b)),
      `These files read process.env / Bun.env directly instead of going through ` +
        `the config module. Expose the var on \`config\` and import it:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  test('every file under src/config/ is actually part of the config module', () => {
    // The exemption above follows imports from config.ts, so a file sitting
    // under src/config/ that nothing imports is NOT exempt — it would be
    // reported as an offender with a confusing message, or worse, look exempt
    // to a reader skimming the directory. Either way it does not belong here:
    // src/config/ is the config module's own directory, not a folder of
    // loosely related helpers.
    const reachable = new Set(configModuleFiles())
    const stranded = listSourceFiles(CONFIG_SECTIONS_DIR)
      .filter((f) => !isTestFile(f) && !reachable.has(f))
      .map((f) => f.slice(APP_DIR.length + 1))
      .sort((a, b) => a.localeCompare(b))

    expect(
      stranded,
      `These files live under src/config/ but config.ts never imports them, so ` +
        `they are not part of the config module. Wire them into a section or ` +
        `move them out:\n  ${stranded.join('\n  ')}`,
    ).toEqual([])
  })

  test('no stale entries in the scripts/ allowlist', () => {
    // An exemption that outlives the file it excused silently widens the rule
    // for whatever gets added at that path next.
    const present = new Set(listSourceFiles(SCRIPTS_DIR).map((f) => f.slice(APP_DIR.length + 1)))
    const stale = [...SCRIPTS_BYPASS_ALLOWLIST]
      .filter((f) => !present.has(f))
      .sort((a, b) => a.localeCompare(b))

    expect(
      stale,
      `These files are allowlisted in SCRIPTS_BYPASS_ALLOWLIST but no longer ` +
        `exist. Drop them from the allowlist:\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })
})

test('the remote runtime probe exemption contains only a non-interpolated source constant', () => {
  const source = stripComments(
    readFileSync(join(SRC_DIR, 'lib/claude-code-preview/runtime-model-probe.ts'), 'utf8'),
  ).trim()
  const match = /^export const RUNTIME_MODEL_PROBE = String\.raw`([^`]*)`$/su.exec(source)

  expect(match).not.toBeNull()
  // Never evaluate backend environment reads while constructing the remote program.
  expect(match?.[1]).not.toContain('${')
})
