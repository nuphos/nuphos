import { t } from '../../../i18n/index.ts'
import { subAgentState } from '../../../lib/subAgentState.ts'
import { changeStatus } from '../../sidebar/sessionResourcePresentation.ts'
import { EMPTY_CREDENTIAL_ACCESS } from '../panel/constants.ts'
import { countSelectedCredentials } from '../panel/credentialSelectorButtonCounts.ts'

import type { AgentConversation } from '../../../api/agent-types.ts'
import type { SessionResource } from '../../../api/session-resource-types.ts'
import type { ChangesFilter, SubAgentsFilter } from '../../../lib/chatSummaryPanel.ts'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'
import type { SubAgentState } from '../../../lib/subAgentState.ts'
import type { FileTransferGroup } from '../../../types/app-misc.ts'
import type { ChangeStatus } from '../../sidebar/sessionResourcePresentation.ts'

/**
 * The chat itself: from the owner's list, then the shared list, which the
 * sidebar keeps polling, and otherwise as the transcript opened it. An archived
 * chat is in neither list.
 */
export function findConversation(
  sessionId: string,
  lists: readonly (readonly AgentConversation[])[],
  opened?: AgentConversation,
): AgentConversation | undefined {
  for (const list of lists) {
    const found = list.find((conversation) => conversation.sessionId === sessionId)

    if (found) return found
  }

  return opened?.sessionId === sessionId ? opened : undefined
}

/** Threads this chat started, newest activity first, each listed once. */
export function subThreadsOf(
  sessionId: string,
  lists: readonly (readonly AgentConversation[])[],
): AgentConversation[] {
  const byId = new Map<string, AgentConversation>()

  for (const list of lists) {
    for (const conversation of list) {
      if (conversation.parentSessionId === sessionId && !byId.has(conversation.sessionId))
        byId.set(conversation.sessionId, conversation)
    }
  }

  return [...byId.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
}

/** Pull requests and issues. Slack and Discord links are the chat's own thread, not changes. */
export function changesOf(resources: readonly SessionResource[]): SessionResource[] {
  return resources
    .filter((resource) => resource.provider === 'github' || resource.provider === 'linear')
    .sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
}

const STATUS_ORDER: readonly ChangeStatus[] = ['open', 'merged', 'closed']

/** How many changes are in each status. */
export function changeCounts(changes: readonly SessionResource[]): Record<ChangeStatus, number> {
  const counts = { open: 0, merged: 0, closed: 0 }

  for (const change of changes) counts[changeStatus(change)] += 1

  return counts
}

/**
 * A status as the filter names it. Completed Linear issues share the merged
 * group, so the group reads "Done" until it holds a pull request.
 */
export function changeStatusLabel(
  status: ChangeStatus,
  changes: readonly SessionResource[],
): string {
  if (status === 'open') return t('Open|state')
  if (status === 'closed') return t('Closed')

  return changes.some((change) => change.provider === 'github' && changeStatus(change) === 'merged')
    ? t('Merged')
    : t('Done')
}

export type ChangesFilterOption = { filter: ChangesFilter; label: string; count: number }

/**
 * All, then each status that has changes. Empty when every change shares one
 * status, since a filter would then have nothing to tell apart.
 */
export function changesFilterOptions(changes: readonly SessionResource[]): ChangesFilterOption[] {
  const counts = changeCounts(changes)
  const statuses = STATUS_ORDER.filter((status) => counts[status] > 0)

  if (statuses.length < 2) return []

  return [
    { filter: 'all', label: t('All'), count: changes.length },
    ...statuses.map((status) => ({
      filter: status,
      label: changeStatusLabel(status, changes),
      count: counts[status],
    })),
  ]
}

/**
 * The filter to show among `options`: the stored one, or All when it matches
 * nothing here, so another chat never opens on an empty list. The stored value
 * stays as it is.
 */
export function shownChangesFilter(
  stored: ChangesFilter,
  options: readonly ChangesFilterOption[],
): ChangesFilter {
  return options.some((option) => option.filter === stored) ? stored : 'all'
}

/**
 * The changes a filter shows. All lists open, then merged, then closed; each
 * status keeps the order it came in (newest link first from changesOf).
 */
export function filterChanges(
  changes: readonly SessionResource[],
  filter: ChangesFilter,
): SessionResource[] {
  if (filter !== 'all') return changes.filter((change) => changeStatus(change) === filter)

  return STATUS_ORDER.flatMap((status) =>
    changes.filter((change) => changeStatus(change) === status),
  )
}

export type SubAgent = { conversation: AgentConversation; state: SubAgentState }

/** Each thread with its state, from the states the lists published. */
export function subAgentsOf(
  threads: readonly AgentConversation[],
  runtimeStates: ReadonlyMap<string, RuntimeExecution>,
): SubAgent[] {
  return threads.map((conversation) => ({
    conversation,
    state: subAgentState(conversation, runtimeStates.get(conversation.sessionId)),
  }))
}

type SubAgentStatus = Exclude<SubAgentsFilter, 'all'>

const SUB_AGENT_STATUS_ORDER: readonly SubAgentStatus[] = ['active', 'done']

/** Asking or running is active; the filter tells those apart from finished ones. */
function subAgentStatus({ state }: SubAgent): SubAgentStatus {
  return state === 'done' ? 'done' : 'active'
}

export type SubAgentsFilterOption = { filter: SubAgentsFilter; label: string; count: number }

/**
 * All, Active and Done with their counts. Empty when every sub-agent is
 * active or every one is done, since a filter would then tell nothing apart.
 */
export function subAgentsFilterOptions(subAgents: readonly SubAgent[]): SubAgentsFilterOption[] {
  const active = subAgents.filter((subAgent) => subAgentStatus(subAgent) === 'active').length
  const done = subAgents.length - active

  if (active === 0 || done === 0) return []

  return [
    { filter: 'all', label: t('All'), count: subAgents.length },
    { filter: 'active', label: t('Active'), count: active },
    { filter: 'done', label: t('Done'), count: done },
  ]
}

/**
 * The filter to show among `options`: the stored one, or All when it matches
 * nothing here. Active is stored until a pill is chosen, so a chat opens on
 * its active sub-agents when it has some and on all of them otherwise.
 */
export function shownSubAgentsFilter(
  stored: SubAgentsFilter,
  options: readonly SubAgentsFilterOption[],
): SubAgentsFilter {
  return options.some((option) => option.filter === stored) ? stored : 'all'
}

/**
 * The sub-agents a filter shows. All lists active ones, then done ones; each
 * group keeps the order it came in (newest activity first from subThreadsOf).
 */
export function filterSubAgents(
  subAgents: readonly SubAgent[],
  filter: SubAgentsFilter,
): SubAgent[] {
  if (filter !== 'all') return subAgents.filter((subAgent) => subAgentStatus(subAgent) === filter)

  return SUB_AGENT_STATUS_ORDER.flatMap((status) =>
    subAgents.filter((subAgent) => subAgentStatus(subAgent) === status),
  )
}

/** "nuphos #12" for a pull request, the issue key ("ENG-12") for Linear. */
export function changeSubtitle(resource: SessionResource): string {
  if (resource.provider === 'github') {
    const repo = resource.repository?.split('/').at(-1) ?? ''

    return `${repo} #${String(resource.number ?? '')}`.trim()
  }

  return resource.title.split(/\s+/, 1)[0] ?? ''
}

/** Linear titles arrive as "ENG-12 Title"; the row shows the title and the key below it. */
export function changeTitle(resource: SessionResource): string {
  if (resource.provider !== 'linear') return resource.title
  const key = changeSubtitle(resource)

  return resource.title.startsWith(`${key} `)
    ? resource.title.slice(key.length + 1)
    : resource.title
}

export type OutputFile = {
  groupId: string
  fileId: string
  fileName: string
  image: boolean
}

/** Files the agent handed over in this chat that can still be downloaded, newest first. */
export function outputFilesOf(groups: readonly FileTransferGroup[], now: number): OutputFile[] {
  return [...groups]
    .filter((group) => group.direction === 'download' && Date.parse(group.expiresAt) > now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((group) =>
      group.files
        .filter((file) => file.status === 'ready')
        .map((file) => ({
          groupId: group.groupId,
          fileId: file.id,
          fileName: file.fileName,
          image: file.contentType?.startsWith('image/') === true,
        })),
    )
}

/** Splits "a-very-long-name.png" so a row can cut the name and keep the extension. */
export function splitFileName(fileName: string): [string, string] {
  const dot = fileName.lastIndexOf('.')

  return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, '']
}

// A stored selection can predate newer credential kinds, so missing kinds count as none.
function credentialAccessOf(conversation: AgentConversation | undefined) {
  return { ...EMPTY_CREDENTIAL_ACCESS, ...conversation?.credentialAccess }
}

/** Connectors ticked for this chat, devices aside: those are shown with the runtime. */
export function connectorCount(conversation: AgentConversation | undefined): number {
  return countSelectedCredentials(credentialAccessOf(conversation))
}

export function deviceCount(conversation: AgentConversation | undefined): number {
  return credentialAccessOf(conversation).deviceIds.length
}

/** The machine a runtime label names: "MacBook-Pro.local · Claude Code" → "MacBook-Pro.local". */
export function machineName(label: string | undefined, local: boolean): string {
  const name = label?.split(' · ')[0]?.trim()

  if (name) return name

  return local ? t('This computer') : t('Cloud runtime')
}
