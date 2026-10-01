import { SHORTCUT_GROUPS } from '../lib/shortcutsCatalog'

import { Modal } from './Modal'
import { Kbd } from './ui/kbd'

type Props = {
  open: boolean
  onClose: () => void
}

/** The ⌘/ cheat sheet: every app shortcut, grouped, one row per action. */
export function ShortcutsHelpModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={520}>
      <div className="grid grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-tertiary">
              {group.title}
            </h3>
            <ul>
              {group.entries.map((entry) => (
                <li
                  key={entry.label}
                  className="flex min-h-7 items-center justify-between gap-3 text-[12.5px] text-secondary"
                >
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="flex flex-shrink-0 items-center gap-1">
                    {entry.combos.map((combo) => (
                      <Kbd key={combo} combo={combo} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
