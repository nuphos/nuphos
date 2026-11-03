import { allCredentialAccess, credentialOptionsLoaded } from './credentialAccess'
import { unseenCredentials } from './credentialFreshness'
import { HOME_TAB_ID } from './model'
import { homeVisible } from './panelVisibility'
import { fileDropHandlers } from './fileDrop'

import type { CredentialSelectorControl } from './credentialSections'
import type { PanelCtx, PanelRenderState } from './ctx'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'activeTab'
  | 'conversationDropRef'
  | 'credentialOptions'
  | 'credentialsRefreshing'
  | 'credentialsSaving'
  | 'dragDepthRef'
  | 'effectiveCredentialAccess'
  | 'homeDropRef'
  | 'openingConversation'
  | 'pendingPrompt'
  | 'refreshCredentialOptions'
  | 'visible'
  | 'sessionIdProp'
  | 'setDraggingFiles'
  | 'teamId'
  | 'updateCredentialSelection'
  | 'variant'
>

export function computePanelRenderState(acc: Acc): PanelRenderState {
  const {
    activeId,
    activeTab,
    conversationDropRef,
    credentialOptions,
    credentialsRefreshing,
    credentialsSaving,
    dragDepthRef,
    effectiveCredentialAccess,
    homeDropRef,
    openingConversation,
    pendingPrompt,
    refreshCredentialOptions,
    sessionIdProp,
    setDraggingFiles,
    teamId,
    updateCredentialSelection,
    variant,
  } = acc

  const activeTabIsBlankDraft =
    activeTab?.messages.length === 0 &&
    !activeTab.streaming &&
    !activeTab.error &&
    !activeTab.readOnly
  // A page pointed at a conversation is always showing one — the transcript, or
  // the spinner until it lands. Without the last clause it falls back to the
  // home page on its first render and between opens, flashing a new-chat
  // composer where the conversation should be.
  const showingConversationPage =
    Boolean(openingConversation) ||
    (Boolean(activeTab) && !activeTabIsBlankDraft) ||
    (variant === 'page' && Boolean(sessionIdProp))
  // Drop routes to the composer of whichever page is visible.
  const activeDropTarget = () =>
    showingConversationPage ? conversationDropRef.current : homeDropRef.current
  const {
    onDragEnter: onPanelDragEnter,
    onDragOver: onPanelDragOver,
    onDragLeave: onPanelDragLeave,
    onDrop: onPanelDrop,
  } = fileDropHandlers({
    target: activeDropTarget,
    depth: dragDepthRef,
    setDragging: setDraggingFiles,
  })
  const credentialSelectorControl: CredentialSelectorControl | undefined = teamId
    ? {
        options: credentialOptions,
        value: effectiveCredentialAccess,
        saving: credentialsSaving || credentialsRefreshing,
        onOpen: () => void refreshCredentialOptions(),
        onChange: updateCredentialSelection,
      }
    : undefined
  const visibleHomeCredentialSelector = !showingConversationPage
    ? credentialSelectorControl
    : undefined
  const visibleConversationCredentialSelector =
    activeTab &&
    (!activeTab.foreign || activeTab.canManage) &&
    credentialSelectorControl &&
    (!activeTab.readOnly || activeTab.slackThread)
      ? {
          ...credentialSelectorControl,
          unseen: credentialOptionsLoaded(credentialOptions)
            ? unseenCredentials(
                allCredentialAccess(credentialOptions),
                activeTab.credentialOptionsSeen,
              )
            : undefined,
        }
      : undefined
  const pendingPromptReady =
    pendingPrompt?.newChat && activeId !== HOME_TAB_ID ? null : pendingPrompt
  // Switching conversations must not leave the previous transcript on screen
  // while the next one loads — in the Chats reader that reads as the click
  // having done nothing. The open lands `setTabs`, which clears this.
  const switchingConversation =
    openingConversation != null && openingConversation.sessionId !== activeTab?.sessionId

  return {
    activeTabIsBlankDraft,
    showingConversationPage,
    homeShown: homeVisible(acc.visible, showingConversationPage),
    onPanelDragEnter,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
    credentialSelectorControl,
    visibleHomeCredentialSelector,
    visibleConversationCredentialSelector,
    pendingPromptReady,
    switchingConversation,
  }
}
