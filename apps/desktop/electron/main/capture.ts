import { captureMain, currentAnalyticsTeam } from '../analytics'

// Wraps a privileged operation so PostHog records its outcome from the main
// process (which, unlike the renderer, knows whether the action succeeded).
// Emits `${event}` with ok:true on success, ok:false + error on failure, then
// rethrows so the renderer still sees the original result/error.
export async function withCapture<T>(
  event: string,
  op: () => Promise<T>,
  props?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now()
  // Snapshot the team the operation *starts* under. The await below can last
  // seconds against a slow cluster, and a team switch landing in that window
  // would otherwise stamp the result with whichever team the user happens to be
  // looking at when it returns. captureMain treats an explicit team_id as
  // authoritative, so this wins over the ambient one.
  const teamId = currentAnalyticsTeam()
  const scope = teamId ? { team_id: teamId } : {}

  try {
    const result = await op()

    captureMain(event, { ...scope, ...props, ok: true, duration_ms: Date.now() - startedAt })

    return result
  } catch (err) {
    captureMain(event, {
      ...scope,
      ...props,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
