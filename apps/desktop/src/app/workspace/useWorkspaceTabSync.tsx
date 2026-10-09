import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import {
  collectExecScopes,
  collectLiveSshTabs,
  collectLocalTerminalTabIds,
  planExecTeardown,
  planSshTeardown,
} from '../../lib/terminalTabTeardown'
import { createWorkspaceTab } from '../workspaceTabFactory'

import { selectAllResidentTabs, selectCurrentBucket } from './store/workspaceState'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceProps } from './workspaceProps'
import type { OnboardingStagePlatform } from '../../views/onboarding/flow/shared'

type Args = WorkspaceProps & WorkspaceShellStateResult & WorkspaceActiveTabResult

export function useWorkspaceTabSync(a: Args) {
  const { tabs, activeTabId, closedSshTabsRef, workspaceStore, workspaceActions } = a
  const { closeTab, updateTab, updateActiveTab } = workspaceActions

  const [teamsLoading, setTeamsLoading] = useState(false)
  // Backend not yet reachable on first load (app outran a booting local backend)
  // → poll instead of dead-ending on Retry. See loadTeams.
  const [backendUnreachable, setBackendUnreachable] = useState(false)
  const backendRetryTimerRef = useRef<number | null>(null)
  // Monotonic token so a stale in-flight team load — one that resolves/rejects
  // after a newer load started, or after unmount — can't overwrite state or
  // schedule another retry.
  const loadTeamsTokenRef = useRef(0)
  // Whether the initial team list has loaded. Gates the onboarding auto-entry
  // decision (see the effect below) together with `invitationsLoaded`.
  const [teamsLoaded, setTeamsLoaded] = useState(false)
  // Onboarding: auto-entered for a brand-new user (zero teams and no pending
  // invitations; decided in the effect below once both lists have loaded) and
  // forceable in dev via `window.onboarding()`. Kept as an explicit "session
  // active" flag (not derived from teams.length) so the overlay stays mounted
  // across its own steps even after it creates the first team (which would
  // otherwise flip a derived `teams.length === 0` to false and unmount the flow
  // mid-way). `forced` means dev-opened, so it is dismissable.
  const [onboardingActive, setOnboardingActive] = useState(false)
  const [onboardingForced, setOnboardingForced] = useState(false)
  // The step the overlay should open on (1=intro, 2=workspace, 3=connect) and a
  // nonce bumped on every dev `onboarding()/onboarding.step()` call so the flow
  // remounts and honors the jump even when it's already open.
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [onboardingStepNonce, setOnboardingStepNonce] = useState(0)
  // OS chrome for the onboarding Slack demo stage — defaults to the host OS,
  // overridable in dev via `onboarding.platform('mac'|'windows')`.
  const [onboardingPlatform, setOnboardingPlatform] = useState<OnboardingStagePlatform>(() =>
    /windows/i.test(navigator.userAgent) ? 'windows' : 'mac',
  )
  // One-shot confetti celebrating the acquisition of a new workspace — set by
  // every action that gains one (creating a team in onboarding or the picker,
  // accepting an invitation, joining a discoverable team), for owner and
  // member alike. The burst only renders in the main shell, so a flag raised
  // mid-onboarding plays at the landing. Cleared by the shell once played;
  // never persisted, so only the session that performed the action celebrates.
  const [landingCelebration, setLandingCelebration] = useState(false)

  useEffect(() => api.onDockTerminalRequest(request => {
    const state = workspaceStore.getState()

    if (state.sessionId !== request.sessionId || state.sessionReadOnly ||
      state.teamScope?.teamId !== request.teamId || state.mainPageOpen) return
    void api.acceptDockTerminal(request.id).then(accepted => {
      if (!accepted) return
      const tab = { ...createWorkspaceTab(request.teamId), id: request.id, active: 'team.terminal' }

      workspaceStore.dispatch({ type: 'openTab', sessionKey: request.sessionId, tab, options: { openDock: true } })
    })
  }), [workspaceStore])

  // Terminal teardown is *observed*, not requested: every path that ends a
  // terminal drops the tab or navigates it elsewhere, so "a tab that stopped
  // being a terminal tab loses its PTY" covers them all — and, unlike an
  // unmount, it does not fire when the dock merely swaps to another session. It
  // watches every resident session, not just the visible one, and runs
  // synchronously on dispatch so `closedSshTabsRef` is marked before an
  // in-flight `atlasStart*Ssh` resolves.
  useEffect(() => {
    let live = new Map<string, string | null>()
    let localTerminals = new Set<string>()
    let execScopes = new Map<string, string | null>()
    let lastBuckets: unknown = null
    const observe = () => {
      const state = workspaceStore.getState()

      if (state.buckets === lastBuckets) return
      lastBuckets = state.buckets
      const residentTabs = selectAllResidentTabs(state)
      const next = collectLiveSshTabs(residentTabs)
      const plan = planSshTeardown(live, next)

      for (const tabId of plan.closedTabIds) closedSshTabsRef.current.add(tabId)
      for (const sessionId of plan.sessionIdsToClose) void api.sshTerminalClose(sessionId)
      live = next
      // Local terminals need no such bookkeeping: their PTY is keyed by the tab
      // id itself, so a tab that stopped being a terminal tab names its session.
      const nextLocal = collectLocalTerminalTabIds(residentTabs)

      for (const tabId of localTerminals) {
        if (!nextLocal.has(tabId)) void api.localTerminalClose(tabId)
      }
      localTerminals = nextLocal
      // Pod / node exec sessions are keyed by tab *and* the pod or node that tab
      // has open, so "this tab is looking somewhere else now" is the whole
      // teardown rule — including for the node shell's privileged pod.
      const nextExec = collectExecScopes(residentTabs)

      for (const { tabId, scope } of planExecTeardown(execScopes, nextExec)) {
        void api.podExecCloseTabScope(tabId, scope)
      }
      execScopes = nextExec
    }

    observe()

    return workspaceStore.subscribe(observe)
  }, [workspaceStore, closedSshTabsRef])

  // Exiting the shell ends the tab: a local-terminal tab has nothing left to
  // show once its PTY is gone. The event names its own tab (the PTY is keyed by
  // tab id), and this listener sits above the panes, so it also reaches a
  // terminal that exited while its session was off screen — the observer above
  // then reaps the session. Tabs belonging to another split pane's store are
  // simply not found, which the reducer treats as a no-op.
  useEffect(
    () =>
      api.onLocalTerminalEvent((event) => {
        if (event.type === 'exit') closeTab(event.id)
      }),
    [closeTab],
  )

  // Re-pull the activated tab on every switch. Pages stay mounted across tab
  // changes, so without this they keep showing whatever snapshot they had
  // when the user last looked. Skip the activation bump in two cases — both
  // would just double-fetch a page that is about to mount and load on its
  // own:
  //   1. null → first tab (app startup).
  //   2. opening a new tab via newTab() / openCloudTab() / etc. — the tab is
  //      added and activated in one dispatch, so the activeTabId effect fires
  //      but `prev` is the previously active tab, not null. We detect this by
  //      checking whether `activeTabId` was in the previous render's tab set.
  const prevActiveTabIdRef = useRef<string | null>(null)
  const prevTabIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const prev = prevActiveTabIdRef.current
    const wasExisting = activeTabId ? prevTabIdsRef.current.has(activeTabId) : false

    prevActiveTabIdRef.current = activeTabId
    prevTabIdsRef.current = new Set(tabs.map((t) => t.id))
    if (!activeTabId || prev === null || prev === activeTabId || !wasExisting) return
    // After the frame on purpose: committed in the click's task, this bump (and
    // the loads it triggers) rendered the whole App again before the browser
    // could show the switch. Plain timers rather than startTransition — lane
    // scheduling fed back into the update loop. No cleanup: the guard below makes
    // a stale bump a no-op, and cancelling on every `tabs` change would drop
    // real bumps.
    const bumpId = activeTabId

    requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (selectCurrentBucket(workspaceStore.getState()).activeTabId !== bumpId) return
        updateTab(bumpId, (tab) => ({ ...tab, refreshKey: tab.refreshKey + 1 }))
      }, 0)
    })
  }, [activeTabId, tabs, updateTab, workspaceStore])

  // Background poll heartbeat: bump pollTick on the active tab every 5 s
  // while the window is visible. Manual-fetch views read pollTick via
  // WorkspaceTabContext and include it in their fetch effect deps; the K8s
  // watch hook ignores it.
  useEffect(() => {
    let timer: number | null = null
    const start = () => {
      if (timer != null) return
      timer = window.setInterval(() => {
        updateActiveTab((tab) => ({ ...tab, pollTick: tab.pollTick + 1 }))
      }, 5000)
    }
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [updateActiveTab])

  return {
    teamsLoading,
    setTeamsLoading,
    backendUnreachable,
    setBackendUnreachable,
    backendRetryTimerRef,
    loadTeamsTokenRef,
    teamsLoaded,
    setTeamsLoaded,
    onboardingActive,
    setOnboardingActive,
    onboardingForced,
    setOnboardingForced,
    onboardingStep,
    setOnboardingStep,
    onboardingStepNonce,
    setOnboardingStepNonce,
    onboardingPlatform,
    setOnboardingPlatform,
    landingCelebration,
    setLandingCelebration,
    updateTab,
    updateActiveTab,
  }
}

export type WorkspaceTabSyncResult = ReturnType<typeof useWorkspaceTabSync>
