import clsx from 'clsx'
import { useState } from 'react'

import { runtimeAllows } from '../../../lib/runtimeExecution'

import { clearAgentMenuRequest, useAgentMenuRequested } from './agentMenuRequest'
import { AttachmentChips } from './composerAttachments'
import { ComposerEditor, ComposerSendControls, ComposerTools } from './composerControls'
import { ComposerOverlays } from './ComposerOverlays'
import { BypassControlMenu, ComposerAttachmentMenu } from './composerMenus'
import { CredentialSelectorButton } from './CredentialSelectorButton'
import { ModelSelector } from './ModelSelector'
import { runtimeSendRefusal } from './queuedAutoSend'
import { ReadOnlyConversationNotice } from './ReadOnlyNotice'
import { runtimeControlSendBlock, shouldSwitchAgent } from './runtimeControlSignOut'
import { RuntimeSelector } from './RuntimeSelector'
import { useComposerActions } from './useComposerActions'
import { useComposerDraft } from './useComposerDraft'
import { useComposerMentions } from './useComposerMentions'
import { useComposerSlashCommands } from './useComposerSlashCommands'
import { useComposerState } from './useComposerState'
import { useSessionConfig } from './useSessionConfig'

import type { ComposerSend } from './composerMentionChips'
import type { ComposerRecall } from './composerRecall'
import type { CredentialSelectorControl } from './credentialSections'
import type { AgentPromptSeed } from './model'
import type { RuntimeControl } from './RuntimeSelector'
import type { ModelSession } from './useSessionConfig'
import type { ViewOnlyNotice } from './viewOnlyNotice'
import type { AgentConversation, AgentSlackThread, LocalAgentSessionInfo } from '../../../api'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'
import type { ReactNode } from 'react'

export function Composer({
  variant = 'compact',
  newChat = false,
  onSend,
  onStop,
  canStop,
  runtimeState,
  executing = false,
  readOnly = false,
  readOnlyNotice,
  activitySource,
  slackThread,
  credentialSelector,
  runtimeControl,
  modelSession,
  newConversationModelControl,
  bypassControl,
  pendingSeed,
  onSeedConsumed,
  autoFocus = false,
  sidebar = false,
  dropRegisterRef,
  draftKey,
  onImportSession,
  mentionScope,
  placeholder,
  promptSuggestion,
  recall,
  agentMenu,
  aboveStatus,
}: {
  variant?: 'compact' | 'hero'
  newChat?: boolean // a new chat fixes an unusable agent by picking another
  onSend: ComposerSend
  onStop: () => void
  /** Something is ahead of this person (canStopTurn); without it, what the runtime can cancel. */
  canStop?: boolean
  runtimeState?: RuntimeExecution
  executing?: boolean
  readOnly?: boolean
  /** While `readOnly`: the viewer's way on, beside the read-only copy. */
  readOnlyNotice?: ViewOnlyNotice
  activitySource?: AgentConversation['activitySource']
  slackThread?: AgentSlackThread | null
  credentialSelector?: CredentialSelectorControl
  runtimeControl?: RuntimeControl
  modelSession?: ModelSession
  /** Model settings for a conversation that does not exist yet. */
  newConversationModelControl?: ReactNode
  /** Authorization-mode picker for this conversation (Auto Mode ↔ Bypass
   *  Permissions) — absent when the conversation has no session yet. */
  bypassControl?: { active: boolean | undefined; onSelect: (bypass: boolean) => void }
  pendingSeed?: AgentPromptSeed | null
  onSeedConsumed?: () => void
  autoFocus?: boolean
  /** Docked sidebar variant: matches the left content card's larger radius. */
  sidebar?: boolean
  // The panel routes drops to the visible composer's handler.
  dropRegisterRef?: { current: ((dt: DataTransfer) => void) | null }
  /** Where this composer's unsent text is kept; see composerDraftKey. */
  draftKey?: string
  /** Continue a local session in the new-conversation composer. */
  onImportSession?: (session: LocalAgentSessionInfo) => void
  /** Enables @teammate mentions and invites mentioned outsiders after sending. */
  mentionScope?: Parameters<typeof useComposerMentions>[2]
  placeholder?: string
  promptSuggestion?: string | null
  recall?: ComposerRecall
  agentMenu?: [boolean, (open: boolean) => void] // the panel's, for a failed turn's Switch runtime
  aboveStatus?: ReactNode
}) {
  // A transport never authorizes execution or a client-owned follow-up queue.
  const streaming = false
  // Queued and sent later, not refused, unless it never will be (an outdated runtime): say why.
  const runtimeSendBlock = runtimeSendRefusal(runtimeState)
  const runtimeCanCancel = canStop ?? runtimeAllows(runtimeState, 'cancel')
  const modelControl = useSessionConfig(
    modelSession,
    runtimeState ? !runtimeAllows(runtimeState, 'send') : streaming,
  )
  const hero = variant === 'hero'
  const agentSendBlock = runtimeControlSendBlock(runtimeControl)
  const ownAgentMenu = useState(false) // the banner can open it
  const [agentMenuOpen, setAgentMenuOpen] = agentMenu ?? ownAgentMenu
  const agentMenuRequested = useAgentMenuRequested(runtimeControl?.sessionId)
  const switchAgent =
    newChat || shouldSwitchAgent(runtimeControl) ? () => setAgentMenuOpen(true) : undefined
  const sendBlocked = Boolean(runtimeSendBlock ?? agentSendBlock) || modelControl.saving
  const state = useComposerState({
    hero,
    readOnly,
    streaming,
    autoFocus,
    focusKey: draftKey,
    promptSuggestion,
    placeholder,
  })

  useComposerDraft(state, readOnly ? undefined : draftKey)
  const mentions = useComposerMentions(state.ref, state.syncEmpty, mentionScope, credentialSelector)
  const slash = useComposerSlashCommands(
    state.ref,
    state.composingRef,
    state.syncEmpty,
    modelSession && !modelSession.lockedHint && modelControl.data?.status !== 'unsupported'
      ? () => modelControl.setOpen(true)
      : undefined,
    { commands: runtimeState?.commands, runtimeId: runtimeControl?.value?.id },
  )
  const send: ComposerSend = (text, paths, people, options) =>
    onSend(text, paths, people, { ...options, imageThumbs: state.imageThumbs })
  const actions = useComposerActions(state, {
    sendBlocked,
    readOnly,
    streaming,
    onSend: mentions.wrapSend(slash.wrapSend(modelControl.wrapSend(send))),
    pendingSeed,
    onSeedConsumed,
    dropRegisterRef,
    recall,
  })
  const { filePaths, isEmpty } = state

  const sendDisabled = sendBlocked || (isEmpty && filePaths.length === 0) || streaming || readOnly

  return (
    <div
      className={clsx(
        // Docked, the bottom gap matches the content card; the hero leaves room above the greeting.
        hero ? 'pt-5' : sidebar ? 'pb-2' : 'pb-3',
      )}
    >
      <div className="relative w-full">
        <ComposerOverlays
          above={aboveStatus}
          control={readOnly ? undefined : runtimeControl}
          hero={hero}
          onSwitchAgent={switchAgent}
        />
        <div
          className={clsx(
            'relative',
            // Both variants use an opaque input surface; compact keeps the in-conversation spacing.
            'surface-raised composer-surface bg-composer',
            hero
              ? 'rounded-[24px] px-5 pt-4 pb-3'
              : clsx(
                  'px-3 pt-2.5 pb-2',
                  // Docked, it reads as part of the same surface as the content card beside it, so
                  // it takes that card's corner exactly: `rounded-lg`, and the plain round shape
                  // too. `surface-raised` would otherwise curve it as a squircle, which at the same
                  // radius starts bending further from the corner and reads as the larger of the
                  // two. Page mode sits between that and the hero.
                  sidebar ? 'rounded-lg [corner-shape:round]' : 'rounded-[14px]',
                ),
          )}
        >
          {mentions.ui}
          {slash.ui}
          {filePaths.length > 0 && (
            <AttachmentChips
              filePaths={filePaths}
              folderPaths={state.folderPaths}
              imageThumbs={state.imageThumbs}
              onRemove={state.removeAttachment}
            />
          )}
          {readOnly ? (
            <ReadOnlyConversationNotice
              activitySource={activitySource}
              slackThread={slackThread}
              action={readOnlyNotice?.action}
              secondary={readOnlyNotice?.secondary}
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
                slash.onInput()
              }}
              onKeyDown={(e) => {
                if (!slash.onKeyDown(e) && !mentions.onKeyDown(e)) actions.onKeyDown(e)
              }}
              onPaste={actions.onPaste}
              onCompositionStart={state.onCompositionStart}
              onCompositionEnd={() => {
                state.onCompositionEnd()
                slash.onInput()
              }}
            />
          )}
          <div className="@container flex items-start gap-1 mt-1 min-w-0 @[320px]:gap-2">
            <ComposerTools>
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
                <CredentialSelectorButton {...credentialSelector} hero={hero} personalIdentity />
              )}
              {bypassControl && <BypassControlMenu bypassControl={bypassControl} hero={hero} />}
              {runtimeControl && !runtimeControl.offlineAgent && (
                <RuntimeSelector
                  {...runtimeControl}
                  menuOpen={agentMenuOpen || agentMenuRequested}
                  onMenuOpenChange={(open) => {
                    setAgentMenuOpen(open)
                    if (!open) clearAgentMenuRequest()
                  }}
                  hero={hero}
                />
              )}
            </ComposerTools>
            {modelSession ? (
              <ModelSelector
                control={modelControl}
                disabled={readOnly || Boolean(modelSession.lockedHint)}
                disabledHint={modelSession.lockedHint}
                hero={hero}
              />
            ) : (
              newConversationModelControl
            )}
            <ComposerSendControls
              runtimeCanCancel={runtimeCanCancel}
              canSteer={
                runtimeAllows(runtimeState, 'steer') && !runtimeAllows(runtimeState, 'reply')
              }
              executing={executing}
              hero={hero}
              readOnly={readOnly}
              slackThread={slackThread}
              hasQueueablePayload={!(isEmpty && filePaths.length === 0)}
              sendDisabled={sendDisabled}
              sendBlockedReason={agentSendBlock ?? runtimeSendBlock}
              onConnectAgent={runtimeControl?.onConnectAgent}
              onSubmit={() => actions.submit()}
              onQueue={() => actions.submit('queue')}
              onStop={onStop}
              voice={{ editor: state.ref, teamId: mentionScope?.teamId }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
