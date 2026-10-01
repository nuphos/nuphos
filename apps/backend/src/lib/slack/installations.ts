import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { decryptSlackSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { SlackWorkspaceBinding } from '@/models'

export type ResolvedSlackBot = {
  botToken: string
  botUserId: string
  nuphosTeamId: string
  binding: SlackWorkspaceBinding
}

export async function getSlackBindingForTeam(
  teamId: ObjectId,
): Promise<SlackWorkspaceBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { slackWorkspaces: 1 } },
  )

  return doc?.slackWorkspaces?.[0] ?? null
}

export async function getSlackBindingByWorkspaceId(
  slackTeamId: string,
): Promise<{ nuphosTeamId: ObjectId; binding: SlackWorkspaceBinding } | null> {
  const doc = await teamByosBindings().findOne(
    { 'slackWorkspaces.slackTeamId': slackTeamId },
    { projection: { slackWorkspaces: 1 } },
  )

  if (!doc) return null
  const binding = doc.slackWorkspaces?.find((entry) => entry.slackTeamId === slackTeamId)

  if (!binding) return null

  return { nuphosTeamId: doc._id, binding }
}

/**
 * First-party installation for a workspace, or null — never the legacy
 * shared-token fallback. Channel-scoped grants to other teams borrow this bot,
 * so the fallback (which has no owning team) must stay out of that path.
 */
export async function resolveInstalledWorkspaceBot(slackTeamId: string): Promise<{
  botToken: string
  workspaceName: string
  nuphosTeamId: string
} | null> {
  const installed = await getSlackBindingByWorkspaceId(slackTeamId)

  if (!installed) return null

  return {
    botToken: decryptSlackSecret(installed.binding.encryptedBotToken),
    workspaceName: installed.binding.slackTeamName,
    nuphosTeamId: installed.nuphosTeamId.toHexString(),
  }
}

export async function resolveSlackBotForWorkspace(
  slackTeamId: string,
): Promise<ResolvedSlackBot | null> {
  const installed = await getSlackBindingByWorkspaceId(slackTeamId)

  if (installed) {
    return {
      botToken: decryptSlackSecret(installed.binding.encryptedBotToken),
      botUserId: installed.binding.botUserId,
      nuphosTeamId: installed.nuphosTeamId.toHexString(),
      binding: installed.binding,
    }
  }
  if (config.slack.botToken) {
    return {
      botToken: config.slack.botToken,
      botUserId: config.slack.botUserId ?? '',
      nuphosTeamId: '',
      binding: {
        id: new ObjectId(),
        slackTeamId,
        slackTeamName: slackTeamId,
        botUserId: config.slack.botUserId ?? '',
        encryptedBotToken: {
          v: 1,
          alg: 'A256GCM',
          keyId: 'legacy',
          iv: '',
          authTag: '',
          ciphertext: '',
        },
        installerSlackUserId: null,
        scope: '',
        createdAt: new Date(),
      },
    }
  }

  return null
}

export async function resolveSlackBotForTeam(teamId: ObjectId): Promise<ResolvedSlackBot | null> {
  const binding = await getSlackBindingForTeam(teamId)

  if (binding) {
    return {
      botToken: decryptSlackSecret(binding.encryptedBotToken),
      botUserId: binding.botUserId,
      nuphosTeamId: teamId.toHexString(),
      binding,
    }
  }
  if (config.slack.botToken) {
    return {
      botToken: config.slack.botToken,
      botUserId: config.slack.botUserId ?? '',
      nuphosTeamId: teamId.toHexString(),
      binding: {
        id: new ObjectId(),
        slackTeamId: '',
        slackTeamName: '',
        botUserId: config.slack.botUserId ?? '',
        encryptedBotToken: {
          v: 1,
          alg: 'A256GCM',
          keyId: 'legacy',
          iv: '',
          authTag: '',
          ciphertext: '',
        },
        installerSlackUserId: null,
        scope: '',
        createdAt: new Date(),
      },
    }
  }

  return null
}

export function publicSlackInstallationView(binding: SlackWorkspaceBinding) {
  return {
    id: binding.id.toHexString(),
    slackTeamId: binding.slackTeamId,
    slackTeamName: binding.slackTeamName,
    botUserId: binding.botUserId,
    scope: binding.scope,
    createdAt: binding.createdAt,
  }
}

export async function assertSlackWorkspaceAvailable(
  slackTeamId: string,
  teamId: ObjectId,
): Promise<void> {
  const existing = await getSlackBindingByWorkspaceId(slackTeamId)

  if (existing && !existing.nuphosTeamId.equals(teamId)) {
    throw new AppError(
      409,
      'slack_workspace_taken',
      'This Slack workspace is already connected to another Nuphos team',
    )
  }
}
