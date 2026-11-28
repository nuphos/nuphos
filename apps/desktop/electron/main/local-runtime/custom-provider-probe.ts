// One request to a custom provider, the one each CLI's API answers without running a model:
// what Save checks for Codex, and what Test connection reports.

type Agent = 'claude-code' | 'codex'

const trimmed = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl)

/**
 * The one request each CLI's API answers without running a model: Codex's Responses API
 * refuses an empty body (400/422), Claude Code's lists its models. Null when unreachable.
 */
async function probe(provider: Agent, baseUrl: string, key: string) {
  const [method, route] = provider === 'codex' ? ['POST', '/responses'] : ['GET', '/v1/models']
  const started = Date.now()
  const response = await fetch(trimmed(baseUrl) + route, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(provider === 'codex'
        ? { 'content-type': 'application/json' }
        : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    },
    ...(provider === 'codex' ? { body: '{}' } : {}),
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
      /** How many of the given model ids the provider lists; Claude Code only. */
      models?: { answered: number; total: number }
    }

/** What one request with this key finds at a provider already checked by parseCustomProvider. */
export async function checkWithKey(
  provider: Agent,
  { baseUrl, models }: { baseUrl: string; models: string[] },
  key: string,
): Promise<CustomProviderCheck> {
  const host = new URL(baseUrl).host
  const answer = await probe(provider, baseUrl, key)

  if (!answer) return { host, reached: false }
  const { response, ms, request } = answer

  if (response.status === 401 || response.status === 403)
    return { host, reached: true, ms, failure: { reason: 'key', request } }
  if (provider === 'codex' ? !servesResponses(response.status) : !response.ok)
    return { host, reached: true, ms, failure: { reason: 'api', request } }
  if (provider === 'codex' || models.length === 0) return { host, reached: true, ms }
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
