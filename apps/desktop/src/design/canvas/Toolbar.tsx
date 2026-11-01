import clsx from 'clsx'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Hand,
  Loader2,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Shapes,
  Square,
  SquareDashed,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'
import { FRAME_PRESETS } from '../schema'

import { INK_COLORS } from './helpers'
import { FLOAT } from './tools'
import { ToolButton } from './toolbarParts'

import type { Tool } from './tools'
import type { DesignPage, DesignShapeKind, FramePreset } from '../schema'
import type { SaveState } from '../useDesignSync'
import type { LucideIcon } from 'lucide-react'

const TOOLS: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: t('Select'), key: 'V' },
  { tool: 'hand', icon: Hand, label: t('Hand'), key: 'H' },
  { tool: 'text', icon: Type, label: t('Text'), key: 'T' },
  { tool: 'frame', icon: SquareDashed, label: t('Frame'), key: 'F' },
  { tool: 'section', icon: Square, label: t('Section'), key: 'S' },
  { tool: 'note', icon: StickyNote, label: t('Sticky note'), key: 'N' },
  { tool: 'pen', icon: Pencil, label: t('Pen'), key: 'P' },
]

const SHAPES: { kind: DesignShapeKind; icon: LucideIcon; label: string }[] = [
  { kind: 'rect', icon: Square, label: t('Rectangle') },
  { kind: 'ellipse', icon: Circle, label: t('Ellipse') },
  { kind: 'arrow', icon: ArrowRight, label: t('Arrow') },
  { kind: 'line', icon: Minus, label: t('Line') },
]

export type ToolbarProps = {
  name: string
  onRename: (name: string) => void
  pages: DesignPage[]
  pageId: string
  onSelectPage: (id: string) => void
  onAddPage: () => void
  onRenamePage: (id: string) => void
  onDuplicatePage: (id: string) => void
  onDeletePage: (id: string) => void
  tool: Tool
  onTool: (tool: Tool) => void
  shape: DesignShapeKind
  onShape: (shape: DesignShapeKind) => void
  framePreset: FramePreset
  onFramePreset: (preset: FramePreset) => void
  inkColor: string
  onInkColor: (color: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  saveState: SaveState
}

/** The floating tool strip at the top-left of the canvas. */
export function Toolbar(p: ToolbarProps) {
  const page = p.pages.find((pg) => pg.id === p.pageId)
  const [draftName, setDraftName] = useState<string | null>(null)

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <div className={FLOAT}>
        {draftName === null ? (
          <button
            type="button"
            className="h-7 max-w-[12rem] truncate rounded px-2 text-[13px] font-medium text-main hover:bg-zGray-800"
            title={t('Rename design')}
            onClick={() => setDraftName(p.name)}
          >
            {p.name}
          </button>
        ) : (
          <input
            autoFocus
            value={draftName}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              const next = draftName.trim()

              setDraftName(null)
              if (next && next !== p.name) p.onRename(next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setDraftName(null)
              e.stopPropagation()
            }}
            aria-label={t('Design name')}
            maxLength={100}
            className="h-7 w-44 rounded border border-zViolet-500 bg-main px-2 text-[13px] text-main outline-none focus:ring-1 focus:ring-zViolet-500/60"
          />
        )}
        <span className="mx-0.5 h-5 w-px bg-zGray-800" />
        <Menu>
          <MenuTrigger
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[13px] text-main hover:bg-zGray-800"
            title={t('Pages')}
          >
            <span className="max-w-[10rem] truncate">{page?.name ?? t('Page')}</span>
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
          </MenuTrigger>
          <MenuContent className="min-w-56">
            {p.pages.map((pg) => (
              <MenuItem
                key={pg.id}
                selected={pg.id === p.pageId}
                onClick={() => p.onSelectPage(pg.id)}
              >
                {pg.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Plus className="size-3.5" />} onClick={p.onAddPage}>
              {t('New page')}
            </MenuItem>
            <MenuItem icon={<Type className="size-3.5" />} onClick={() => p.onRenamePage(p.pageId)}>
              {t('Rename page')}
            </MenuItem>
            <MenuItem
              icon={<Copy className="size-3.5" />}
              onClick={() => p.onDuplicatePage(p.pageId)}
            >
              {t('Duplicate page')}
            </MenuItem>
            <MenuItem
              icon={<Trash2 className="size-3.5" />}
              destructive
              disabled={p.pages.length <= 1}
              onClick={() => p.onDeletePage(p.pageId)}
            >
              {t('Delete page')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <div className={FLOAT} role="toolbar" aria-label={t('Tools')}>
        {TOOLS.map(({ tool, icon: Icon, label, key }) => (
          <ToolButton
            key={tool}
            active={p.tool === tool}
            label={label}
            hint={key}
            onClick={() => p.onTool(tool)}
          >
            <Icon className="h-4 w-4" />
          </ToolButton>
        ))}
        <Menu>
          <MenuTrigger
            aria-label={t('Shape')}
            aria-pressed={p.tool === 'shape'}
            title={t('Shape (R)')}
            className={clsx(
              'inline-flex h-7 items-center gap-0.5 rounded-md px-1 text-secondary hover:bg-zGray-800 hover:text-main',
              p.tool === 'shape' &&
                'bg-zViolet-500 text-white hover:bg-zViolet-400 hover:text-white',
            )}
          >
            <Shapes className="h-4 w-4" />
            <ChevronDown className="h-3 w-3" />
          </MenuTrigger>
          <MenuContent>
            {SHAPES.map(({ kind, icon: Icon, label }) => (
              <MenuItem
                key={kind}
                icon={<Icon className="size-3.5" />}
                selected={p.shape === kind}
                onClick={() => {
                  p.onShape(kind)
                  p.onTool('shape')
                }}
              >
                {label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {p.tool === 'frame' && (
          <>
            <span className="mx-0.5 h-5 w-px bg-zGray-800" />
            {(Object.keys(FRAME_PRESETS) as FramePreset[]).map((key) => (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                className={clsx(
                  'h-7 px-2 text-[12px]',
                  p.framePreset === key && 'bg-zGray-800 text-main',
                )}
                onClick={() => p.onFramePreset(key)}
              >
                {FRAME_PRESETS[key].label}
              </Button>
            ))}
          </>
        )}
        {(p.tool === 'pen' || p.tool === 'shape') && (
          <>
            <span className="mx-0.5 h-5 w-px bg-zGray-800" />
            <span
              className="flex items-center gap-1 px-1"
              role="radiogroup"
              aria-label={t('Color')}
            >
              {INK_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={p.inkColor === color}
                  aria-label={color}
                  className="flex h-5 w-5 items-center justify-center rounded-full ring-offset-1 ring-offset-[rgb(var(--color-background-base))] focus-visible:ring-2 focus-visible:ring-zViolet-accent"
                  style={{
                    background: color,
                    boxShadow: p.inkColor === color ? `0 0 0 2px ${color}` : undefined,
                  }}
                  onClick={() => p.onInkColor(color)}
                >
                  {p.inkColor === color && <Check className="h-3 w-3 text-white" />}
                </button>
              ))}
            </span>
          </>
        )}
      </div>

      <div className={FLOAT}>
        <ToolButton label={t('Undo')} hint="mod+z" onClick={p.onUndo}>
          <Undo2 className={clsx('h-4 w-4', !p.canUndo && 'opacity-40')} />
        </ToolButton>
        <ToolButton label={t('Redo')} hint="mod+shift+z" onClick={p.onRedo}>
          <Redo2 className={clsx('h-4 w-4', !p.canRedo && 'opacity-40')} />
        </ToolButton>
        <span
          className="inline-flex h-7 items-center px-1.5 text-[11px] text-tertiary"
          aria-live="polite"
        >
          {p.saveState === 'saving' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('Saving')} />
          )}
          {p.saveState === 'saved' && (
            <Check className="h-3.5 w-3.5 text-success" aria-label={t('Saved')} />
          )}
        </span>
      </div>
    </div>
  )
}
