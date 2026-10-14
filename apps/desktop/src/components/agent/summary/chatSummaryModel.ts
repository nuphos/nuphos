import { countSelectedCredentials } from '../panel/credentialSelectorButtonCounts.ts'

import type { AgentCredentialOptions } from '../../../api/agent-credential-types.ts'
import type { AgentConversation } from '../../../api/agent-types.ts'
import type { SessionResource } from '../../../api/session-resource-types.ts'
import type { FileTransferGroup } from '../../../types/app-misc.ts'

/** The chat itself, from the owner's list first and then the shared list. */
export function findConversation(
  sessionId: string,
  lists: readonly (readonly AgentConversation[])[],
): AgentConversation | undefined {
  for (const list of lists) {
    const found = list.find((conversation) => conversation.sessionId === sessionId)

    if (found) return found
  }

  return undefined
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

/** "nuphos/nuphos #12" for a pull request, the issue key ("ENG-12") for Linear. */
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

/** Connectors ticked for this chat, devices aside: those are shown with the runtime. */
export function connectorCount(conversation: AgentConversation | undefined): number {
  return conversation?.credentialAccess
    ? countSelectedCredentials(conversation.credentialAccess)
    : 0
}

/** Names of the devices this chat may run commands on, in the order they were ticked. */
export function deviceLabels(
  conversation: AgentConversation | undefined,
  devices: AgentCredentialOptions['devices'] | undefined,
): string[] {
  const ids = conversation?.credentialAccess?.deviceIds ?? []

  return ids.flatMap((id) => {
    const device = devices?.find((entry) => entry.deviceId === id)

    return device ? [device.label] : []
  })
}
