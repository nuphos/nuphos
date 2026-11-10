type Choice = { value: string; name: string }

const RANK = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** The levels the effort slider shows, lowest first. Runtimes list them in
 *  either direction (Grok Build lists xhigh → low), so a list whose known
 *  levels run high to low is flipped. A runtime's "default" level is where
 *  reset goes, not a stop of its own. */
export function effortStops<T extends Choice>(choices: T[]): T[] {
  const stops = choices.filter((choice) => choice.value !== 'default')
  const ranks = stops.map((stop) => RANK.indexOf(stop.value)).filter((rank) => rank >= 0)

  return ranks.length > 1 && ranks[0] > ranks[ranks.length - 1] ? stops.reverse() : stops
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

/** Where ↺ returns: the runtime's own "default" level. A runtime that names
 *  none gets no reset, rather than one that guesses a baseline. */
export function effortResetValue(choices: Choice[]): string | undefined {
  return choices.some((choice) => choice.value === 'default') ? 'default' : undefined
}

/** How far along the track a stop sits, from 0 (first) to 1 (last). */
export function stopFraction(count: number, index: number): number {
  return count > 1 && index > 0 ? Math.min(index, count - 1) / (count - 1) : 0
}
