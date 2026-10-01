export function planNumberFromFilter(filter: string): string | null {
  return /^#?(\d+)$/.exec(filter.trim())?.[1] ?? null
}
