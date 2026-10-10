import clsx from 'clsx'

import { runtimeAllows } from '../../../lib/runtimeExecution'

import { AttachmentChips } from './composerAttachments'
import { ComposerEditor, ComposerSendControls } from './composerControls'
import { BypassControlMenu, ComposerAttachmentMenu } from './composerMenus'
import { CredentialSelectorButton } from './CredentialSelectorButton'
import { ModelSelector } from './ModelSelector'
import { runtimeMayAcceptLater } from './queuedAutoSend'
import { ReadOnlyConversationNotice } from './ReadOnlyNotice'
import { RuntimeSelector } from './RuntimeSelector'
import { useComposerActions } from './useComposerActions'
import { useComposerDraft } from './useComposerDraft'
import { useComposerMentions } from './useComposerMentions'
import { useComposerState } from './useComposerState'
import { useSessionConfig } from './useSessionConfig'

import type { CredentialSelectorControl } from './credentialSections'
import type { AgentPromptSeed } from './model'
import type { RuntimeControl } from './RuntimeSelector'
import type { ModelSession } from './useSessionConfig'
import type { AgentConversation, AgentSlackThread, LocalAgentSessionInfo } from '../../../api'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { ReactNode } from 'react'

export function Composer({
  variant = 'compact',
  onSend,
  onStop,
  runtimeState,
  executing = false,
  readOnly = false,
  readOnlyPlaceholder,
  activitySource,
  slackThread,
  credentialSelector,
  runtimeControl,
  modelSession,
  newConversationModelControl,
  bypassControl,
  pendingSeed,
  onSeedConsumed,
  firstRun = false,
  autoFocus = false,
  sidebar = false,
  dropRegisterRef,
  draftKey,
  onImportSession,
  mentionScope,
  promptSuggestion,
}: {
  variant?: 'compact' | 'hero'
  onSend: (text: string, filePaths: string[]) => void
  onStop: () => void
  /** Pending transport work; execution itself comes from the runtime snapshot. */
  streaming: boolean
  runtimeState?: RuntimeExecution
  executing?: boolean
  readOnly?: boolean
  /** Placeholder shown while `readOnly` — defaults to the read-only-conversation
   *  copy; overridden (e.g. by the integration gate) to explain the lock. */
  readOnlyPlaceholder?: string
  activitySource?: AgentConversation['activitySource']
  slackThread?: AgentSlackThread | null
  credentialSelector?: CredentialSelectorControl
  runtimeControl?: RuntimeControl
  modelSession?: ModelSession
  /** Runtime defaults the first message applies; shown until a session has its own model. */
  newConversationModelControl?: ReactNode
  /** Authorization-mode picker for this conversation (Auto Mode ↔ Bypass
   *  Permissions) — absent when the conversation has no session yet. */
  bypassControl?: { active: boolean; onSelect: (bypass: boolean) => void }
  pendingSeed?: AgentPromptSeed | null
  onSeedConsumed?: () => void
  /** No cloud connected — the example prompts must stay answerable read-only. */
  firstRun?: boolean
  autoFocus?: boolean
  /** Docked sidebar variant: matches the left content card's larger radius. */
  sidebar?: boolean
  // Panel-level drag-and-drop: the whole chat panel is the drop zone.
  // The composer publishes an "attach these dropped files" handler here so the
  // panel can route a drop to whichever composer is currently visible.
  dropRegisterRef?: { current: ((dt: DataTransfer) => void) | null }
  /** Where this composer's unsent text is kept; see composerDraftKey. */
  draftKey?: string
  /** Continue a local Claude Code / Codex session on the selected agent. Only
   *  the new-conversation composer has one; elsewhere the session list keeps
   *  attaching the log as a file. */
  onImportSession?: (session: LocalAgentSessionInfo) => void
  /** Turns on @teammate mentions; with a session, mentioned outsiders get an
   *  invite prompt after sending. */
  mentionScope?: { teamId: string; sessionId?: string }
  promptSuggestion?: string | null
}) {
  // A transport never authorizes execution or a client-owned follow-up queue.
  const streaming = false
  // A message the agent can't take yet is queued and sent later, not refused.
  const runtimeSendBlocked = Boolean(
    runtimeState &&
    !runtimeAllows(runtimeState, 'send') &&
    !runtimeAllows(runtimeState, 'steer') &&
    !runtimeAllows(runtimeState, 'reply') &&
    !runtimeMayAcceptLater(runtimeState),
  )
  const runtimeCanCancel = runtimeAllows(runtimeState, 'cancel')
  const modelControl = useSessionConfig(
    modelSession,
    runtimeState ? !runtimeAllows(runtimeState, 'send') : streaming,
  )
  const hero = variant === 'hero'
  const dormant = modelControl.data?.status === 'dormant' && !modelControl.data.options.length
  const showDefaultModel = Boolean(newConversationModelControl) && (!modelSession || dormant)
  const sendBlocked =
    runtimeSendBlocked ||
    modelControl.saving ||
    Boolean(
      runtimeControl?.onSelect &&
      (!runtimeControl.value || runtimeControl.value.status === 'disabled'),
    )
  const state = useComposerState({
    hero,
    firstRun,
    readOnly,
    readOnlyPlaceholder,
    streaming,
    autoFocus,
    promptSuggestion,
  })

  useComposerDraft(state, readOnly ? undefined : draftKey)
  const mentions = useComposerMentions(state.ref, state.syncEmpty, mentionScope)
  const actions = useComposerActions(state, {
    sendBlocked,
    readOnly,
    streaming,
    onSend: mentions.wrapSend(onSend),
    pendingSeed,
    onSeedConsumed,
    dropRegisterRef,
  })
  const { filePaths, isEmpty } = state

  function removeAttachment(filePath: string) {
    state.setFilePaths((prev) => prev.filter((path) => path !== filePath))
    state.setFolderPaths((prev) => {
      if (!prev.has(filePath)) return prev
      const next = new Set(prev)

      next.delete(filePath)

      return next
    })
    state.setImageThumbs((prev) => {
      if (!(filePath in prev)) return prev
      const next = { ...prev }

      delete next[filePath]

      return next
    })
  }

  const sendDisabled = sendBlocked || (isEmpty && filePaths.length === 0) || streaming || readOnly

  return (
    <div
      className={clsx(
        // The in-conversation composer needs room for its shadow to fall and
        // clearance from the pane edges; 4px left it wedged into the corner.
        // Docked, it takes the left sidebar's inset instead, and its bottom gap
        // matches the content card's own (`pb-2` on the main pane) so the two
        // columns end on the same line.
        hero ? '' : sidebar ? 'px-2.5 pb-2' : 'px-3 pb-3',
      )}
    >
      <div
        className={clsx(
          'relative mx-auto w-full',
          // No clipping: the sketch guide lines whose ±9999px extensions this
          // used to contain are gone, and the clip was slicing the composer's
          // shadow off at both sides.
          hero ? '' : 'max-w-[760px]',
        )}
      >
        <div
          className={clsx(
            'relative',
            // First-run keeps the pre-#629 flat look: a plain outlined box on
            // the white canvas, no shadow, no raised surface. The composer is
            // the whole page there, and a floating surface with nothing to
            // float above reads as detached rather than raised. Its 12px
            // radius also matches the connector tray tucked underneath.
            hero && firstRun
              ? 'transition-colors border bg-zGray-900/60 backdrop-blur border-zGray-800/80 focus-within:border-zGray-700 rounded-xl px-4 pt-3.5 pb-2.5'
              : clsx(
                  // Both variants share the same self-contained input-box
                  // look; the in-conversation (compact) composer is just a
                  // tighter version of the hero box instead of a full-width
                  // bottom strip. Opaque, not a translucent tint: the
                  // composer only reads as a surface if it holds its own
                  // value against the canvas.
                  'surface-raised composer-surface bg-composer',
                  hero
                    ? 'rounded-[24px] px-5 pt-4 pb-3'
                    : clsx(
                        'px-3 pt-2.5 pb-2',
                        // Docked, it reads as part of the same surface as the
                        // content card beside it, so it takes that card's
                        // corner exactly: `rounded-lg`, and the plain round
                        // shape too. `surface-raised` would otherwise curve it
                        // as a squircle, which at the same radius starts
                        // bending further from the corner and reads as the
                        // larger of the two. Page mode sits between that and
                        // the hero.
                        sidebar ? 'rounded-lg [corner-shape:round]' : 'rounded-[14px]',
                      ),
                ),
          )}
        >
          {mentions.ui}
          {filePaths.length > 0 && (
            <AttachmentChips
              filePaths={filePaths}
              folderPaths={state.folderPaths}
              imageThumbs={state.imageThumbs}
              onRemove={removeAttachment}
            />
          )}
          {readOnly ? (
            <ReadOnlyConversationNotice
              activitySource={activitySource}
              slackThread={slackThread}
              label={readOnlyPlaceholder}
            />
          ) : (
            <ComposerEditor
              hero={hero}
              streaming={streaming}
              hasEditorContent={state.hasEditorContent}
              canCompleteSuggestion={state.canCompleteSuggestion}
              displayedPlaceholder={state.displayedPlaceholder}
              placeholderRef={state.placeholderRef}
              editorRef={state.ref}
              onInput={() => {
                state.syncEmpty()
                mentions.onInput()
              }}
              onKeyDown={(e) => {
                if (!mentions.onKeyDown(e)) actions.onKeyDown(e)
              }}
              onPaste={actions.onPaste}
              onCompositionStart={state.onCompositionStart}
              onCompositionEnd={state.onCompositionEnd}
            />
          )}
          <div className="flex items-end gap-2 mt-1 min-w-0">
            <div className="flex flex-1 flex-wrap items-center gap-1 min-w-0">
              <ComposerAttachmentMenu
                open={state.attachmentMenuOpen}
                onOpenChange={state.setAttachmentMenuOpen}
                readOnly={readOnly}
                hero={hero}
                localSessionsBySource={state.localSessionsBySource}
                localSessionsLoading={state.localSessionsLoading}
                localSessionsError={state.localSessionsError}
                onOpenSource={actions.ensureLocalSessions}
                onAttachSession={actions.attachSession}
                onImportSession={onImportSession}
                onSelectAttachment={actions.selectAttachment}
                onSelectFolderAttachment={actions.selectFolderAttachment}
              />
              {credentialSelector && (
                <CredentialSelectorButton {...credentialSelector} hero={hero} />
              )}
              {bypassControl && <BypassControlMenu bypassControl={bypassControl} hero={hero} />}
              {runtimeControl && <RuntimeSelector {...runtimeControl} />}
              {showDefaultModel && newConversationModelControl}
            </div>
            {modelSession && !showDefaultModel && (
              <ModelSelector control={modelControl} disabled={readOnly} streaming={streaming} />
            )}
            <ComposerSendControls
              runtimeCanCancel={runtimeCanCancel}
              executing={executing}
              hero={hero}
              readOnly={readOnly}
              streaming={streaming}
              slackThread={slackThread}
              hasQueueablePayload={!(isEmpty && filePaths.length === 0)}
              sendDisabled={sendDisabled}
              onSubmit={actions.submit}
              onStop={onStop}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
