import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { runtimeAllows } from '../../../lib/runtimeExecution'
import { findLatestPlanReference } from '../planReference'
import { usePlan } from '../planUpdates'

import { ACTIVE_LIFECYCLE_STATUSES } from './applyEvent'
import { credentialSelectionSignature } from './credentialAccess'
import { useConversationPlanReference } from './useConversationPlanReference'

import type { ActivePlan } from './applyEvent'
import type { JournalChatTarget } from '../JournalPanel'
import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'activeTab'
  | 'credentialAccessRef'
  | 'lastCredentialSyncedRef'
  | 'onImportConsumed'
  | 'onLocateConsumed'
  | 'onTitleChange'
  | 'panelRootRef'
  | 'pendingImport'
  | 'pendingLocate'
  | 'refreshHistory'
  | 'sendableCredentialAccess'
  | 'sessionIdProp'
  | 'setActiveId'
  | 'setTabs'
  | 'teamId'
  | 'variant'
  | 'visible'
>

export function usePanelPlanPane(acc: Acc) {
  const {
    activeId,
    activeTab,
    credentialAccessRef,
    lastCredentialSyncedRef,
    onImportConsumed,
    onLocateConsumed,
    onTitleChange,
    panelRootRef,
    pendingImport,
    pendingLocate,
    refreshHistory,
    sendableCredentialAccess,
    sessionIdProp,
    setActiveId,
    setTabs,
    teamId,
    variant,
    visible,
  } = acc

  // Find the latest Plan-producing tool call in the active tab. Both the
  // generic plan_create tool and typed resource proposal tools persist normal
  // Plan docs; their content + live status come straight from the same API.
  const latestPlanRef = useMemo(() => {
    if (!activeTab) return null

    return findLatestPlanReference(activeTab.messages)
  }, [activeTab])
  const resolvedPlanRef = useConversationPlanReference(
    activeTab?.sessionId,
    activeTab?.streaming ?? false,
    teamId,
    latestPlanRef,
  )
  const { plan: activePlanDoc } = usePlan(resolvedPlanRef?.planId, teamId, {
    keepPolling: activeTab?.streaming ?? false,
  })

  const activePlan = useMemo<ActivePlan | null>(() => {
    if (!resolvedPlanRef || !activePlanDoc) return null
    if (activePlanDoc.id !== resolvedPlanRef.planId) return null

    return {
      toolCallId: resolvedPlanRef.toolCallId,
      planId: resolvedPlanRef.planId,
      plan: activePlanDoc,
    }
  }, [resolvedPlanRef, activePlanDoc])

  const canUseJournalPane = variant === 'page'
  // Audit journal remains a detail pane. Plans deliberately do not share this
  // surface anymore: their canonical presentation is the inline chat card.
  const [journalPaneOpen, setJournalPaneOpen] = useState(false)
  // Journal entry the pane should scroll to (chat -> journal anchoring).
  // Chat->journal anchoring lost its entry points when the audit-journal
  // buttons were removed; the pane still accepts a focus target, so keep the
  // (now always-null) value it renders with.
  const [journalFocus] = useState<JournalChatTarget | null>(null)
  // journal -> chat: scroll the transcript to the anchored message/tool card
  // and flash it. DOM query over React state on purpose — anchors are plain
  // data attributes and the transcript is virtual-scroll-free.
  const locateInChat = useCallback((target: JournalChatTarget): boolean => {
    const root = panelRootRef.current

    if (!root) return false
    const selector = target.toolCallId
      ? `[data-tool-call-id="${CSS.escape(target.toolCallId)}"]`
      : target.messageId
        ? `[data-message-id="${CSS.escape(target.messageId)}"]`
        : null

    if (!selector) return false
    const el = root.querySelector<HTMLElement>(selector)

    if (!el) return false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const flashClasses = ['ring-2', 'ring-violet-400/70', 'rounded-lg']

    el.classList.add(...flashClasses)
    window.setTimeout(() => el.classList.remove(...flashClasses), 1600)

    return true
  }, [])

  // Audit-log deep link: once the requested conversation is active and its
  // transcript has rendered the anchored element, scroll+flash it. Retries
  // briefly because the transcript loads asynchronously after the open.
  useEffect(() => {
    if (!pendingLocate) return
    if (activeTab?.sessionId !== pendingLocate.sessionId) return
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      if (locateInChat(pendingLocate.target) || attempts >= 20) {
        window.clearInterval(timer)
        onLocateConsumed?.()
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [pendingLocate, activeTab?.sessionId, locateInChat, onLocateConsumed])
  // Reset the journal pane when switching conversations.
  const [journalPaneTabId, setJournalPaneTabId] = useState(activeId)

  if (activeId !== journalPaneTabId) {
    setJournalPaneTabId(activeId)
    setJournalPaneOpen(false)
  }

  // Approve is shown only while the plan is still `proposed` and the tab is
  // not streaming (sendInActive would early-return otherwise). Chat (=
  // interrupt) is shown whenever the plan is still active. These gate the
  // latest plan's inline actions.
  const activePlanCanAct = useMemo(() => {
    if (!activePlan || !activeTab) return null

    return {
      toolCallId: activePlan.toolCallId,
      canApprove:
        activePlan.plan.status === 'proposed' &&
        (runtimeAllows(activeTab.runtimeState, 'send') ||
          runtimeAllows(activeTab.runtimeState, 'reply')) &&
        !activeTab.readOnly,
      canChat: ACTIVE_LIFECYCLE_STATUSES.has(activePlan.plan.status) && !activeTab.readOnly,
      keepPolling: activeTab.streaming,
    }
  }, [activePlan, activeTab])
  const onTitleChangeRef = useRef(onTitleChange)

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])
  useEffect(() => {
    // Also fires on sessionIdProp change so the parent's pageHref closure is
    // fresh when setPageMeta gates updates by canonicalHref. That means it can
    // fire while the panel still holds the PREVIOUS conversation, so the title
    // is reported with the session it belongs to — a consumer that already
    // knows the title of the one it asked for can ignore the stale report
    // instead of flickering back through it.
    onTitleChangeRef.current?.(
      activeTab?.title?.trim() || '',
      activeTab?.sessionId ?? null,
      activeTab?.claudeCodeRuntimeAttached === true,
      activeTab?.agentRuntime,
      Boolean(activeTab?.sessionId && !activeTab.readOnly && !activeTab.foreign),
      activeTab?.runtimeId,
    )
  }, [
    activeTab?.readOnly,
    activeTab?.foreign,
    activeTab?.title,
    activeTab?.sessionId,
    activeTab?.claudeCodeRuntimeAttached,
    activeTab?.agentRuntime,
    activeTab?.runtimeId,
    sessionIdProp,
  ])

  useEffect(() => {
    // Kicking off the fetch is the effect; the loading flag it raises is the
    // request's own state, not state derived from anything rendered here.

    if (visible) void refreshHistory()
  }, [visible, refreshHistory])

  useEffect(() => {
    if (!pendingImport) return
    const imported = {
      ...pendingImport,
      // A tab handed over from another surface carries whatever selection that
      // surface had, which may predate a connector deletion.
      credentialAccess: sendableCredentialAccess(pendingImport.credentialAccess),
      // An earlier-page fetch never survives the surface handoff; a stale true
      // would permanently block scroll-up paging on the imported tab.
      loadingEarlier: false,
    }

    credentialAccessRef.current.set(imported.sessionId, imported.credentialAccess)
    lastCredentialSyncedRef.current.set(
      imported.sessionId,
      credentialSelectionSignature(imported.credentialAccess),
    )
    // Consuming the handoff is an event, not derived state: the credential refs
    // above must land in the same synchronous step as the tab they describe.

    setTabs([imported])
    setActiveId(pendingImport.id)
    onImportConsumed?.()
  }, [pendingImport, onImportConsumed, sendableCredentialAccess])

  return {
    activePlan,
    canUseJournalPane,
    journalPaneOpen,
    setJournalPaneOpen,
    journalFocus,
    locateInChat,
    activePlanCanAct,
  }
}
