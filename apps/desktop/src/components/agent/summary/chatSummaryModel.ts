import { EMPTY_CREDENTIAL_ACCESS } from '../panel/constants.ts'
import { countSelectedCredentials } from '../panel/credentialSelectorButtonCounts.ts'

import type { AgentConversation } from '../../../api/agent-types.ts'
import type { SessionResource } from '../../../api/session-resource-types.ts'
import type { FileTransferGroup } from '../../../types/app-misc.ts'

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

  return local ? 'This computer' : 'Cloud runtime'
}
