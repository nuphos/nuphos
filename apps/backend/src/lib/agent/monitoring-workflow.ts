import { createHash } from 'node:crypto'

export const MONITORING_WORKFLOW_TOOL_GUIDANCE =
  'MONITORING WORKFLOWS: when the user asks to watch any monitoring/alert event and react to it, load the generic monitoring-workflow skill BEFORE creating anything. A matching provider skill is optional: use it when available for exact commands and special protocol details, but its absence is never by itself a blocker. Discover an unknown provider dynamically through the authenticated tools/CLI, its help or API schema, official documentation, live configuration read-back, and a non-investigating test payload. Prefer the managed Provider → Nuphos ingress → incidentMode Trigger → first-party slack_post path. Never replace Nuphos Slack delivery with Slack Incoming Webhooks, AWS Chatbot, or another provider-native Slack integration unless the user explicitly requests that architecture. If slack_list_destinations returns slack_not_connected, preserve the intended workflow and ask the user to connect the Nuphos Slack App; do not claim Nuphos lacks proactive Slack support. WATCH GROUPS: when a confirmed desktop handoff begins "Watch these monitoring items as one group:", call trigger_group_list to avoid duplicates, then trigger_group_create exactly once with every selected member key, a self-contained message template, and the approved destination. It creates one disabled shared ingress per provider/integration partition; never call trigger_create per member. Configure each returned ingress using the most efficient provider primitive: global/account subscription with local filtering, one policy route/contact point, one shared notification channel/topic, or a native composite/group rule. Poll only when push is impossible. Preserve existing destinations, reuse the same sender while applying any required exact member attachments in the returned bounded batches, read each batch back, drill the full selected scope, then call trigger_finalize_wiring with provider=watch_group, the exact partition/member keys, strategy, typed secret-free receipts, and one unique event match per member that includes its stable provider resource ID; finalization enables that ingress. Different matched members receive distinct incident scopes and must not share a Slack thread. The standalone workflow remains atomic: (1) create the Nuphos webhook trigger with monitoringIdentity set to a stable normalized provider key, the exact connected account/integration, and monitored resource (for Slack, also set incidentMode=true and persist the exact user-approved slackDestination), (2) use the provider API/CLI to create its webhook/contact point, notification channel, topic/subscription, or equivalent sender, (3) attach the exact monitored resource, preserving every existing notification destination by default, (4) read the provider configuration back and run a cheap non-investigating drill/test, then (5) call trigger_finalize_wiring with the exact secret-free provider resource receipt. Use a typed receipt when Nuphos has a provider-specific deterministic cleanup driver; otherwise use the generic receipt to record the provider identity and every external resource transparently. monitoringIdentity is mandatory for standalone provider Watches: the backend scopes and hashes it so retries in the same user/team reuse one trigger instead of creating duplicates. A compact desktop handoff beginning "Watch this monitoring item:" is the user\'s confirmation of the selected provider, exact item, action, and destination; it authorizes additive provider-side writes scoped to that existing alert item, so do not ask for a second confirmation. IMPORTANT EXCEPTION: a dashboard chart or bare metric is not an alert condition. When watching it would require creating a new alert policy/alarm, the handoff authorizes read-only revalidation only. Present the exact proposed condition semantics, ask for approval, then STOP and end the turn without creating a trigger, alarm/policy, notification resource, or any other resource. Only a later explicit user acceptance of that exact proposal authorizes condition creation and the remaining scoped wiring; never treat the agent\'s own recommendation or silence as approval. trigger_create only creates the receiver and is NEVER evidence that a monitoring workflow is live. For a Slack incidentMode firing, work like an on-call engineer: call incident_history first to see whether this alert has fired before and in which thread, post quickly from known payload facts so whoever is watching knows it is being looked at, then investigate and follow up in that same thread. Pass slack_post replyToThread with a threadTs from the history when this firing is the same problem still going or coming back; omit it to start a new thread when it is genuinely different. There is no message type to declare and nothing needs closing on recovery — say it recovered in its thread and stop. Do not hand the URL or setup steps to the user when the connected provider API/CLI can perform them. If provider permissions, webhook authentication, event semantics, or API capabilities block completion, report the exact blocker and safely roll back resources created by this attempt so no enabled half-configured workflow remains.'

export type MonitoringIdentity = {
  /** Stable lowercase provider key, for example grafana, aws, or tencent-cloud. */
  provider: string
  integrationId: string
  resourceId: string
}

function watchDedupeDigest(parts: string[]): string {
  return `watch:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`
}

/**
 * Scope provider retries without exposing those IDs to the model.
 *
 * A team Watch is a team resource, so its identity deliberately excludes the
 * creator: two colleagues wiring the same provider resource must converge on
 * one Trigger instead of provisioning duplicate provider-side wiring. Personal
 * Watches stay scoped to their owner.
 */
export function monitoringWatchDedupeKey(
  userId: string,
  teamId: string | undefined,
  identity: MonitoringIdentity,
): string {
  const parts = teamId
    ? ['team', teamId, identity.provider, identity.integrationId, identity.resourceId]
    : [userId, '', identity.provider, identity.integrationId, identity.resourceId]

  return watchDedupeDigest(parts)
}

/**
 * The key a team Watch would have had before team ownership. Creation checks
 * it so Watches wired under the old per-creator identity keep resolving to
 * their existing Trigger instead of being provisioned a second time.
 */
export function legacyMonitoringWatchDedupeKey(
  userId: string,
  teamId: string | undefined,
  identity: MonitoringIdentity,
): string | null {
  if (!teamId) return null

  return watchDedupeDigest([
    userId,
    teamId,
    identity.provider,
    identity.integrationId,
    identity.resourceId,
  ])
}

/**
 * One-time migration hint for Watches created before monitoringIdentity was
 * persisted. Callers must store the result before allowing messageTemplate to
 * change; all new Watches use their immutable identity instead.
 */
export function inferLegacyMonitoringProvider(input: {
  triggerType: 'cron' | 'webhook'
  source?: 'user' | 'agent' | 'automation'
  messageTemplate: string
}): string | undefined {
  if (input.triggerType !== 'webhook' || input.source !== 'agent') return undefined
  if (/Grafana alert notification/i.test(input.messageTemplate)) return 'grafana'
  if (/Cloud Monitoring notification/i.test(input.messageTemplate)) return 'gcp'
  if (/Better Stack incident event/i.test(input.messageTemplate)) return 'betterstack'
  if (/CloudWatch Alarm notification/i.test(input.messageTemplate)) return 'aws'

  return undefined
}

export type WebhookProviderWiring = {
  status: 'sender_not_connected'
  workflowComplete: false
  requiredNextAction: string
}

/**
 * Added to every webhook trigger result as a post-tool completion guard.
 * A webhook is inert until some external sender is configured to call it; the
 * explicit false status prevents the model from treating trigger_create as an
 * end-to-end monitoring success.
 */
export function pendingWebhookProviderWiring(): WebhookProviderWiring {
  return {
    status: 'sender_not_connected',
    workflowComplete: false,
    requiredNextAction:
      'Connect the external sender now. For a monitoring Watch, continue in this turn with the generic monitoring-workflow skill and the provider API/CLI: create its webhook/contact point or notification channel, attach the exact resource without removing existing destinations, read back and drill-test the wiring, then call trigger_finalize_wiring with the secret-free ownership receipt. Do not call the workflow live yet.',
  }
}
