import { AgentHomePage } from './AgentHomePage'
import { Composer } from './Composer'
import { composerDraftKey } from './composerDrafts'
import { Welcome } from './homeAnimation'
import { useLocalSessionImport } from './importLocalSession'
import { ModelSelector } from './ModelSelector'
import { useAddAgent } from './useAddAgent'
import { useRuntimeModelConfig } from './useRuntimeModelConfig'

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
    newConversationSessionConfig,
    pickNewConversationSessionConfig,
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
    teamId,
    canUpdateTeamAgents: isTeamAdmin,
    value: newConversationRuntime,
    options: runtimeInstances,
    quotas: runtimeQuotas,
    onSelect: selectConversationRuntime,
    loading: runtimeInstancesLoading,
    error: runtimeInstancesError,
    onSettings: onOpenAgentSettings,
    ...addAgent.control,
  }
  // A local agent still starting has no models to report yet.
  const modelRuntimeId =
    newConversationRuntime?.status === 'active' && !newConversationRuntime.starting
      ? newConversationRuntime.id
      : undefined
  const modelControl = useRuntimeModelConfig(
    teamId,
    modelRuntimeId,
    newConversationSessionConfig,
    pickNewConversationSessionConfig,
  )
  const newConversationModelControl = modelRuntimeId && (
    <ModelSelector control={modelControl} disabled={false} streaming={false} />
  )

  const bypassControl = autoModeAvailable
    ? { active: defaultPermissionMode === 'bypass', onSelect: selectDefaultPermissionMode }
    : undefined

  return variant === 'page' ? (
    <>
      {addAgent.dialog}
      <AgentHomePage
        onOpenNuphosLink={c.onOpenNuphosLink}
        onImportSession={importSession}
        isTeamAdmin={isTeamAdmin}
        onOpenConversation={(sessionId, title) => void c.openConversation(sessionId, title)}
        newChatRequest={c.newChatRequest}
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
