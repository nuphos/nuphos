type Choice = { value: string; name: string }

/** The levels the effort slider shows, in the runtime's order. A runtime's
 *  "default" level is where reset goes, not a stop of its own. */
export function effortStops<T extends Choice>(choices: T[]): T[] {
  return choices.filter((choice) => choice.value !== 'default')
}

/** The level a session runs at. Claude's "default" names its level in its
 *  description (the Nuphos adapter patch reads it from Claude Code). */
export function resolvedEffort(
  choices: (Choice & { description?: string })[],
  current: string,
): string {
  if (current !== 'default') return current
  const level = choices.find((choice) => choice.value === 'default')?.description

  return level && choices.some((choice) => choice.value === level) ? level : current
}

/** Where ↺ returns: the runtime's own "default" level when it offers one,
 *  otherwise the level it started with, if that is still offered. */
export function effortResetValue(choices: Choice[], initial?: string): string | undefined {
  if (choices.some((choice) => choice.value === 'default')) return 'default'

  return initial && choices.some((choice) => choice.value === initial) ? initial : undefined
}

/** How far along the track a stop sits, from 0 (first) to 1 (last). */
export function stopFraction(count: number, index: number): number {
  return count > 1 && index > 0 ? Math.min(index, count - 1) / (count - 1) : 0
}
