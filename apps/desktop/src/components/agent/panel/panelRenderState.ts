import { dataTransferHasFiles } from './attachments'
import { allCredentialAccess, credentialOptionsLoaded } from './credentialAccess'
import { unseenCredentials } from './credentialFreshness'
import { HOME_TAB_ID } from './model'
import { homeVisible } from './panelVisibility'

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
  const onPanelDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return
    // Always preventDefault on a file drag so it never falls through to
    // Electron's default file-open/navigation, even when no composer is
    // registered (read-only / opening states).
    e.preventDefault()
    if (!activeDropTarget()) return
    dragDepthRef.current += 1
    setDraggingFiles(true)
  }
  const onPanelDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return
    e.preventDefault() // block the browser default + let the drop event fire
    e.dataTransfer.dropEffect = activeDropTarget() ? 'copy' : 'none'
  }
  const onPanelDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }
  const onPanelDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(e.dataTransfer)) return
    e.preventDefault() // block the default file-open even if we can't attach
    dragDepthRef.current = 0
    setDraggingFiles(false)
    activeDropTarget()?.(e.dataTransfer)
  }
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
    !activeTab.foreign &&
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
