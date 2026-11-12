import type { Item, Section } from './types'

/** Active work stays above the divider; only read, inactive tasks go below. */
export function taskPageSections(items: Item[]): Section[] {
  const tasks = items.filter((item) => item.task && !item.bot)
  const ready = tasks
    .filter((item) => item.taskState === 'attention')
    .sort((a, b) => Number(b.dot === 'waiting') - Number(a.dot === 'waiting'))
  const working = tasks.filter((item) => item.taskState === 'working')
  const idle = tasks.filter(
    (item) => item.taskState !== 'attention' && item.taskState !== 'working',
  )
  const active = [...ready, ...working]

  return [
    { title: 'Tasks', items: active, compact: true },
    ...(idle.length ? [{ items: idle, compact: true, separator: active.length > 0 }] : []),
  ]
}
