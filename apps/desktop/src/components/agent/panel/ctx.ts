import type { AgentProvider } from '../../../types/runtime'
import type {
  AgentConversation,
  AgentCredentialOptions,
  AgentCredentialSelection,
} from '../../../api'
import type { JournalChatTarget } from '../JournalPanel'
import type { ActivePlan } from './applyEvent'
import type { CredentialSelectorControl } from './credentialSections'
import type { AgentPromptSeed, Message, MessageRating, Tab } from './model'
import type { AuthorizationDecisionAction, ToolPart, TransferUploadPart } from './parts'
import type { StallDetail } from './stall'
import type { TextStreamBuffer } from './streamBuffer'
import type { useStarterSuggestions } from './useStarterSuggestions'
import type { PermissionMode } from '../../../lib/permissionMode'
import type { UserInfo } from '../../../types'
import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'
import type { Dispatch, DragEvent, SetStateAction } from 'react'

type Ref<T> = { current: T }

// The full bag of AgentPanel state, refs, and callbacks. Assembled once per
// render in AgentPanel and threaded to the slice hooks, extracted handler
// modules, and view components via `Pick<PanelCtx, …>` subsets.
export type PanelCtx = {
  variant: 'panel' | 'page'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  currentUser?: UserInfo | null
  userName?: string
  teamId?: string
  paid: boolean
  url?: string
  runtimeUrlRef?: Ref<string | undefined>
  unbound: boolean
  gated: boolean
  isSidebarMode: boolean
  visible: boolean
  isTeamAdmin: boolean
  sessionIdProp?: string | null
  sessionReadOnly: boolean
  pendingImport?: Tab | null
  onImportConsumed?: () => void
  pendingForkSessionId?: string | null
  onForkConsumed?: () => void
  pendingLocate?: { sessionId: string; target: JournalChatTarget } | null
  onLocateConsumed?: () => void
  pendingPrompt?: AgentPromptSeed | null
  onPromptConsumed?: () => void
  onTitleChange?: (
    title: string,
    sessionId: string | null,
    claudeCodeRuntimeAttached: boolean,
    agentRuntime?: AgentProvider,
    canRename?: boolean,
    runtimeId?: string,
  ) => void
  onSessionChange?: (sessionId: string | null) => void
  onOpenNuphosLink?: (href: string) => boolean
  onOpenAgentSettings?: () => void
  newChatRequest: number
  autoFocusComposer: boolean
  kubeContext?: string | null
  runtimeKubeContextRef?: Ref<string | null | undefined>
  onStartConnect?: () => void
  connectedResources?: string[]
  onDockToSidebar?: (snapshot: Tab | null) => void
  onExpandToPage?: (snapshot: Tab | null, opts?: { newTab?: boolean }) => void
  homeStarterSuggestions: ReturnType<typeof useStarterSuggestions>
  urlRef: Ref<string | undefined>
  kubeContextRef: Ref<string | null | undefined>
  teamIdRef: Ref<string | undefined>
  widthVw: number
  setWidthVw: Dispatch<SetStateAction<number>>
  dragging: boolean
  setDragging: Dispatch<SetStateAction<boolean>>
  tabs: Tab[]
  setTabs: Dispatch<SetStateAction<Tab[]>>
  activeId: string
  setActiveId: Dispatch<SetStateAction<string>>
  tabsRef: Ref<Tab[]>
  autoLearnedFetchedRef: Ref<Set<string>>
  uploadingTabsRef: Ref<Set<string>>
  homeDropRef: Ref<((dt: DataTransfer) => void) | null>
  conversationDropRef: Ref<((dt: DataTransfer) => void) | null>
  panelRootRef: Ref<HTMLElement | null>
  setPanelRoot: (el: HTMLElement | null) => void
  draggingFiles: boolean
  setDraggingFiles: Dispatch<SetStateAction<boolean>>
  dragDepthRef: Ref<number>
  history: AgentConversation[]
  setHistory: Dispatch<SetStateAction<AgentConversation[]>>
  historyLoading: boolean
  setHistoryLoading: Dispatch<SetStateAction<boolean>>
  openingConversation: { sessionId: string; title: string } | null
  setOpeningConversation: Dispatch<SetStateAction<{ sessionId: string; title: string } | null>>
  credentialOptions: AgentCredentialOptions
  setCredentialOptions: Dispatch<SetStateAction<AgentCredentialOptions>>
  credentialOptionsRef: Ref<AgentCredentialOptions>
  draftCredentialAccess: AgentCredentialSelection
  setDraftCredentialAccess: Dispatch<SetStateAction<AgentCredentialSelection>>
  draftCredentialTouched: boolean
  setDraftCredentialTouched: Dispatch<SetStateAction<boolean>>
  credentialsSaving: boolean
  setCredentialsSaving: Dispatch<SetStateAction<boolean>>
  credentialsRefreshing: boolean
  setCredentialsRefreshing: Dispatch<SetStateAction<boolean>>
  syncTimersRef: Ref<Map<string, ReturnType<typeof setTimeout>>>
  credentialSyncTimersRef: Ref<Map<string, ReturnType<typeof setTimeout>>>
  credentialSyncInFlightRef: Ref<number>
  credentialSyncVersionsRef: Ref<Map<string, number>>
  credentialAccessRef: Ref<Map<string, AgentCredentialSelection>>
  credentialOptionsRequestRef: Ref<number>
  lastSyncedRef: Ref<Map<string, string>>
  lastCredentialSyncedRef: Ref<Map<string, string>>
  textBuffersRef: Ref<Map<string, TextStreamBuffer>>
  turnCompleteRef: Ref<Map<string, { turnKey?: string }>>
  turnPausedRef: Ref<Map<string, { reason: string; detail?: StallDetail }>>
  streamOwnersRef: Ref<Map<string, { sessionId: string; title: string }>>
  clientToolRunsRef: Ref<Map<string, { cancelled: boolean; requestIds?: string[] }>>
  stoppedRunIdsRef: Ref<Map<string, string>>
  pendingEndEffectsRef: Ref<(() => void)[]>
  activeTab: Tab | null
  activePendingAuthToolCallId: string | null
  bypassBySession: Record<string, boolean>
  setBypassBySession: Dispatch<SetStateAction<Record<string, boolean>>>
  autoModeAvailable: boolean
  setAutoModeAvailable: Dispatch<SetStateAction<boolean>>
  defaultPermissionMode: PermissionMode
  setDefaultPermissionMode: Dispatch<SetStateAction<PermissionMode>>
  applyDefaultPermissionMode: (mode: PermissionMode) => void
  selectDefaultPermissionMode: (bypass: boolean) => void
  applyBypass: (sessionId: string, next: boolean) => void
  selectBypassMode: (bypass: boolean) => void
  refreshHistory: () => Promise<void>
  syncTranscriptNow: (tab: Tab) => void
  newConversationRuntime: RuntimeInstance | null
  runtimeInstances: RuntimeInstance[]
  runtimeInstancesLoading: boolean
  runtimeInstancesError: string | null
  runtimeQuotas: ReadonlyMap<string, RuntimeQuota>
  selectConversationRuntime: (runtimeId: string) => void
  newConversationCredentialAccess: AgentCredentialSelection
  effectiveCredentialAccess: AgentCredentialSelection
  sendableCredentialAccess: (access: AgentCredentialSelection) => AgentCredentialSelection
  refreshCredentialSaving: () => void
  refreshCredentialOptions: (opts?: { quiet?: boolean }) => Promise<void>
  updateCredentialSelection: (next: AgentCredentialSelection) => void
  activePlan: ActivePlan | null
  canUseJournalPane: boolean
  journalPaneOpen: boolean
  setJournalPaneOpen: Dispatch<SetStateAction<boolean>>
  journalFocus: JournalChatTarget | null
  locateInChat: (target: JournalChatTarget) => boolean
  activePlanCanAct: {
    toolCallId: string
    canApprove: boolean
    canChat: boolean
    keepPolling: boolean
  } | null
  dockCurrentSession: () => void
  expandCurrentSession: (opts?: { newTab?: boolean }) => void
  pendingOpenRef: Ref<string | null>
  startNewChat: () => void
  queueTranscriptSync: (tab: Tab, delayMs: number) => void
  appendTextToStream: (streamId: string, delta: string) => void
  drainTextBuffer: (streamId: string) => void
  enqueueTextDelta: (streamId: string, delta: string) => void
  flushTextBuffer: (streamId: string) => void
  deferEndUntilTextDrained: (streamId: string, onDrained: () => void) => boolean
  fireStopNotification: (notification: { title: string; body: string }, sessionId: string) => void
  continueTurnAfterClientTools: (payload: {
    tabId: string
    sessionId: string
    title: string
    messages: Message[]
    credentialAccess: AgentCredentialSelection
  }) => Promise<void>
  executeClientToolsAndContinue: (payload: {
    tabId: string
    sessionId: string
    title: string
    messages: Message[]
    tools: ToolPart[]
    credentialAccess: AgentCredentialSelection
  }) => Promise<void>
  handleMessageFeedback: (
    sessionId: string,
    messageId: string,
    rating: MessageRating | null,
    comment?: string,
  ) => void
  handleEndEvent: (streamId: string) => void
  startChatWith: (
    prompt: string,
    initialMessage?: Message,
    deferredUpload?: {
      messageId: string
      run: (sessionId: string | undefined) => Promise<TransferUploadPart>
    },
  ) => void
  dispatchTurn: (
    tabId: string,
    text: string,
    filePaths: string[],
    turnKind?: Message['turnKind'],
  ) => Promise<void>
  sendInActive: (
    text: string,
    filePaths?: string[],
    turnKind?: Message['turnKind'],
  ) => Promise<void>
  steerQueued: (tabId: string, queuedId: string) => Promise<void>
  handleRejectPlan: (
    planId: string,
    reason: string,
    mode: 'revise' | 'delete',
    label: string,
  ) => Promise<void>
  decideAuthorization: (
    toolCallId: string,
    decision: AuthorizationDecisionAction,
    ruleDescription?: string,
  ) => void
  resumePermissionTurn: (toolCallId: string, output: Record<string, unknown>) => void
  authorizationContextValue: {
    decide: (
      toolCallId: string,
      decision: AuthorizationDecisionAction,
      ruleDescription?: string,
    ) => void
    activeToolCallId: string | null
    readOnly: boolean
  }
  removeQueued: (tabId: string, queuedId: string) => void
  stopActive: () => void
  openGenerationRef: Ref<number>
  clearPendingOpen: (sessionId: string) => void
  setTabAuditReadOnly: (sessionId: string, next: boolean) => void
  openConversation: (
    sessionId: string,
    titleHint?: string,
    opts?: { forceReadOnly?: boolean },
  ) => Promise<void>
  loadEarlierMessages: (tabId: string) => Promise<void>
  forkConversation: (sourceSessionId: string) => Promise<void>
}

export type PanelRenderState = {
  activeTabIsBlankDraft: boolean
  showingConversationPage: boolean
  homeShown: boolean
  onPanelDragEnter: (e: DragEvent<HTMLDivElement>) => void
  onPanelDragOver: (e: DragEvent<HTMLDivElement>) => void
  onPanelDragLeave: (e: DragEvent<HTMLDivElement>) => void
  onPanelDrop: (e: DragEvent<HTMLDivElement>) => void
  credentialSelectorControl: CredentialSelectorControl | undefined
  visibleHomeCredentialSelector: CredentialSelectorControl | undefined
  visibleConversationCredentialSelector: CredentialSelectorControl | undefined
  pendingPromptReady: AgentPromptSeed | null | undefined
  switchingConversation: boolean
}

export type PanelViewCtx = PanelCtx & PanelRenderState
