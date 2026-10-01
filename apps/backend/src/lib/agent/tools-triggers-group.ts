import { tool } from 'ai'
import { z } from 'zod'

import {
  chunkGroupMembers,
  groupWebhookUrl,
  label,
  run,
  slackDestinationSchema,
} from './tools-triggers-shared'
import {
  createTriggerGroup,
  finalizeTriggerGroupIngress,
  listTriggerGroups,
} from './trigger-group-service'
import { monitoringProviderWiringSchema } from './trigger-provider-wiring'
import { finalizeTriggerProviderWiring } from './trigger-service'

import type { AgentSessionOrigin, TriggerToolScope } from './tools-triggers-shared'

export function createTriggerGroupTools(deps: {
  userId: string
  teamId: string | null | undefined
  origin: AgentSessionOrigin
  scope: TriggerToolScope
}) {
  const { userId, teamId, origin, scope } = deps

  const trigger_group_create = tool({
    description:
      "Create one Watch Group with a shared webhook ingress per provider/integration partition. Use only when the user selected 2-50 monitoring items to manage together. Pass every exact stable memberKey, one self-contained investigation messageTemplate, and the single approved Slack destination (omit for Nuphos-only reporting). This tool creates the bounded ingress triggers itself; DO NOT call trigger_create for individual members. Configure each returned ingress with the provider's most efficient shared strategy (global subscription, policy route, shared notification channel/topic, or native group). After read-back and a non-investigating drill, finalize that ingress with trigger_finalize_wiring using provider=watch_group.",
    inputSchema: z.object({
      label,
      name: z.string().min(1).max(100),
      memberKeys: z
        .array(z.string().min(1).max(1200))
        .min(2)
        .max(50)
        .describe('The exact unique member keys from the user-approved Watch Group prompt.'),
      messageTemplate: z
        .string()
        .min(1)
        .describe(
          'Self-contained instruction used for every matching group member. The server adds the matched member identity to trigger.group.member.',
        ),
      minIntervalSeconds: z.number().int().min(0).max(86400).optional(),
      slackDestination: slackDestinationSchema
        .optional()
        .describe('The single Slack destination approved for the group; omit for Nuphos.'),
    }),
    execute: async (input) =>
      run(async () => {
        if (origin === 'trigger') {
          return {
            ok: false as const,
            error: 'trigger_group_create is disabled in sessions fired by a trigger',
          }
        }
        const group = await createTriggerGroup(
          {
            name: input.name,
            memberKeys: input.memberKeys,
            messageTemplate: input.messageTemplate,
            ...(input.minIntervalSeconds !== undefined
              ? { minIntervalSeconds: input.minIntervalSeconds }
              : {}),
            ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
          },
          scope,
        )

        return {
          ok: true as const,
          workflowComplete: false as const,
          group: group.group,
          ingresses: group.ingresses.map((ingress) => ({
            triggerId: ingress.id,
            provider: ingress.provider,
            integrationId: ingress.integrationId,
            partitionKey: ingress.partitionKey,
            memberKeys: ingress.memberKeys,
            attachmentBatches: chunkGroupMembers(ingress.memberKeys),
            webhookUrl: groupWebhookUrl(ingress.id, ingress.partitionKey),
            webhookSecret: ingress.webhookSecret,
            secretHeader: 'X-Webhook-Secret',
          })),
          provisioning:
            'Wire one shared sender per returned provider/integration ingress. Reuse it while applying exact member attachments in the returned batches, reading each batch back before continuing. Never create one sender or Nuphos trigger per member.',
          completion:
            'This Watch Group is not live yet. Every returned ingress must be finalized with provider=watch_group; do not report success until each partition is ready.',
        }
      }),
  })

  const trigger_group_list = tool({
    description:
      "List the user's Watch Groups with member and shared-ingress progress. Use this to resume a partially provisioned group instead of creating a duplicate.",
    inputSchema: z.object({ label }),
    execute: async () =>
      run(async () => ({ ok: true as const, groups: await listTriggerGroups(scope) })),
  })

  const trigger_finalize_wiring = tool({
    description:
      "Finalize a monitoring Watch after (and only after) you used the provider native API/CLI to create the sender resource, attached the exact monitored item additively, read both resources back, and ran a cheap non-investigating drill. Stores a secret-free ownership receipt. For a shared Watch Group ingress use provider=watch_group and include one eventMatches entry per member. Its values may contain only that member's full stable provider resource ID and, when the provider payload emits it, its terminal path segment—never statuses, names, labels, or other common payload scalars. This identity-only allow-list is the server-side filter and incident-isolation boundary. Use a typed provider receipt when a deterministic cleanup driver exists; use provider=generic for any other provider and record every resource plus the manual cleanup instructions transparently. Do not put webhook secrets, tokens, provider credentials, executable commands, or untrusted payloads in the receipt. Calling this tool is the final required step before saying a Watch is live.",
    inputSchema: z.object({
      label,
      triggerId: z.string().min(1),
      wiring: monitoringProviderWiringSchema.describe(
        'Exact provider resource IDs and reversible routing metadata read back after successful wiring.',
      ),
    }),
    execute: async (input) =>
      run(async () => {
        if (origin === 'trigger') {
          return {
            ok: false as const,
            error: 'trigger_finalize_wiring is disabled in sessions fired by a trigger',
          }
        }
        if (!teamId) {
          return {
            ok: false as const,
            error: 'A team context is required to finalize provider wiring',
          }
        }
        const groupWiring = input.wiring.provider === 'watch_group' ? input.wiring : undefined
        const trigger = groupWiring
          ? await finalizeTriggerGroupIngress({
              triggerId: input.triggerId,
              userId,
              teamId,
              receipt: groupWiring,
            })
          : await finalizeTriggerProviderWiring(input.triggerId, scope, input.wiring)
        const finalizedGroup = groupWiring
          ? (await listTriggerGroups(scope)).find((group) => group.id === groupWiring.groupId)
          : undefined
        const workflowComplete = finalizedGroup
          ? finalizedGroup.readyPartitionCount === finalizedGroup.partitionCount
          : input.wiring.provider !== 'watch_group'
        const containsGeneric = groupWiring
          ? groupWiring.wirings.some((wiring) => wiring.provider === 'generic')
          : input.wiring.provider === 'generic'

        return {
          ok: true as const,
          workflowComplete,
          ...(finalizedGroup
            ? {
                groupProgress: {
                  readyPartitionCount: finalizedGroup.readyPartitionCount,
                  partitionCount: finalizedGroup.partitionCount,
                  remainingPartitionCount:
                    finalizedGroup.partitionCount - finalizedGroup.readyPartitionCount,
                },
                completion: workflowComplete
                  ? 'Every shared ingress is finalized; the Watch Group is live.'
                  : 'This ingress is recorded, but the Watch Group is not live until every remaining partition is finalized.',
              }
            : {}),
          cleanupAutomated: !containsGeneric,
          ...(containsGeneric
            ? {
                cleanupNotice:
                  'At least one shared ingress was wired dynamically. Its recorded resources remain visible, but provider-side cleanup for that ingress follows the recorded manual instructions.',
              }
            : {}),
          trigger,
        }
      }),
  })

  return { trigger_group_create, trigger_group_list, trigger_finalize_wiring }
}
