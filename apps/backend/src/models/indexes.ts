import { MongoServerError } from 'mongodb'

import { setupAutoModeIndexes } from '@/lib/agent/auto-mode/store'
import { setupAgentIndexes } from '@/lib/agent/db'
import { setupDeviceExecAuditIndexes } from '@/lib/agent/devices/audit'
import { setupLocalRuntimeActivityIndexes } from '@/lib/agent/devices/local-runtime/activity'
import { setupAgentDeviceIndexes } from '@/lib/agent/devices/store'
import { setupDirectoryIndexes } from '@/lib/agent/directory'
import { runMemoryProviderSetup } from '@/lib/agent/memory-slots'
import { setupMemoryAttributionIndexes } from '@/lib/agent/memory-slots/attribution-store'
import { setupMemoryIngestEventIndexes } from '@/lib/agent/memory-slots/ingest-events'
import { setupPreviewMemoryActivityIndexes } from '@/lib/agent/memory-slots/preview-activity-store'
import { setupPlanIndexes } from '@/lib/agent/plans'
import { setupSkillMetadataIndexes } from '@/lib/agent/skill-store/metadata'
import { setupTokenUsageIndexes } from '@/lib/agent/token-usage'
import { setupTriggerIndexes } from '@/lib/agent/trigger-db'
import { setupTriggerGroupIndexes } from '@/lib/agent/trigger-group-db'
import { setupRuntimeImageAuditIndexes } from '@/lib/claude-code-preview/runtime-image-audit'
import { setupRuntimeLoginIndexes } from '@/lib/claude-code-preview/runtime-login-store'
import { setupRuntimeMetricIndexes } from '@/lib/claude-code-preview/runtime-metrics-store'
import { setupRuntimeQuotaHistoryIndexes } from '@/lib/claude-code-preview/runtime-quota-history'
import { setupDiscordIndexes } from '@/lib/discord/store'
import { setupDownloadLinkEmailIndexes } from '@/lib/download-link-email'
import { setupEmailOtpIndexes } from '@/lib/email-otp'
import { setupIdentityIndexes } from '@/lib/identity'
import { setupPasswordIndexes } from '@/lib/identity/password'
import { setupLarkAgentIndexes } from '@/lib/lark/agent-bot'
import { setupNativeAuthIndexes } from '@/lib/native-auth'
import { logEvent } from '@/lib/observability'
import { setupPushDeviceIndexes } from '@/lib/push/devices'
import { setupSlackAgentIndexes } from '@/lib/slack/agent-bot'
import { setupSlackNotificationIncidentIndexes } from '@/lib/slack/incident-notifications'
import { setupSlackIncidentOccurrenceIndexes } from '@/lib/slack/incident-occurrences'
import { setupCoreIndexes } from '@/models/indexes-core'
import { agentInstructions } from '@/models/instructions'
import { teamHomeLayouts, teamInvitations, userTeamSidebarFavorites } from '@/models/team'

// Mongo 85/86 = an index with this name already exists under a different spec
// — typically another branch's backend upgraded it on the shared replica set.
// Skip that group with a warning instead of aborting startup: crash-looping
// every boot is worse, and the remaining groups still get their indexes.
export async function tolerateIndexConflict(
  setup: () => Promise<unknown>,
  label: string,
): Promise<void> {
  try {
    await setup()
  } catch (error) {
    if (error instanceof MongoServerError && (error.code === 85 || error.code === 86)) {
      logEvent('warn', 'backend.mongodb.index_conflict_ignored', {
        label,
        message: error.message,
      })
    } else {
      throw error
    }
  }
}

export async function setupIndexes(): Promise<void> {
  const groups: [string, () => Promise<unknown>][] = [
    ['core', setupCoreIndexes],
    ['identity', setupIdentityIndexes],
    ['email-otp', setupEmailOtpIndexes],
    ['password-login', setupPasswordIndexes],
    ['download-link-email', setupDownloadLinkEmailIndexes],
    ['native-auth', setupNativeAuthIndexes],
    ['runtime-login', setupRuntimeLoginIndexes],
    ['runtime-metrics', setupRuntimeMetricIndexes],
    ['runtime-quota-history', setupRuntimeQuotaHistoryIndexes],
    ['runtime-image-audit', setupRuntimeImageAuditIndexes],
    ['invitations', setupInvitationIndexes],
    ['agent', setupAgentIndexes],
    ['token-usage', setupTokenUsageIndexes],
    ['directory', setupDirectoryIndexes],
    ['triggers', setupTriggerIndexes],
    ['trigger-groups', setupTriggerGroupIndexes],
    ['plans', setupPlanIndexes],
    ['skill-metadata', setupSkillMetadataIndexes],
    ['auto-mode', setupAutoModeIndexes],
    ['slack-agent', setupSlackAgentIndexes],
    ['slack-incident-occurrences', setupSlackIncidentOccurrenceIndexes],
    ['slack-notification-incidents', setupSlackNotificationIncidentIndexes],
    ['discord', setupDiscordIndexes],
    ['lark-agent', setupLarkAgentIndexes],
    // Every registered memory provider's setup(), per-provider fail-soft: a
    // broken provider reports availability {state:'error'}, boot continues.
    ['memory-providers', runMemoryProviderSetup],
    ['memory-attribution', setupMemoryAttributionIndexes],
    // Runtime-owned (like memory-attribution): durable IngestOutcome
    // snapshots behind GET /memories/ingest/:sessionId — never a provider's.
    ['memory-ingest-events', setupMemoryIngestEventIndexes],
    ['preview-memory-activity', setupPreviewMemoryActivityIndexes],
    ['sidebar-favorites', setupSidebarFavoritesIndexes],
    ['home-layouts', setupHomeLayoutIndexes],
    ['push-devices', setupPushDeviceIndexes],
    ['agent-devices', setupAgentDeviceIndexes],
    ['agent-device-exec-audit', setupDeviceExecAuditIndexes],
    ['agent-device-runtime-sessions', setupLocalRuntimeActivityIndexes],
    ['agent-instructions', setupAgentInstructionIndexes],
  ]

  // Build every group in parallel. The groups are independent, and on a
  // high-RTT remote mongo (~180ms) the old serial `for await` was the single
  // biggest startup cost — ~24s of round-trips waiting one index at a time.
  // Each group still gets its own tolerateIndexConflict so one group's
  // conflict/error can't sink the others.
  await Promise.all(
    groups.map(async ([label, setup]) => {
      const t = Date.now()

      await tolerateIndexConflict(setup, label)
      logEvent('info', 'backend.mongodb.index_group_ready', { label, ms: Date.now() - t })
    }),
  )
}

async function setupSidebarFavoritesIndexes(): Promise<void> {
  await userTeamSidebarFavorites().createIndex(
    { teamId: 1, userId: 1 },
    { unique: true, name: 'user_team_sidebar_favorites_scope_unique' },
  )
}

async function setupHomeLayoutIndexes(): Promise<void> {
  await teamHomeLayouts().createIndex(
    { teamId: 1, userId: 1 },
    { unique: true, name: 'team_home_layouts_scope_unique' },
  )
}

async function setupAgentInstructionIndexes(): Promise<void> {
  await agentInstructions().createIndex(
    { teamId: 1, scope: 1, userId: 1, createdAt: 1 },
    { name: 'agent_instructions_scope_order' },
  )
}

async function setupInvitationIndexes(): Promise<void> {
  await teamInvitations().createIndex({ inviteeEmail: 1, invitedAt: -1 }, { background: true })
  try {
    await teamInvitations().dropIndex('teamId_1_inviteeEmail_1')
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== 'IndexNotFound') throw err
  }
  await teamInvitations().createIndex(
    { teamId: 1, inviteeEmail: 1 },
    {
      unique: true,
      background: true,
      name: 'pending_team_invitee_unique',
      partialFilterExpression: {
        acceptedAt: null,
        rejectedAt: null,
      },
    },
  )
}
