// Bidirectional journal<->chat anchoring. Tool cards and messages
// carry data-message-id / data-tool-call-id anchors; this context lets any
// tool card deep in the transcript open the journal pane focused on itself
// without threading a callback through every render layer. Null outside the
// page variant (no side-pane slot -> no entry point).

import { memo, useLayoutEffect } from 'react'

import { HOME_TAB_ID } from './panel/model'
import { PanelContent, PanelSidebarLayout } from './panel/panelContent'
import { PanelPageLayout } from './panel/panelPageLayout'
import { computePanelRenderState } from './panel/panelRenderState'
import { PanelConversationPage, PanelHomePage } from './panel/panelViews'
import { useAgentEventStream } from './panel/useAgentEventStream'
import { useAuthorizationFlows } from './panel/useAuthorizationFlows'
import { useClientToolFlow } from './panel/useClientToolFlow'
import { useCommittedClientToolDispatch } from './panel/useCommittedClientToolDispatch'
import { useConversationCatchUp } from './panel/useConversationCatchUp'
import { useConversationOpen } from './panel/useConversationOpen'
import { useEndOfStream } from './panel/useEndOfStream'
import { usePanelBase } from './panel/usePanelBase'
import { usePanelCredentialSync } from './panel/usePanelCredentialSync'
import { usePanelNav } from './panel/usePanelNav'
import { usePanelPermissions } from './panel/usePanelPermissions'
import { usePanelPlanPane } from './panel/usePanelPlanPane'
import { usePanelQueueWatchdogs } from './panel/usePanelQueueWatchdogs'
import { usePanelRefs } from './panel/usePanelRefs'
import { usePanelSessionBridge } from './panel/usePanelSessionBridge'
import { usePanelTranscripts } from './panel/usePanelTranscripts'
import { useQueuedAutoSend } from './panel/useQueuedAutoSend'
import { useTextStreaming } from './panel/useTextStreaming'
import { useTurnDispatch } from './panel/useTurnDispatch'

import type { JournalChatTarget } from './JournalPanel'
import type { PanelViewCtx } from './panel/ctx'
import type { AgentPromptSeed, Tab } from './panel/model'
import type { MutableRefObject } from 'react'

export { AgentHistoryPage } from './panel/AgentHistoryPage'
export type { AgentSessionSnapshot } from './panel/model'
export type { AuthorizationDecisionAction } from './panel/parts'

type Props = {
  variant?: 'panel' | 'page'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  userName?: string
  url?: string
  /** Mutable workspace context avoids re-rendering a long transcript whenever
   *  the page beside it changes. The latest value is read only when needed. */
  runtimeUrlRef?: MutableRefObject<string | undefined>
  teamId?: string
  /** False for the skippable Free console; prevents unpaid background LLM suggestions. */
  paid?: boolean
  /** Page variant: replace the team.agent page with a global right-side sidebar. */
  onDockToSidebar?: (snapshot: Tab | null) => void
  /** Panel variant: re-open the team.agent page (and close the sidebar). */
  onExpandToPage?: (snapshot: Tab | null, opts?: { newTab?: boolean }) => void
  /** One-shot seed: when set, the panel replaces its session with this snapshot. */
  pendingImport?: Tab | null
  /** Called after `pendingImport` has been consumed so the parent can clear it. */
  onImportConsumed?: () => void
  /** One-shot: when set, fork this conversation into a new owned session (full
   *  context, writable) — used to continue a plan from the Plans page. */
  pendingForkSessionId?: string | null
  /** Called after `pendingForkSessionId` has been consumed. */
  onForkConsumed?: () => void
  /** Audit-log deep link: scroll the named session's transcript to this anchor once rendered. */
  pendingLocate?: { sessionId: string; target: JournalChatTarget } | null
  onLocateConsumed?: () => void
  /**
   * One-shot prompt seed for the composer. Each push must bump `nonce` so the
   * composer re-fires its effect (allowing the same seed to be pushed twice in
   * a row).
   */
  pendingPrompt?: AgentPromptSeed | null
  /** Called once the composer has consumed `pendingPrompt`. */
  onPromptConsumed?: () => void
  /** Called when the active session's tab display metadata changes. */
  onTitleChange?: (
    title: string,
    sessionId: string | null,
    claudeCodeRuntimeAttached: boolean,
    agentRuntime?: 'claude-code' | 'codex',
    canRename?: boolean,
  ) => void
  /** Externally-controlled session id (drives which chat is displayed). */
  sessionId?: string | null
  /** Force conversations opened via the `sessionId` prop into read-only —
   *  audit views must never expose approve/composer/fork. */
  sessionReadOnly?: boolean
  /** Called when AgentPanel changes which session it is showing. */
  onSessionChange?: (sessionId: string | null) => void
  /** Opens Nuphos markdown links from assistant messages inside the desktop workspace. */
  onOpenNuphosLink?: (href: string) => boolean
  /** Opens workspace Settings at the Claude Code/OpenAB setup section. */
  onOpenAgentSettings?: () => void
  /** Focus the blank composer when this page-mode panel becomes active. */
  autoFocusComposer?: boolean
  /**
   * The workspace tab's currently-bound kubeconfig context, if any. Forwarded
   * to `agentStart` as `kubeContext` so the backend can tell the agent which
   * cluster to target for typed K8s tools (port_forward_start, …). The
   * AgentPanel itself doesn't render this — it just relays.
   */
  kubeContext?: string | null
  runtimeKubeContextRef?: MutableRefObject<string | null | undefined>
  /** Viewer is a team administrator — gates approving permission-grant proposals. */
  isTeamAdmin?: boolean
  /**
   * Page-mode integration gate. Non-null when the team hasn't bound ANY
   * integration yet: the home page swaps its composer for a step-by-step
   * connect guide and every composer is disabled, since the agent has nothing
   * to act on until the first connector is bound. `onConnect` opens the
   * Whether this team has no integrations bound yet. Chatting is allowed
   * either way — this only withholds what needs bound resources to mean
   * anything (starter suggestions, auto-mode). Left undefined in panel mode,
   * which never had the gate.
   */
  unbound?: boolean
  /** Starts the read-only connect flow from the first-run home. */
  onStartConnect?: () => void
  /**
   * Human labels for the integrations the team has bound (e.g. ['AWS',
   * 'Slack', 'GitHub']). Used on the page-mode home screen to fetch a set of
   * LLM-generated starter questions tailored to the connected resources. Empty
   * or omitted → no suggestions are fetched. Ignored while `unbound` is
   * set (nothing connected) and in panel mode.
   */
  connectedResources?: string[]
}

export const AgentPanel = memo(function AgentPanel({
  variant = 'panel',
  open,
  onOpenChange,
  userName,
  url,
  runtimeUrlRef,
  teamId,
  paid = false,
  onDockToSidebar,
  onExpandToPage,
  pendingImport,
  onImportConsumed,
  pendingForkSessionId,
  onForkConsumed,
  pendingLocate,
  onLocateConsumed,
  pendingPrompt,
  onPromptConsumed,
  onTitleChange,
  sessionId: sessionIdProp,
  sessionReadOnly = false,
  onSessionChange,
  onOpenNuphosLink,
  onOpenAgentSettings,
  autoFocusComposer = false,
  kubeContext,
  runtimeKubeContextRef,
  isTeamAdmin = false,
  unbound = false,
  onStartConnect,
  connectedResources,
}: Props) {
  const acc1 = {
    variant,
    open,
    onOpenChange,
    userName,
    teamId,
    paid,
    url,
    runtimeUrlRef,
    unbound,
    isTeamAdmin,
    sessionIdProp,
    sessionReadOnly,
    pendingImport,
    onImportConsumed,
    pendingForkSessionId,
    onForkConsumed,
    pendingLocate,
    onLocateConsumed,
    pendingPrompt,
    onPromptConsumed,
    onTitleChange,
    onSessionChange,
    onOpenNuphosLink,
    onOpenAgentSettings,
    autoFocusComposer,
    kubeContext,
    runtimeKubeContextRef,
    onStartConnect,
    connectedResources,
    onDockToSidebar,
    onExpandToPage,
  }
  const acc2 = { ...acc1, ...usePanelBase(acc1) }
  const acc3 = { ...acc2, ...usePanelRefs(acc2) }
  const acc4 = { ...acc3, ...usePanelPermissions(acc3) }
  const acc5 = { ...acc4, ...usePanelTranscripts(acc4) }
  const acc6 = { ...acc5, ...usePanelCredentialSync(acc5) }
  const acc7 = { ...acc6, ...usePanelPlanPane(acc6) }
  const acc8 = { ...acc7, ...usePanelNav(acc7) }
  const acc9 = { ...acc8, ...useTextStreaming(acc8) }
  const acc10 = { ...acc9, ...useClientToolFlow(acc9) }

  useCommittedClientToolDispatch(acc10)
  const acc11 = { ...acc10, ...useEndOfStream(acc10) }

  useAgentEventStream(acc11)
  const acc12 = { ...acc11, ...useTurnDispatch(acc11) }

  useQueuedAutoSend(acc12)
  const acc13 = { ...acc12, ...useAuthorizationFlows(acc12) }
  const acc14 = { ...acc13, ...usePanelQueueWatchdogs(acc13) }
  const acc15 = { ...acc14, ...useConversationOpen(acc14) }

  useConversationCatchUp(acc15)
  usePanelSessionBridge(acc15)
  const c: PanelViewCtx = { ...acc15, ...computePanelRenderState(acc15) }
  const { activeId, setActiveId } = c

  // A seeded shortcut must switch to the blank composer before paint. Updating
  // state during render caused a second render while the sidebar width was
  // animating, stacking the chat-page slide onto the dock transition.
  useLayoutEffect(() => {
    if (pendingPrompt?.newChat && activeId !== HOME_TAB_ID) setActiveId(HOME_TAB_ID)
  }, [activeId, pendingPrompt?.newChat, pendingPrompt?.nonce, setActiveId])

  const homePage = <PanelHomePage c={c} />
  const conversationPage = <PanelConversationPage c={c} />
  const content = <PanelContent c={c} homePage={homePage} conversationPage={conversationPage} />

  if (variant === 'page') {
    return <PanelPageLayout c={c} content={content} />
  }

  return <PanelSidebarLayout c={c} content={content} />
})
