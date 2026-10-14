const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** Some runtimes name a model by family ("Opus") and put the version only in
 *  its description ("Opus 5.5 · …"); show the versioned name when present. */
export function modelChoiceLabel(choice: { name: string; description?: string }): string {
  const name = choice.name.trim()

  if (!/^[A-Za-z]+$/.test(name)) return choice.name
  const versioned = choice.description?.match(new RegExp(`^${name}\\s+\\d[\\w.]*`, 'i'))

  return versioned ? `${name} ${versioned[0].slice(name.length).trim()}` : choice.name
}

/** Readable effort names; values this app does not know keep the runtime's name. */
export function effortLabel(choice: { value: string; name: string }): string {
  return EFFORT_LABELS[choice.value] ?? choice.name
}
