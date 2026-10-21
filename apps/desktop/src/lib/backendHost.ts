/** The host of the backend an account belongs to. */
export function backendHost(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null
  try {
    return new URL(apiUrl).host
  } catch {
    return apiUrl
  }
}
