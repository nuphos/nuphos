import { Reorder } from 'framer-motion'
import { useId, useRef, useState } from 'react'

import { readLocalStorage, writeLocalStorage } from '../../../app/localStorage'
import { t } from '../../../i18n'

import { SortableSummarySection } from './SortableSummarySection'
import { useArranging } from './useSummaryArranging'

import type { ReactNode } from 'react'

type Section = { id: string; title: string; content: ReactNode }
type Preferences = { order: string[]; collapsed: string[] }

function readPreferences(key: string): Preferences {
  try {
    const saved: unknown = JSON.parse(readLocalStorage(key) ?? '{}')

    if (!saved || typeof saved !== 'object') return { order: [], collapsed: [] }
    const strings = (value: unknown) =>
      Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
        : []

    return {
      order: strings('order' in saved ? saved.order : []),
      collapsed: strings('collapsed' in saved ? saved.collapsed : []),
    }
  } catch {
    return { order: [], collapsed: [] }
  }
}

export function SummaryLayout({
  teamId,
  sections,
}: {
  teamId: string
  sections: (Section | false | '' | null | undefined)[]
}) {
  const regionId = useId()
  const arranging = useArranging()
  const key = `chat-summary-layout:${teamId}`
  const [preferences, setPreferences] = useState(() => readPreferences(key))
  const [preview, setPreview] = useState<string[] | null>(null)
  const dropping = useRef<string[] | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const available = sections.filter((section): section is Section => Boolean(section))
  const ids = [...new Set([...preferences.order, ...available.map(({ id }) => id)])]
  const visible = ids.filter((id) => available.some((section) => section.id === id))
  const shown =
    preview?.length === visible.length && preview.every((id) => visible.includes(id))
      ? preview
      : visible

  function save(next: Preferences) {
    setPreferences(next)
    try {
      writeLocalStorage(key, JSON.stringify(next))
    } catch {
      // The current panel still works when device storage is unavailable.
    }
  }

  function reorder(next: string[]) {
    // Leave unavailable sections in their saved slots, ready to reappear.
    let index = 0
    const order = ids.map((id) => (visible.includes(id) ? next[index++] : id))

    save({ ...preferences, order })
    setAnnouncement(
      next.map((id) => available.find((section) => section.id === id)?.title).join(', '),
    )
  }

  function toggle(id: string) {
    const collapsed = preferences.collapsed.includes(id)
      ? preferences.collapsed.filter((entry) => entry !== id)
      : [...preferences.collapsed, id]

    save({ ...preferences, collapsed })
  }

  return (
    <>
      <p id={`${regionId}-help`} className="sr-only">
        {t('Drag the handle or use the arrow keys to reorder sections.')}
      </p>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      <Reorder.Group
        as="div"
        axis="y"
        values={shown}
        className="flex min-w-0 flex-col gap-3"
        onReorder={(next) => {
          dropping.current = next
          setPreview(next)
        }}
      >
        {shown.map((id, index) => {
          const section = available.find((entry) => entry.id === id)

          if (!section) return null

          return (
            <SortableSummarySection
              key={id}
              {...section}
              regionId={regionId}
              moving={arranging.moving}
              layoutKey={`${shown.join()}|${String(arranging.moving)}`}
              onPickUp={arranging.start}
              collapsed={preferences.collapsed.includes(id)}
              onToggle={() => toggle(id)}
              onMove={(direction) => {
                const to = index + direction

                if (to < 0 || to >= shown.length) return
                const next = [...shown]

                arranging.start()
                arranging.settle()
                next.splice(to, 0, ...next.splice(index, 1))
                reorder(next)
              }}
              onDrop={() => {
                const next = dropping.current

                arranging.settle()
                dropping.current = null
                setPreview(null)
                if (
                  next?.length === visible.length &&
                  next.every((entry) => visible.includes(entry))
                )
                  reorder(next)
              }}
            />
          )
        })}
      </Reorder.Group>
    </>
  )
}
