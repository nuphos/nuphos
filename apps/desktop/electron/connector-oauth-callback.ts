type Complete = (teamId: string, state: string, code: string) => Promise<Record<string, string>>

/**
 * The params a connector deep link stands for. A backend that staged the grant
 * (deferred=1) sends a one-time code instead of the binding; completing it as
 * the signed-in requester returns the params older deep links carried.
 */
export async function connectorCallbackParams(
  url: URL,
  teamId: string,
  complete: Complete,
): Promise<URLSearchParams> {
  const params = url.searchParams

  if (params.get('deferred') !== '1' || params.get('error')) return params
  const state = params.get('state') ?? ''
  const code = params.get('code')

  if (!code) {
    return new URLSearchParams({
      error: 'missing_code',
      error_description: 'Callback is missing its code',
    })
  }
  try {
    return new URLSearchParams({ state, ...(await complete(teamId, state, code)) })
  } catch (e) {
    return new URLSearchParams({
      error: 'complete_failed',
      error_description: e instanceof Error ? e.message : String(e),
    })
  }
}
