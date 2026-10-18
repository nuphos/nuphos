import { call } from './client'

/** Finishes a connector grant the backend staged, with the callback's one-time code. */
export async function completeConnectorOAuth(
  teamId: string,
  state: string,
  code: string,
): Promise<Record<string, string>> {
  return call<Record<string, string>>(
    'POST',
    `/teams/${teamId}/connector-oauth/${encodeURIComponent(state)}/complete`,
    { code },
    { retry: false },
  )
}
