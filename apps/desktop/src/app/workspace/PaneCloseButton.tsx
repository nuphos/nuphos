import { X } from 'lucide-react'

import { comboText } from '../../lib/platform'

import { useWorkspacePane } from './WorkspacePaneContext'

/** Shown only while the window is split; a single pane has nothing to close into. */
export function PaneCloseButton() {
  const pane = useWorkspacePane()

  if (!pane) return null

  return (
    <button
      type="button"
      aria-label="Close pane"
      title={`Close pane (${comboText('mod+w')})`}
      onClick={pane.closePane}
      className="titlebar-no-drag ml-0.5 hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main motion-reduce:transition-none group-data-[split-multiple=true]/pane:flex"
    >
      <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}
