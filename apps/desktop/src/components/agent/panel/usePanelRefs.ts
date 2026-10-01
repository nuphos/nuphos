import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { EMPTY_CREDENTIAL_OPTIONS, EMPTY_CREDENTIAL_ACCESS } from './constants'
import { emitFirstRunConvo } from './model'

import type { PanelCtx } from './ctx'
import type { StallDetail } from './stall'
import type { TextStreamBuffer } from './streamBuffer'
import type {
  AgentConversation,
  AgentCredentialOptions,
  AgentCredentialSelection,
} from '../../../api'

type Acc = Pick<PanelCtx, 'tabs'>

export function usePanelRefs(acc: Acc) {
  const { tabs } = acc

  // First-run breadcrumb: the moment the last in-flight turn finishes, the
  // guide can advance "waiting for the answer" → "the answer is in".
  const anyStreaming = tabs.some((t) => t.streaming)
  const wasStreamingRef = useRef(false)

  useEffect(() => {
    if (wasStreamingRef.current && !anyStreaming) emitFirstRunConvo('answered')
    wasStreamingRef.current = anyStreaming
  }, [anyStreaming])
  // A3 auto-ingest: streamIds whose post-turn learned-chip fetch is already
  // scheduled (StrictMode double-dispatch guard).
  const autoLearnedFetchedRef = useRef(new Set<string>())
  // Tabs with a transfer upload in flight. The tab stays
  // `streaming: false` during the upload, so without this a second send could
  // race the upload and clobber messages; sends treat these tabs as busy.
  const uploadingTabsRef = useRef<Set<string>>(new Set())
  // Panel-level drag-and-drop. The whole chat panel is the drop zone;
  // each visible composer registers its attach handler so a drop routes to the
  // right one (home vs the open conversation). `dragDepthRef` keeps the overlay
  // from flickering as the cursor crosses nested children.
  const homeDropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  const conversationDropRef = useRef<((dt: DataTransfer) => void) | null>(null)
  // The panel's outermost element, used to scope the ESC-to-stop shortcut to
  // keystrokes that originate inside this panel. A callback ref so the same
  // setter can attach to either the page <div> or the sidebar <aside>.
  const panelRootRef = useRef<HTMLElement | null>(null)
  const setPanelRoot = useCallback((el: HTMLElement | null) => {
    panelRootRef.current = el
  }, [])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)
  const [history, setHistory] = useState<AgentConversation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [openingConversation, setOpeningConversation] = useState<{
    sessionId: string
    title: string
  } | null>(null)
  const [credentialOptions, setCredentialOptions] =
    useState<AgentCredentialOptions>(EMPTY_CREDENTIAL_OPTIONS)
  // Request paths run outside render and must not send a credential the user
  // deleted mid-session: the backend rejects the whole turn for it.
  const credentialOptionsRef = useRef(credentialOptions)

  useLayoutEffect(() => {
    credentialOptionsRef.current = credentialOptions
  }, [credentialOptions])
  const [draftCredentialAccess, setDraftCredentialAccess] =
    useState<AgentCredentialSelection>(EMPTY_CREDENTIAL_ACCESS)
  const [draftCredentialTouched, setDraftCredentialTouched] = useState(false)
  const [credentialsSaving, setCredentialsSaving] = useState(false)
  const [credentialsRefreshing, setCredentialsRefreshing] = useState(false)
  const syncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const credentialSyncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const credentialSyncInFlightRef = useRef(0)
  const credentialSyncVersionsRef = useRef<Map<string, number>>(new Map())
  const credentialAccessRef = useRef<Map<string, AgentCredentialSelection>>(new Map())
  const credentialOptionsRequestRef = useRef(0)
  const lastSyncedRef = useRef<Map<string, string>>(new Map())
  const lastCredentialSyncedRef = useRef<Map<string, string>>(new Map())
  const textBuffersRef = useRef(new Map<string, TextStreamBuffer>())
  // Sentinel observed-flag keyed by streamId. Set when the backend's
  // atlas-turn-complete SSE arrives; consumed when the matching `end` event
  // fires and decides whether to finalize the turn or auto-resume. Entries are
  // deleted as they're consumed so stale streamIds can't fool a later run.
  const turnCompleteRef = useRef<Map<string, { turnKey?: string }>>(new Map())
  // Same shape, for the atlas-turn-paused signal. Presence means the backend
  // stopped the turn and told us why; the reason is shown to the user when the
  // matching `end` event finalizes the turn.
  const turnPausedRef = useRef<Map<string, { reason: string; detail?: StallDetail }>>(new Map())
  // Which conversation each live stream belongs to. A run outlives its tab —
  // opening another conversation replaces the tab list without aborting it — and
  // the end event then has no tab to read, so this is the only way left to name
  // the conversation that stopped. Deleted when its end event is consumed.
  const streamOwnersRef = useRef<Map<string, { sessionId: string; title: string }>>(new Map())
  // Cancellation token per tab for the client-side local-tool phase (the
  // window between a stream ending with pending local tools and the follow-up
  // agentStart). The tab has streaming=true but streamId=null there, so the
  // regular stream abort can't reach it — Stop flips this token instead.
  const clientToolRunsRef = useRef<Map<string, { cancelled: boolean; requestIds?: string[] }>>(
    new Map(),
  )
  // Stopped or terminally failed streams stay tombstoned until the backend confirms
  // they are gone. Runtime wakeup polling must not resurrect the same run.
  const stoppedRunIdsRef = useRef<Map<string, string>>(new Map())
  // End-of-stream side effects waiting for the commit that runs their updater.
  const pendingEndEffectsRef = useRef<(() => void)[]>([])

  return {
    autoLearnedFetchedRef,
    uploadingTabsRef,
    homeDropRef,
    conversationDropRef,
    panelRootRef,
    setPanelRoot,
    draggingFiles,
    setDraggingFiles,
    dragDepthRef,
    history,
    setHistory,
    historyLoading,
    setHistoryLoading,
    openingConversation,
    setOpeningConversation,
    credentialOptions,
    setCredentialOptions,
    credentialOptionsRef,
    draftCredentialAccess,
    setDraftCredentialAccess,
    draftCredentialTouched,
    setDraftCredentialTouched,
    credentialsSaving,
    setCredentialsSaving,
    credentialsRefreshing,
    setCredentialsRefreshing,
    syncTimersRef,
    credentialSyncTimersRef,
    credentialSyncInFlightRef,
    credentialSyncVersionsRef,
    credentialAccessRef,
    credentialOptionsRequestRef,
    lastSyncedRef,
    lastCredentialSyncedRef,
    textBuffersRef,
    turnCompleteRef,
    turnPausedRef,
    streamOwnersRef,
    clientToolRunsRef,
    stoppedRunIdsRef,
    pendingEndEffectsRef,
  }
}
