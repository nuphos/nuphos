import { AgentHomePage } from './AgentHomePage'
import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { Welcome } from './homeAnimation'
import { useLocalSessionImport } from './importLocalSession'
import { NewConversationModelSelector } from './NewConversationModelSelector'
import { useAddAgent } from './useAddAgent'

import type { PanelViewCtx } from './ctx'

export function PanelHomePage({ c }: { c: PanelViewCtx }) {
  const {
    autoFocusComposer,
    autoModeAvailable,
    defaultPermissionMode,
    history,
    historyLoading,
    homeDropRef,
    homeStarterSuggestions,
    isTeamAdmin,
    newConversationRuntime,
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
    runtimeQuotas,
    onOpenAgentSettings,
    selectConversationRuntime,
    isSidebarMode,
    onPromptConsumed,
    onStartConnect,
    pendingPromptReady,
    selectDefaultPermissionMode,
    sendInActive,
    startChatWith,
    stopActive,
    teamId,
    unbound,
    variant,
    visibleHomeCredentialSelector,
  } = c
  const addAgent = useAddAgent(teamId, isTeamAdmin, selectConversationRuntime)
  const { importSession } = useLocalSessionImport({
    teamId,
    runtime: newConversationRuntime,
    openConversation: c.openConversation,
  })

  const runtimeControl = {
    value: newConversationRuntime,
    options: runtimeInstances,
    quotas: runtimeQuotas,
    onSelect: selectConversationRuntime,
    loading: runtimeInstancesLoading,
    error: runtimeInstancesError,
    onSettings: onOpenAgentSettings,
    ...addAgent.control,
  }
  const newConversationModelControl = (
    <NewConversationModelSelector
      teamId={teamId}
      runtime={newConversationRuntime}
      isTeamAdmin={isTeamAdmin}
    />
  )

  const bypassControl = autoModeAvailable
    ? { active: defaultPermissionMode === 'bypass', onSelect: selectDefaultPermissionMode }
    : undefined

  return variant === 'page' ? (
    <>
      {addAgent.dialog}
      <AgentHomePage
        onImportSession={importSession}
        onOpenConversation={(sessionId, title) => void c.openConversation(sessionId, title)}
        isTeamAdmin={isTeamAdmin}
        shown={c.homeShown}
        userName={c.userName}
        conversations={history}
        loading={historyLoading}
        onSend={(text, filePaths) => void sendInActive(text, filePaths)}
        onStop={stopActive}
        streaming={false}
        credentialSelector={visibleHomeCredentialSelector}
        runtimeControl={runtimeControl}
        newConversationModelControl={newConversationModelControl}
        bypassControl={bypassControl}
        pendingSeed={pendingPromptReady}
        onSeedConsumed={onPromptConsumed}
        autoFocusComposer={autoFocusComposer}
        dropRegisterRef={homeDropRef}
        unbound={unbound}
        onStartConnect={onStartConnect}
        teamId={teamId}
        starterSuggestions={homeStarterSuggestions.suggestions}
        starterSuggestionsLoading={homeStarterSuggestions.loading}
      />
    </>
  ) : (
    <>
      {addAgent.dialog}
      <Welcome onPick={(prompt) => startChatWith(prompt)} />
      <Composer
        onSend={(text, filePaths) => void sendInActive(text, filePaths)}
        onStop={stopActive}
        streaming={false}
        credentialSelector={visibleHomeCredentialSelector}
        runtimeControl={runtimeControl}
        newConversationModelControl={newConversationModelControl}
        bypassControl={bypassControl}
        pendingSeed={pendingPromptReady}
        onSeedConsumed={onPromptConsumed}
        sidebar={isSidebarMode}
        dropRegisterRef={homeDropRef}
        draftKey={composerDraftKey(teamId)}
        onImportSession={importSession}
      />
    </>
  )
}
