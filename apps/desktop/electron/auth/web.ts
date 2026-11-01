// Where the sign-in page is, and how the backend explains a failed request.

export const NUPHOS_LOGIN_URL =
  process.env.NUPHOS_LOGIN_URL ||
  (process.env.NUPHOS_WEB_URL
    ? new URL('/login', process.env.NUPHOS_WEB_URL).toString()
    : 'https://nuphos.ai/login')

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
