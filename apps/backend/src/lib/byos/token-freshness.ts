// Shared freshness rule for every OAuth connector's access-token cache.
//
// Each connector keeps its own cache (the binding types and decrypt helpers
// differ), but they all answer the same question, and they all used to answer
// it the same wrong way: an unknown expiry counted as fresh, which pinned a
// refreshable token in memory forever and never attempted a refresh. Keeping
// the rule in one place is what stops that from drifting back into five copies.
//
// A binding we can't refresh has nothing better to offer than its stored token,
// so an unknown expiry counts as fresh. For a refreshable one the opposite is
// true: an unknown expiry must fall through to a refresh, which establishes a
// real one.
export function tokenStillFresh(expiresAt: Date | null, canRefresh: boolean): boolean {
  if (expiresAt === null) return !canRefresh

  // Refresh 60s ahead so a token can't expire in flight between the handout and
  // the sandbox's first call with it.
  return expiresAt.getTime() - 60_000 > Date.now()
}
