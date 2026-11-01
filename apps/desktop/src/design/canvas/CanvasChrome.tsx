import { firstFrame } from './helpers'
import { Toolbar } from './Toolbar'
import { ZoomMenu } from './ZoomMenu'

import type { useCanvasPages } from './useCanvasPages'
import type { useDesignHistory } from './useDesignHistory'
import type { Tool } from './tools'
import type { Design, DesignPage, DesignShapeKind, FramePreset } from '../schema'
import type { SaveState } from '../useDesignSync'
import type { useReactFlow } from '@xyflow/react'
import type { Dispatch, SetStateAction } from 'react'

type Props = {
  design: Design
  page: DesignPage
  setDesign: Dispatch<SetStateAction<Design>>
  onRename?: (name: string) => void
  setPageId: (id: string) => void
  pages: ReturnType<typeof useCanvasPages>
  setRenamingPage: (id: string) => void
  setDeletingPage: (id: string) => void
  tool: Tool
  onTool: (tool: Tool) => void
  shape: DesignShapeKind
  setShape: (shape: DesignShapeKind) => void
  framePreset: FramePreset
  setFramePreset: (preset: FramePreset) => void
  inkColor: string
  setInkColor: (color: string) => void
  history: ReturnType<typeof useDesignHistory>
  saveState: SaveState
  flow: ReturnType<typeof useReactFlow>
  fitAll: () => void
  fitSelection: () => void
  hasSelection: boolean
  onPlay: () => void
}

/** The floating controls: the tool strip top-left, zoom and Play top-right. */
export function CanvasChrome(p: Props) {
  return (
    <>
      <Toolbar
        name={p.design.name}
        onRename={(name) => {
          p.setDesign((d) => ({ ...d, name }))
          p.onRename?.(name)
        }}
        pages={p.design.pages}
        pageId={p.page.id}
        onSelectPage={p.setPageId}
        onAddPage={p.pages.addPage}
        onRenamePage={p.setRenamingPage}
        onDuplicatePage={p.pages.duplicatePage}
        onDeletePage={p.setDeletingPage}
        tool={p.tool}
        onTool={p.onTool}
        shape={p.shape}
        onShape={p.setShape}
        framePreset={p.framePreset}
        onFramePreset={p.setFramePreset}
        inkColor={p.inkColor}
        onInkColor={p.setInkColor}
        canUndo={p.history.canUndo}
        canRedo={p.history.canRedo}
        onUndo={p.history.undo}
        onRedo={p.history.redo}
        saveState={p.saveState}
      />
      <ZoomMenu
        onZoomIn={() => void p.flow.zoomIn({ duration: 150 })}
        onZoomOut={() => void p.flow.zoomOut({ duration: 150 })}
        onZoomTo={(z) => void p.flow.zoomTo(z, { duration: 150 })}
        onFit={p.fitAll}
        onFitSelection={p.fitSelection}
        hasSelection={p.hasSelection}
        canPlay={Boolean(firstFrame(p.page))}
        onPlay={p.onPlay}
      />
    </>
  )
}
