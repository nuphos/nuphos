/**
 * Two console lines per tab switch: when a tab in the strip is clicked, and
 * when that tab has become the active one. The active line carries the delta,
 * so the pair reads as "how long the click took to land".
 *
 * On in the dev build. In a packaged app, turn it on with
 *   localStorage.setItem('nuphos.debug.tabSwitch', '1')
 * and reload.
 */
function enabled(): boolean {
  try {
    if (localStorage.getItem('nuphos.debug.tabSwitch') === '1') return true
  } catch {
    // localStorage can throw in a locked-down context; fall through to DEV.
  }

  return import.meta.env.DEV
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, width = 2) => String(n).padStart(width, '0')

  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

type Pending = {
  tabId: string
  at: number
  /** Set when the activation effect ran — the boundary between commit and tail. */
  effectAt: number | null
  prePaneMs: number
  preOtherMs: number
  postPaneMs: number
  postOtherMs: number
  /** Pre-effect render time per pane id — names the expensive "other" pane. */
  paneById: Map<string, number>
  /** Pre-effect render time of instrumented shell parts (sidebar, strip, …). */
  shellByName: Map<string, number>
}

let clicked: Pending | null = null

/**
 * Called from a Profiler around each tab pane; splits the switch's React time
 * into "the pane being switched to" vs "every other pane", so the remainder is
 * the App shell. Keeps accumulating after the activation effect: the refresh
 * cascade commits again between that effect and the frame, and lumping it into
 * "paint" is how paint got blamed for React work.
 */
export function reportPaneRender(tabId: string, ms: number): void {
  if (!clicked) return
  const post = clicked.effectAt != null

  if (!post) clicked.paneById.set(tabId, (clicked.paneById.get(tabId) ?? 0) + ms)
  if (tabId === clicked.tabId) {
    if (post) clicked.postPaneMs += ms
    else clicked.prePaneMs += ms
  } else if (post) clicked.postOtherMs += ms
  else clicked.preOtherMs += ms
}

/** Same as reportPaneRender, for named shell parts (sidebar, strip, toolbar). */
export function reportShellRender(name: string, ms: number): void {
  if (!clicked || clicked.effectAt != null) return
  clicked.shellByName.set(name, (clicked.shellByName.get(name) ?? 0) + ms)
}

/**
 * A new-tab request from either entry point. The created tab's id is unknown
 * at this moment, so the next activation of ANY tab closes the pair — which is
 * exactly the new tab.
 */
export function logNewTabRequested(source: 'plus-button' | 'cmd+t'): void {
  if (!enabled()) return
  clicked = {
    tabId: `*${source}`,
    at: performance.now(),
    effectAt: null,
    prePaneMs: 0,
    preOtherMs: 0,
    postPaneMs: 0,
    postOtherMs: 0,
    paneById: new Map(),
    shellByName: new Map(),
  }
  console.log(`${stamp()} [tab] new tab (${source})`)
}

export function logTabClicked(tabId: string): void {
  if (!enabled()) return
  clicked = {
    tabId,
    at: performance.now(),
    effectAt: null,
    prePaneMs: 0,
    preOtherMs: 0,
    postPaneMs: 0,
    postOtherMs: 0,
    paneById: new Map(),
    shellByName: new Map(),
  }
  console.log(`${stamp()} [tab] clicked → ${tabId}`)
}

/**
 * Call when `tabId` has become the active tab. Only logs activations that
 * answer a click, so programmatic ones (restore, open-in-new-tab) stay quiet.
 */
export function logTabActivated(tabId: string): void {
  if (!enabled()) return
  if (!clicked || clicked.effectAt != null) return
  const isWildcard = clicked.tabId.startsWith('*')

  if (!isWildcard && clicked.tabId !== tabId) return
  if (isWildcard) clicked.tabId = tabId
  const from = clicked

  from.effectAt = performance.now()
  requestAnimationFrame(() => {
    if (clicked === from) clicked = null
    const paintedMs = Math.round(performance.now() - from.at)
    const commitMs = Math.round(from.effectAt! - from.at)
    const pane = Math.round(from.prePaneMs)
    const others = Math.round(from.preOtherMs)
    const shell = Math.max(0, commitMs - pane - others)
    const tailMs = paintedMs - commitMs
    const lateReact = Math.round(from.postPaneMs + from.postOtherMs)
    const shellParts = [...from.shellByName.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => `${name} ${String(Math.round(v))}`)
      .join(' \u00b7 ')
    const topOther = [...from.paneById.entries()]
      .filter(([id]) => id !== tabId)
      .sort((a, b) => b[1] - a[1])[0]
    const otherLabel =
      topOther && topOther[1] >= 10
        ? `${String(others)} [${topOther[0].slice(4, 12)} ${String(Math.round(topOther[1]))}]`
        : String(others)

    console.log(
      `${stamp()} [tab] active  \u2192 ${tabId}  (+${String(paintedMs)}ms: commit ${String(commitMs)} = pane ${String(pane)} + other panes ${otherLabel} + shell ${String(shell)} [${shellParts || 'unmeasured'}] \u00b7 tail ${String(tailMs)}, late react >=${String(lateReact)})`,
    )
  })
}
