import { NodeResizer } from '@xyflow/react'
import clsx from 'clsx'
import { AlertTriangle, Download, Play } from 'lucide-react'
import { useState } from 'react'

import { ArtifactFrame } from '../../components/agent/artifacts/ArtifactFrame'
import {
  ARTIFACT_FRAME_SANDBOX,
  ARTIFACT_THUMBNAIL_SANDBOX,
} from '../../components/agent/artifacts/artifactSandbox'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import { FRAME_PRESETS, framePresetOf } from '../schema'

import { useDesignCanvas } from './context'
import { PRIMARY } from './helpers'
import { EditableTitle, FrameHandles } from './nodeParts'
import { useScreenScale } from './useScreenScale'

import type { DesignNodeData } from './nodeParts'
import type { DesignFrame, FramePreset } from '../schema'
import type { NodeProps } from '@xyflow/react'

// --- Frame -----------------------------------------------------------------

// Below this zoom a desktop screen is under 170px wide: nothing to read, so
// the page is not loaded at all and a far-out view of many screens stays cheap.
const LIVE_ZOOM = 0.12

export function FrameNode({ data, selected }: NodeProps) {
  const { object: frame } = data as DesignNodeData<DesignFrame>
  const canvas = useDesignCanvas()
  const scale = useScreenScale()
  const live = 1 / scale >= LIVE_ZOOM
  // Kept with the html it came from, so a new version starts clean.
  const [reported, setReported] = useState<{ html: string; message: string } | null>(null)
  const error = reported?.html === frame.html ? reported.message : null
  const interactive = canvas.interactiveId === frame.id
  const preset = framePresetOf(frame)

  return (
    <div
      className="group relative h-full w-full"
      onDoubleClick={(e) => {
        e.stopPropagation()
        canvas.setInteractive(frame.id)
      }}
    >
      <NodeResizer
        isVisible={selected && !interactive}
        color={PRIMARY}
        minWidth={120}
        minHeight={120}
        onResizeEnd={(_e, p) =>
          canvas.updateObject(
            frame.id,
            (o) => ({ ...o, x: p.x, y: p.y, width: p.width, height: p.height }),
            { record: true },
          )
        }
      />
      <div
        className="absolute left-0 flex items-center gap-1 whitespace-nowrap text-[12px] text-secondary"
        style={{
          bottom: '100%',
          marginBottom: 6 * scale,
          transform: `scale(${String(scale)})`,
          transformOrigin: 'bottom left',
          height: 24,
        }}
      >
        <EditableTitle
          value={frame.title}
          placeholder="Screen"
          className="max-w-[16rem] font-medium text-main"
          onChange={(title) =>
            canvas.updateObject(frame.id, (o) => ({ ...o, title }), { record: true })
          }
        />
        <Menu>
          <MenuTrigger
            className="nodrag nopan rounded px-1.5 py-0.5 text-[11px] text-tertiary hover:bg-zGray-800 hover:text-main"
            title={t('Frame size')}
          >
            {preset
              ? FRAME_PRESETS[preset].label
              : `${String(frame.width)}×${String(frame.height)}`}
          </MenuTrigger>
          <MenuContent>
            {(Object.keys(FRAME_PRESETS) as FramePreset[]).map((key) => (
              <MenuItem
                key={key}
                selected={preset === key}
                hint={`${String(FRAME_PRESETS[key].width)}×${String(FRAME_PRESETS[key].height)}`}
                onClick={() => canvas.setFramePreset(frame.id, key)}
              >
                {FRAME_PRESETS[key].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {error && (
          <Tooltip content={error}>
            <span className="inline-flex items-center text-warning" aria-label={t('Page error')}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        )}
        <span
          className={clsx(
            'nodrag nopan ml-1 flex items-center gap-0.5 transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Tooltip content="Download this screen as HTML">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('Download')}
              onClick={(e) => {
                e.stopPropagation()
                canvas.download(frame.id)
              }}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('Play from this screen')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('Play')}
              onClick={(e) => {
                e.stopPropagation()
                canvas.play(frame.id)
              }}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </span>
      </div>
      <div
        className={clsx(
          'h-full w-full overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]',
          interactive && 'nodrag nopan nowheel',
          interactive || selected ? 'ring-2 ring-zViolet-500' : 'ring-1 ring-black/10',
        )}
        style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      >
        {live && (
          // A page only gets popups, forms and dialogs once the user steps into
          // it; until then it can draw and run, nothing more. The key reloads it
          // on the way in, which is what a sandbox change needs anyway.
          <ArtifactFrame
            key={interactive ? 'live' : 'view'}
            html={frame.html}
            title={frame.title}
            className="h-full w-full"
            sandbox={interactive ? ARTIFACT_FRAME_SANDBOX : ARTIFACT_THUMBNAIL_SANDBOX}
            onError={(message) => setReported({ html: frame.html, message })}
            onEscape={() => canvas.setInteractive(null)}
          />
        )}
      </div>
      <FrameHandles visible={selected && !interactive} />
    </div>
  )
}
