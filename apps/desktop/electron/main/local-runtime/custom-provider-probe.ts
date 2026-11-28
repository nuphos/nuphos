// One request to a custom provider, the one each CLI's API answers without running a model:
// what Save checks for Codex, and what Test connection reports.

type Agent = 'claude-code' | 'codex' | 'opencode'

const trimmed = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl)

/** An Azure resource's origin; the end-to-end tests stand a loopback stub in for every one. */
export const azureOrigin = (baseUrl: string) => process.env.NUPHOS_E2E_AZURE_ORIGIN ?? baseUrl

/** The request each API answers without running a model, and its headers besides the key. */
function requestFor(
  provider: Agent,
  azure: boolean,
  key: string,
): { method: string; route: string; headers: Record<string, string> } {
  if (azure)
    return {
      method: 'GET',
      route: '/openai/models?api-version=2024-10-21',
      headers: { 'api-key': key },
    }
  if (provider === 'codex')
    return {
      method: 'POST',
      route: '/responses',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    }
  if (provider === 'opencode')
    return {
      method: 'GET',
      route: '/models',
      headers: key ? { authorization: `Bearer ${key}` } : {},
    }

  return {
    method: 'GET',
    route: '/v1/models',
    headers: {
      authorization: `Bearer ${key}`,
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  }
}

/**
 * The one request each CLI's API answers without running a model: Codex's Responses API
 * refuses an empty body (400/422), the others list their models. Null when unreachable.
 */
async function probe(provider: Agent, azure: boolean, baseUrl: string, key: string) {
  const { method, route, headers } = requestFor(provider, azure, key)
  const started = Date.now()
  const response = await fetch(trimmed(azure ? azureOrigin(baseUrl) : baseUrl) + route, {
    method,
    headers,
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)

  return (
    response && {
      response,
      ms: Date.now() - started,
      request: `${method} ${route} → ${response.status} ${response.statusText}`.trim(),
    }
  )
}

/** One that does not serve Codex's API answers 404 or 405. */
const servesResponses = (status: number) => status !== 404 && status !== 405

/** What one request with this key told: reached in `ms`, and what failed, with the request. */
export type CustomProviderCheck =
  | { host: string; reached: false }
  | {
      host: string
      reached: true
      ms: number
      failure?: { reason: 'key' | 'api'; request: string }
      /** How many of the given model ids the provider lists; not for Codex or Azure. */
      models?: { answered: number; total: number }
    }

/** What one request with this key finds at a provider already checked by parseCustomProvider. */
export async function checkWithKey(
  provider: Agent,
  { baseUrl, models, type }: { baseUrl: string; models: string[]; type?: 'azure' },
  key: string,
): Promise<CustomProviderCheck> {
  const host = new URL(baseUrl).host
  const azure = type === 'azure'
  const responses = provider === 'codex' && !azure
  const answer = await probe(provider, azure, baseUrl, key)

  if (!answer) return { host, reached: false }
  const { response, ms, request } = answer

  if (response.status === 401 || response.status === 403)
    return { host, reached: true, ms, failure: { reason: 'key', request } }
  if (responses ? !servesResponses(response.status) : !response.ok)
    return { host, reached: true, ms, failure: { reason: 'api', request } }
  // An Azure resource lists models, not the deployments named here.
  if (responses || azure || models.length === 0) return { host, reached: true, ms }
  const listed = await response
    .json()
    .then((body) => new Set((body as { data?: { id?: unknown }[] }).data?.map(({ id }) => id)))
    .catch(() => new Set())

  return {
    host,
    reached: true,
    ms,
    models: { answered: models.filter((id) => listed.has(id)).length, total: models.length },
  }
}
