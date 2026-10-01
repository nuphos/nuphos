const RECOVERY_WORDS = new Set(['closed', 'normal', 'ok', 'recovered', 'resolved'])

/**
 * Whether a delivery should skip the per-trigger cooldown.
 *
 * The cooldown exists so a retry storm cannot turn into one agent session per
 * delivery. Dropping a recovery notice under it is the one case where that
 * protection does real harm, so a delivery that looks like a recovery is let
 * through.
 *
 * This only ever admits deliveries. It is not a classification of what the
 * alert means, it never reaches the model, and the agent still reads the raw
 * payload and decides for itself.
 */
export function shouldBypassTriggerCooldown(
  incidentMode: boolean | undefined,
  payload: unknown,
): boolean {
  if (incidentMode !== true || !payload || typeof payload !== 'object') return false
  const root = payload as Record<string, unknown>
  const sources = [
    root,
    root.incident,
    root.data,
    (root.data as Record<string, unknown> | undefined)?.attributes,
  ]

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const field of ['status', 'state', 'alertState']) {
      const value = (source as Record<string, unknown>)[field]

      if (typeof value !== 'string') continue
      if (RECOVERY_WORDS.has(value.trim().toLowerCase().replace(/[ -]+/g, '_'))) return true
    }
  }

  return false
}
