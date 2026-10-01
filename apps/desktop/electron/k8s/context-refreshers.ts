export type RefreshedCredential = { yaml: string; expiresAt?: string | null }

// Per-context credential refreshers. Populated by `loadKubeconfigYaml()` when
// callers (Nuphos-fetched ephemeral credentials) supply a re-fetch closure;
// `refreshContextCredentials()` runs one on a 401 — or ahead of a known expiry —
// and updates the matching context's kc in place.
export const contextRefreshers = new Map<string, () => Promise<RefreshedCredential>>()

export function parseCredentialExpiry(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)

  return Number.isNaN(ms) ? null : ms
}
