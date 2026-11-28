// The custom provider form's values as typed, checked by the main process's rules as they are
// typed, and turned into what Save and Test connection send.

import { t } from '../../i18n'

import type { CustomProviderInput, CustomProviderSaved } from '../../api'

/** `none`: sign in on the next step instead, offered only while an OpenCode is being added. */
export type ProviderKind = 'none' | 'openai' | 'azure'

/** The form as typed. `apiKey` null: one is saved and not shown; Replace opens an empty field. */
export type ProviderDraft = {
  kind: ProviderKind
  baseUrl: string
  resource: string
  apiKey: string | null
  models: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The main process's rule (parseCustomProvider), checked as it is typed. */
export function urlProblem(value: string): string | undefined {
  const typed = value.trim()

  // Still typing the scheme.
  if (!typed || 'https://'.startsWith(typed) || 'http://'.startsWith(typed)) return
  try {
    const url = new URL(typed)

    if (
      (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) &&
      !url.username &&
      !url.password
    )
      return
  } catch {
    // Not a URL yet: the same answer as the wrong scheme.
  }

  return t('The base URL must use https://, or http:// to this computer.')
}

const RESOURCE = /^[a-z0-9][a-z0-9-]{1,62}$/i

/** The main process's rule for an Azure resource, which it reaches at this host. */
export function resourceProblem(value: string): string | undefined {
  const typed = value.trim()

  if (typed && !RESOURCE.test(typed))
    return t('Enter only the resource name, such as acme-openai, not the full URL.')
}

export function providerDraft(saved: CustomProviderSaved | undefined, kind?: ProviderKind) {
  const azure = saved?.type === 'azure'

  return {
    kind: kind ?? (azure ? 'azure' : 'openai'),
    baseUrl: saved && !azure ? saved.baseUrl : '',
    resource: saved && azure ? new URL(saved.baseUrl).hostname.split('.')[0] : '',
    apiKey: saved ? null : '',
    models: saved?.models.join('\n') ?? '',
  } satisfies ProviderDraft
}

/** What Save and Test connection send. */
export function draftValue(draft: ProviderDraft): CustomProviderInput {
  const azure = draft.kind === 'azure'

  return {
    baseUrl: azure ? `https://${draft.resource.trim()}.openai.azure.com` : draft.baseUrl.trim(),
    models: draft.models
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean),
    ...(azure ? { type: 'azure' as const } : {}),
    ...(draft.apiKey?.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  }
}

/** Nothing to send yet: the address is empty or breaks the rule shown under it. */
export const draftIncomplete = (draft: ProviderDraft) =>
  draft.kind === 'azure'
    ? !draft.resource.trim() || resourceProblem(draft.resource) !== undefined
    : !draft.baseUrl.trim() || urlProblem(draft.baseUrl) !== undefined
