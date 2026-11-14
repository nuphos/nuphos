import { useEffect } from 'react'

import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentTier } from '../../../lib/agentName'
import { pickNextTaskAgent, useNextTaskProject } from '../../../lib/taskProjects'
import { openAgentSetup } from '../../../views/onboarding/setup/agentSetupStore'

import { AgentHomePage } from './AgentHomePage'
import { ChatColumn } from './ChatColumn'
import { Composer } from './Composer'
import { newChatDraftKey } from './composerDrafts'
import { Welcome } from './homeAnimation'
import { useLocalSessionImport } from './importLocalSession'
import { ModelSelector } from './ModelSelector'
import { noAgentToRun } from './runtimeControlSignOut'
import { useAddAgent } from './useAddAgent'
import { useRuntimeModelConfig } from './useRuntimeModelConfig'

import type { PanelViewCtx } from './ctx'
import type { RuntimeInstance } from '../../../types/runtime'

export function PanelHomePage({ c }: { c: PanelViewCtx }) {
  const {
    autoFocusComposer,
    defaultPermissionMode,
    homeDropRef,
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
    pendingPromptReady,
    selectDefaultPermissionMode,
    sendInActive,
    startChatWith,
    stopActive,
    teamId,
    variant,
    visibleHomeCredentialSelector,
  } = c
  const draftKey = newChatDraftKey(teamId, c.newChatDraftId)
  const project = useTaskProject(c)
  const owner = useThisComputer()
  const addAgent = useAddAgent(teamId, selectConversationRuntime)
  const { importSession } = useLocalSessionImport({
    teamId,
    runtime: newConversationRuntime,
    openConversation: c.openConversation,
  })

  // The draft stays in the composer while setup runs over it.
  const onConnectAgent = noAgentToRun(
    runtimeInstances,
    runtimeInstancesLoading,
    runtimeInstancesError,
  )
    ? openAgentSetup
    : undefined

  const runtimeControl = {
    teamId,
    canUpdateTeamAgents: isTeamAdmin,
    value: newConversationRuntime,
    options: runtimeInstances,
    quotas: runtimeQuotas,
    onSelect: (runtimeId: string) => {
      const agent = runtimeInstances.find((instance) => instance.id === runtimeId)

      pickNextTaskAgent(teamId, !agent || agentTier(agent, owner) === 'local')
      selectConversationRuntime(runtimeId)
    },
    loading: runtimeInstancesLoading,
    error: runtimeInstancesError,
    onSettings: onOpenAgentSettings,
    ...addAgent.control,
    onConnectAgent,
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
    <ModelSelector control={modelControl} disabled={false} hero={variant === 'page'} />
  )

  const bypassControl = {
    active: defaultPermissionMode === 'bypass',
    onSelect: selectDefaultPermissionMode,
  }

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
        project={project}
        onSend={(text, filePaths, mentions) =>
          sendInActive(text, filePaths, undefined, undefined, mentions)
        }
        onStop={stopActive}
        credentialSelector={visibleHomeCredentialSelector}
        runtimeControl={runtimeControl}
        newConversationModelControl={newConversationModelControl}
        bypassControl={bypassControl}
        // The page keeps both views mounted; only the one on screen takes a seed, or it is sent twice.
        pendingSeed={c.homeShown ? pendingPromptReady : null}
        onSeedConsumed={onPromptConsumed}
        autoFocusComposer={autoFocusComposer}
        dropRegisterRef={homeDropRef}
        teamId={teamId}
        draftKey={draftKey}
      />
    </>
  ) : (
    <>
      {addAgent.dialog}
      <Welcome onPick={(prompt) => (onConnectAgent ? onConnectAgent() : startChatWith(prompt))} />
      <ChatColumn sidebar={isSidebarMode}>
        <Composer
          newChat
          onSend={(text, filePaths, mentions) =>
            sendInActive(text, filePaths, undefined, undefined, mentions)
          }
          onStop={stopActive}
          credentialSelector={visibleHomeCredentialSelector}
          runtimeControl={runtimeControl}
          newConversationModelControl={newConversationModelControl}
          bypassControl={bypassControl}
          pendingSeed={pendingPromptReady}
          onSeedConsumed={onPromptConsumed}
          sidebar={isSidebarMode}
          dropRegisterRef={homeDropRef}
          draftKey={draftKey}
          onImportSession={importSession}
          mentionScope={teamId ? { teamId } : undefined}
        />
      </ChatColumn>
    </>
  )
}

/** A task started from a project runs on this computer, where its folder is. */
function useTaskProject(c: PanelViewCtx): string | null {
  const { teamId, newConversationRuntime, runtimeInstances, selectConversationRuntime } = c
  const project = useNextTaskProject(teamId)
  const owner = useThisComputer()

  useEffect(() => {
    const here = (agent: RuntimeInstance) => agentTier(agent, owner) === 'local'

    if (!project || (newConversationRuntime && here(newConversationRuntime))) return
    const agent = runtimeInstances.find(
      (instance) => instance.status === 'active' && here(instance),
    )

    if (agent) selectConversationRuntime(agent.id)
  }, [project, newConversationRuntime, runtimeInstances, owner, selectConversationRuntime])

  return project
}
