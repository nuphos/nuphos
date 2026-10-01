import { ALL_VALUE } from './model.ts'

// Grafana restores a saved current selection when it is still valid. With no
// saved/valid selection it chooses the first real option; enabling Include All
// only adds the All option and does not make All the automatic default.
export function reconcileVariableSelection(
  selected: string[],
  optionValues: string[],
  includeAll: boolean,
): string[] | null {
  const valid = new Set(optionValues)
  const kept = selected.filter((value) => valid.has(value) || (includeAll && value === ALL_VALUE))

  if (selected.length > 0 && kept.length === selected.length) return null
  if (kept.length > 0) return kept

  return optionValues.length > 0 ? [optionValues[0]] : []
}
