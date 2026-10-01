import {
  faPlus,
  faRotateLeft,
  faRotateRight,
  faCheck,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { PRIMARY } from './helpers'
import { btn, segBtn, segGroup, tab } from './styles'

import type { Diagram, DiagramView } from '../schema'

type ToolbarProps = {
  diagram: Diagram
  editing: boolean
  threeD: boolean
  mode: 'browse' | 'edit'
  saveState: 'idle' | 'saving' | 'saved'
  canUndo: boolean
  canRedo: boolean
  onNameChange: (name: string) => void
  onUndo: () => void
  onRedo: () => void
  onAddNode: () => void
  onSetMode: (m: 'browse' | 'edit') => void
  onSetThreeD: (threeD: boolean) => void
}

export function Toolbar({
  diagram,
  editing,
  threeD,
  mode,
  saveState,
  canUndo,
  canRedo,
  onNameChange,
  onUndo,
  onRedo,
  onAddNode,
  onSetMode,
  onSetThreeD,
}: ToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderBottom: '0.5px solid rgb(var(--color-border))',
      }}
      className="text-tertiary"
    >
      <input
        value={diagram.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="rounded focus:ring-1 focus:ring-zViolet-500/60"
        style={{
          fontSize: 14,
          fontWeight: 500,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          minWidth: 120,
          color: 'rgb(var(--color-text-base))',
        }}
      />
      <div style={{ flex: 1 }} />
      {editing && (
        <>
          <button onClick={onUndo} disabled={!canUndo} title="Undo" style={btn}>
            <FontAwesomeIcon icon={faRotateLeft} className="w-4 h-4" />
          </button>
          <button onClick={onRedo} disabled={!canRedo} title="Redo" style={btn}>
            <FontAwesomeIcon icon={faRotateRight} className="w-4 h-4" />
          </button>
          <button
            onClick={onAddNode}
            style={{ ...btn, width: 'auto', padding: '5px 10px', gap: 6 }}
          >
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" /> Node
          </button>
        </>
      )}
      {/* Browse / Edit — editing only exists in 2D. */}
      {!threeD && (
        <div style={segGroup}>
          {(['browse', 'edit'] as const).map((m) => (
            <button key={m} onClick={() => onSetMode(m)} style={segBtn(mode === m)}>
              {m === 'browse' ? 'Browse' : 'Edit'}
            </button>
          ))}
        </div>
      )}
      <div style={segGroup}>
        {(['2D', '3D'] as const).map((m) => (
          <button
            key={m}
            onClick={() => onSetThreeD(m === '3D')}
            style={segBtn((m === '3D') === threeD)}
          >
            {m}
          </button>
        ))}
      </div>
      <span
        style={{
          fontSize: 12,
          minWidth: 56,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {saveState === 'saving' && (
          <FontAwesomeIcon icon={faSpinner} spin className="w-3.5 h-3.5" />
        )}
        {saveState === 'saved' && <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />}
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
      </span>
    </div>
  )
}

type ViewTabsProps = {
  views: Diagram['views']
  activeViewId: string | undefined
  editing: boolean
  onSelectView: (id: string) => void
  onAddView: () => void
}

export function ViewTabs({ views, activeViewId, editing, onSelectView, onAddView }: ViewTabsProps) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}
      className="text-tertiary"
    >
      {views.map((v: DiagramView) => (
        <button
          key={v.id}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onSelectView(v.id)
          }}
          onClick={(event) => {
            // Keyboard only — pointer presses already fired at pointerdown.
            if (event.detail !== 0) return
            onSelectView(v.id)
          }}
          style={{
            ...tab,
            fontWeight: v.id === activeViewId ? 500 : 400,
            borderBottom: v.id === activeViewId ? `2px solid ${PRIMARY}` : '2px solid transparent',
          }}
        >
          {v.name}
        </button>
      ))}
      {editing && (
        <button onClick={onAddView} title="New view" style={{ ...tab, opacity: 0.7 }}>
          <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
