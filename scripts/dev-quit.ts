// What `q` offers and what each choice stops. Pure: dev.ts feeds it keys and
// facts, then carries out the plan.

export type QuitChoice = 'processes' | 'stop-stack' | 'wipe-stack'

export const QUIT_OPTIONS: readonly { choice: QuitChoice; label: string }[] = [
  { choice: 'processes', label: 'Stop dev processes, keep the local stack running' },
  { choice: 'stop-stack', label: 'Stop everything, keep data' },
  { choice: 'wipe-stack', label: 'Stop everything and wipe local data' },
]

export type QuitMenu = { index: number; confirming: boolean }

export const OPEN_MENU: QuitMenu = { index: 0, confirming: false }

/** The open menu, if any, for the dashboard to draw. */
export const quitMenuView = { menu: null as QuitMenu | null }

const UP = new Set(['\x1b[A', 'k'])
const DOWN = new Set(['\x1b[B', 'j'])
const ENTER = new Set(['\r', '\n'])
const CANCEL = new Set(['\x1b', 'q'])

/** Next menu state for one key; `menu: null` closes it, `quit` ends the run. */
export function menuKey(
  menu: QuitMenu,
  key: string,
): { menu: QuitMenu | null; quit: QuitChoice | null } {
  const last = QUIT_OPTIONS.length - 1

  if (menu.confirming) {
    if (ENTER.has(key) || key === 'y') return { menu, quit: QUIT_OPTIONS[menu.index]!.choice }

    return {
      menu: CANCEL.has(key) || key === 'n' ? { ...menu, confirming: false } : menu,
      quit: null,
    }
  }
  if (CANCEL.has(key)) return { menu: null, quit: null }
  if (UP.has(key)) return { menu: { ...menu, index: Math.max(0, menu.index - 1) }, quit: null }
  if (DOWN.has(key)) return { menu: { ...menu, index: Math.min(last, menu.index + 1) }, quit: null }
  if (!ENTER.has(key)) return { menu, quit: null }
  const { choice } = QUIT_OPTIONS[menu.index]!

  return choice === 'wipe-stack'
    ? { menu: { ...menu, confirming: true }, quit: null }
    : { menu, quit: choice }
}

export type QuitFacts = {
  /** Launchers besides this one that are still running on the shared stack. */
  otherLaunchers: number
  tunnel: 'none' | 'quick' | 'named-ours' | 'named-theirs'
}

export type QuitPlan = {
  compose: 'keep' | 'stop' | 'down'
  /** A stack change skipped because another launcher still uses it. */
  composeHeldBy: number
  killTunnel: boolean
}

export function quitPlan(choice: QuitChoice, facts: QuitFacts): QuitPlan {
  const wanted = choice === 'wipe-stack' ? 'down' : choice === 'stop-stack' ? 'stop' : 'keep'
  const held = wanted !== 'keep' && facts.otherLaunchers > 0
  // A quick tunnel serves only this backend; the named one serves every
  // worktree, so it goes only when this launcher started it and nobody else is left.
  const killTunnel =
    facts.tunnel === 'quick' || (facts.tunnel === 'named-ours' && facts.otherLaunchers === 0)

  return {
    compose: held ? 'keep' : wanted,
    composeHeldBy: held ? facts.otherLaunchers : 0,
    killTunnel,
  }
}

export type TreeRow = { name: string; pid: number | undefined }

/** Every tree ever started, including one whose leader already exited: its
 *  descendants (vite, Electron, bun --hot workers) may still be alive. */
export function treesToStop(rows: readonly TreeRow[]): string[] {
  return rows.filter((row) => row.pid).map((row) => row.name)
}

export function quitSummary(
  stopped: readonly string[],
  plan: QuitPlan,
  facts: QuitFacts,
): string[] {
  const lines = [`stopped: ${stopped.length ? stopped.join(', ') : 'nothing was running'}`]

  if (plan.compose === 'stop') lines.push('stopped: local stack (data kept)')
  if (plan.compose === 'down') lines.push('removed: local stack and its data')
  if (plan.killTunnel) lines.push(`stopped: ${facts.tunnel === 'quick' ? 'quick' : 'named'} tunnel`)
  if (plan.compose === 'keep') {
    const why = plan.composeHeldBy
      ? ` (${String(plan.composeHeldBy)} other launcher(s) still use it)`
      : ''

    lines.push(`still running: local stack${why} — stop with: bun run dev:stop`)
  }
  if (facts.tunnel === 'named-ours' && !plan.killTunnel)
    lines.push(
      "still running: named tunnel (other launchers use it) — stop with: pkill -f 'cloudflared tunnel --config'",
    )
  if (facts.tunnel === 'named-theirs')
    lines.push('still running: named tunnel (it was running before this launcher)')

  return lines
}
