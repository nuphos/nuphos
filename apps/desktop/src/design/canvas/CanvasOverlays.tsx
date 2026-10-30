import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'

import { askAgentPrompt, canvasMenuItems } from './canvasMenu'
import { AskAgentDialog, RenamePageDialog } from './dialogs'
import { PlayMode } from './PlayMode'

import type { Design, DesignFrame, DesignPage } from '../schema'

type Props = {
  teamId: string
  design: Design
  page: DesignPage
  selectedFrames: DesignFrame[]
  menu: { x: number; y: number; pane: boolean } | null
  onCloseMenu: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  playFrom: string | null
  setPlayFrom: (id: string | null) => void
  askAgentOpen: boolean
  setAskAgentOpen: (open: boolean) => void
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
  renamingPage: string | null
  setRenamingPage: (id: string | null) => void
  deletingPage: string | null
  setDeletingPage: (id: string | null) => void
  renamePage: (id: string, name: string) => void
  deletePage: (id: string) => void
}

/** Everything that floats over the canvas on demand: the menu, the player and the dialogs. */
export function CanvasOverlays(p: Props) {
  const pageName = (id: string | null) => p.design.pages.find((pg) => pg.id === id)?.name ?? ''
  const renaming = p.renamingPage

  return (
    <>
      {p.menu && (
        <ContextMenu
          x={p.menu.x}
          y={p.menu.y}
          onClose={p.onCloseMenu}
          items={canvasMenuItems({
            pane: p.menu.pane,
            selectedFrames: p.selectedFrames,
            canAskAgent: Boolean(p.onOpenAgentChat),
            onAskAgent: () => p.setAskAgentOpen(true),
            onPlay: p.setPlayFrom,
            onPaste: p.onPaste,
            onDuplicate: p.onDuplicate,
            onDelete: p.onDelete,
          })}
        />
      )}
      {p.playFrom && (
        <PlayMode page={p.page} startId={p.playFrom} onClose={() => p.setPlayFrom(null)} />
      )}
      {p.askAgentOpen && (
        <AskAgentDialog
          screens={p.selectedFrames.map((f) => f.title)}
          onClose={() => p.setAskAgentOpen(false)}
          onSend={(request) => {
            p.setAskAgentOpen(false)
            p.onOpenAgentChat?.(
              askAgentPrompt({
                teamId: p.teamId,
                design: p.design,
                page: p.page,
                frames: p.selectedFrames,
                request,
              }),
              { send: true },
            )
          }}
        />
      )}
      {renaming && (
        <RenamePageDialog
          name={pageName(renaming)}
          onClose={() => p.setRenamingPage(null)}
          onSave={(name) => {
            p.renamePage(renaming, name)
            p.setRenamingPage(null)
          }}
        />
      )}
      <ConfirmDialog
        open={p.deletingPage !== null}
        title="Delete page"
        description={`Delete "${pageName(p.deletingPage) || 'this page'}" and everything on it? This cannot be undone once saved.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (p.deletingPage) p.deletePage(p.deletingPage)
          p.setDeletingPage(null)
        }}
        onClose={() => p.setDeletingPage(null)}
      />
    </>
  )
}
