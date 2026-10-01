import type { AgentCredentialAccess } from './db'

type CredentialArrayKey = NonNullable<
  {
    [K in keyof AgentCredentialAccess]: AgentCredentialAccess[K] extends string[] | undefined
      ? K
      : never
  }[keyof AgentCredentialAccess]
>

const CREDENTIAL_ARRAY_KEYS = [
  'awsRoleIds',
  'gcpServiceAccountIds',
  'linodeAccountIds',
  'hetznerAccountIds',
  'tencentAccountIds',
  'aliyunAccountIds',
  'volcengineAccountIds',
  'azureAccountIds',
  'huaweiAccountIds',
  'onpremClusterIds',
  'betterStackIntegrationIds',
  'uptimeKumaInstanceIds',
  'linearWorkspaceIds',
  'jiraSiteIds',
  'asanaAccountIds',
  'sentryAccountIds',
  'posthogIntegrationIds',
  'tailscaleClientIds',
  'zeaburIds',
  'vantaIntegrationIds',
  'secureframeIntegrationIds',
  'resendIntegrationIds',
  'githubInstallationIds',
  'gitlabBindingIds',
  'grafanaInstanceIds',
  'sonarqubeIntegrationIds',
  'notionIntegrationIds',
  'upstashAccountIds',
  'cloudflareAccountIds',
] as const satisfies readonly CredentialArrayKey[]

export type TriggerCredentialMode = 'all' | 'selected'

/** The credential binding a Trigger or Watch Group row carries. */
export type TriggerCredentialBinding = {
  credentialMode?: TriggerCredentialMode
  executionCredentialAccess?: AgentCredentialAccess
  /** Present on Trigger rows; an Agent session is where a scope could be narrowed. */
  sourceContext?: { sessionId?: string }
}

/** The same binding as decided for a row about to be written. */
export type TriggerCredentialSelection = TriggerCredentialBinding & {
  credentialMode: TriggerCredentialMode
}

/**
 * A Trigger written before the mode existed carries a scope nobody chose —
 * the Desktop form, the HTTP route and automation callers have no credential
 * picker, so their snapshot was only "everything that existed that day". The
 * exception is a Trigger created from an Agent session, whose scope may be
 * one the user narrowed there; that one keeps its ceiling.
 */
export function resolveTriggerCredentialMode(
  binding: TriggerCredentialBinding,
): TriggerCredentialMode {
  if (binding.credentialMode) return binding.credentialMode
  if (!binding.executionCredentialAccess) return 'all'

  return binding.sourceContext?.sessionId ? 'selected' : 'all'
}

/**
 * The same question for a Watch Group, which records no originating session
 * and is only ever created from an Agent session, so a legacy scope on one is
 * treated as a choice.
 */
export function resolveTriggerGroupCredentialMode(
  binding: TriggerCredentialBinding,
): TriggerCredentialMode {
  return binding.credentialMode ?? (binding.executionCredentialAccess ? 'selected' : 'all')
}

/** Does `scope` already cover every credential `current` offers? */
export function credentialScopeCoversAll(
  scope: AgentCredentialAccess,
  current: AgentCredentialAccess,
): boolean {
  return CREDENTIAL_ARRAY_KEYS.every((key) => {
    const currentValues = current[key] ?? []

    if (currentValues.length === 0) return true
    const approved = new Set(scope[key] ?? [])

    return currentValues.every((value) => approved.has(value))
  })
}

/**
 * What a run may reach. `all` follows the principal's credentials as they
 * stand right now, so a connector added after the Trigger was created comes
 * along; `selected` stays inside the scope the user picked and can only
 * shrink as the principal loses access.
 */
export function triggerRunCredentialAccess(
  binding: TriggerCredentialBinding,
  current: AgentCredentialAccess,
): AgentCredentialAccess {
  const selected = binding.executionCredentialAccess

  if (resolveTriggerCredentialMode(binding) === 'all' || !selected) return current

  return intersectTriggerCredentialAccess(selected, current)
}

/**
 * A `selected` Trigger's runtime access: the scope the user picked, minus
 * anything the principal can no longer reach.
 */
export function intersectTriggerCredentialAccess(
  approved: AgentCredentialAccess,
  current: AgentCredentialAccess,
): AgentCredentialAccess {
  const result = {
    updatedAt: approved.updatedAt,
    updatedBy: approved.updatedBy,
  } as AgentCredentialAccess

  for (const key of CREDENTIAL_ARRAY_KEYS) {
    const approvedValues = approved[key]

    if (approvedValues === undefined) continue
    const currentValues = new Set(current[key] ?? [])

    ;(result as Record<CredentialArrayKey, string[] | undefined>)[key] = approvedValues.filter(
      (value) => currentValues.has(value),
    )
  }

  return result
}
