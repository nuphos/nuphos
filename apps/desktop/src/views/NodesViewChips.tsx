function nodeConditionChipClass(condition: string): string {
  if (condition === 'Ready=True') {
    return 'border-success/30 bg-success/10 text-success'
  }
  if (
    condition.startsWith('Ready=') ||
    condition.endsWith('=True') ||
    condition.endsWith('=Unknown')
  ) {
    return 'border-warning/30 bg-warning/10 text-warning'
  }

  return 'border-zGray-700 bg-zGray-850 text-tertiary'
}

export function CompactChipList({ items, kind }: { items: string[]; kind: 'taint' | 'condition' }) {
  if (items.length === 0) return <span className="text-tertiary">-</span>
  const visible = items.slice(0, 2)
  const hidden = items.length - visible.length
  const title = items.join(', ')

  return (
    <span className="flex min-w-0 items-center gap-1" title={title}>
      {visible.map((item) => (
        <span
          key={item}
          className={`min-w-0 max-w-[110px] truncate rounded border px-1.5 py-0.5 font-mono text-[11px] ${
            kind === 'condition'
              ? nodeConditionChipClass(item)
              : 'border-warning/25 bg-warning/10 text-warning'
          }`}
        >
          {item}
        </span>
      ))}
      {hidden > 0 && (
        <span className="shrink-0 rounded bg-zGray-850 px-1.5 py-0.5 text-[11px] text-tertiary">
          +{hidden}
        </span>
      )}
    </span>
  )
}
