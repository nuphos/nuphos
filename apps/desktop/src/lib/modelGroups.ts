type Choice = { value: string; name: string }

/** Claude Code's model ids are family aliases ("opus") or "claude-…" ids. */
export function isClaudeCatalog(choices: Choice[]): boolean {
  return choices.some((choice) => /^(?:claude-|opus|sonnet|haiku|fable)/i.test(choice.value))
}

function familyVersion(label: string) {
  const match = /^([a-z]+)\s+(\d+(?:\.\d+)*)$/i.exec(label.trim())

  return match ? { family: match[1].toLowerCase(), version: match[2].split('.').map(Number) } : null
}

function newer(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)

  return false
}

/**
 * Claude's menu: the newest model of each family first, in the order the
 * families first appear, and everything else under "More models" in the
 * runtime's order. Labels must already carry the version ("Opus 5.5").
 */
export function claudeModelGroups<T extends Choice>(choices: T[], label: (choice: T) => string) {
  const best = new Map<string, { choice: T; version: number[] }>()

  for (const choice of choices) {
    const parsed = familyVersion(label(choice))

    if (!parsed) continue
    const held = best.get(parsed.family)

    if (!held || newer(parsed.version, held.version))
      best.set(parsed.family, { choice, version: parsed.version })
  }
  const latest = [...best.values()].map(({ choice }) => choice)

  return { latest, older: choices.filter((choice) => !latest.includes(choice)) }
}
