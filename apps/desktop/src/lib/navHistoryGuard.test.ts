import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// A tab's back stack may only be *seeded*, by the helpers that mint a tab. Any
// other `navHistory: [...]` means an in-place navigation threw the user's
// history away and greyed out Back on the very move they just made:
// `retargetWorkspaceTabToNavigation` did exactly that, so clicking a favourite
// (which retargets the current tab) left Back dead, and the Chats page seeded a
// new tab with the team *home* snapshot, so Back from a chat went Home.
// Recording a navigation is `updateTab`'s job — nothing else writes the stack.

const APP = join(import.meta.dirname, '..', 'App.tsx')

// Helpers that mint a tab, and so legitimately seed its history. The test below
// pins that this list does NOT cover the three that reset an existing tab's
// stack — that is the whole point of the guard.
const TAB_FACTORIES = new Set([
  'createWorkspaceTab',
  'createWorkspaceTabFromNavigation',
  // Finishes building a tab the callers assembled in two steps, so the seeded
  // entry has to be replaced with what the tab actually shows. Only ever given
  // freshly-created tabs — it never touches one already on screen.
  'tabOpenedFrom',
  'openLightsailSshTab',
  'openEc2SshTab',
  'openGceSshTab',
])

// A property assignment specifically — `{ navHistory: [...] }`. Anchoring on
// `{`/`,`/line start keeps `persisted.navHistory : []` (a ternary reading the
// stack, not writing it) out of the results.
const SEEDS_HISTORY = /(?:^|[{,])[ \t]*navHistory[ \t]*:[ \t]*\[/gm

/**
 * Name of the function containing `index` — the nearest `function foo(` or
 * `const foo = (`/`useCallback(` above it, at any nesting depth. Callbacks
 * inside the Workspace component need to resolve to themselves, not to
 * `Workspace`, or every seed would land in one bucket.
 */
const FUNCTION_DECL = /(?:^|\n)[ \t]*(?:export[ \t]+)?function[ \t]+([A-Za-z_$][\w$]*)/g
const CONST_FN_DECL =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?const[ \t]+([\w$]+)[ \t]*(?::[^=\n]+)?=[ \t]*(?:useCallback\(|\()/g

function enclosingFunction(src: string, index: number): string {
  const before = src.slice(0, index)
  const declarations = [...before.matchAll(FUNCTION_DECL), ...before.matchAll(CONST_FN_DECL)].sort(
    (a, b) => a.index - b.index,
  )
  const last = declarations[declarations.length - 1]

  return last ? last[1] : '<module>'
}

function seedSites(src: string): { fn: string; line: number }[] {
  return [...src.matchAll(SEEDS_HISTORY)].map((match) => ({
    fn: enclosingFunction(src, match.index),
    line: src.slice(0, match.index).split('\n').length,
  }))
}

test('only tab factories seed navHistory; navigation never resets it', () => {
  const offenders = seedSites(readFileSync(APP, 'utf8')).filter((hit) => !TAB_FACTORIES.has(hit.fn))

  assert.deepEqual(
    offenders.map((o) => `${o.fn}:${o.line}`),
    [],
    'navHistory is seeded outside a tab factory in App.tsx. In-place navigation ' +
      'must let updateTab record the move; a tab opened from another tab must ' +
      'inherit through tabOpenedFrom.',
  )
})

test('the guard actually detects the shapes it claims to', () => {
  const planted = [
    'function retargetWorkspaceTabToNavigation(tab, navigation) {',
    '  return { ...tab, navHistory: [navigation], navHistoryIndex: 0 };',
    '}',
    'function Workspace() {',
    '  const openConversationInNewTab = useCallback((sessionId) => {',
    '    const tabWithSession = { ...tab, navHistory: [tab.navHistory[0]] };',
    '  }, []);',
    '}',
  ].join('\n')

  assert.deepEqual(
    seedSites(planted).map((hit) => hit.fn),
    ['retargetWorkspaceTabToNavigation', 'openConversationInNewTab'],
  )
  assert.equal(
    seedSites(planted).every((hit) => !TAB_FACTORIES.has(hit.fn)),
    true,
    'both planted resets must be reported as offenders',
  )
})
