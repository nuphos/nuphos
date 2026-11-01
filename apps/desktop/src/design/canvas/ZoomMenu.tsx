import { useViewport } from '@xyflow/react'
import { ChevronDown, Play } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Kbd } from '../../components/ui/kbd'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'

import { FLOAT } from './tools'

export type ZoomMenuProps = {
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomTo: (zoom: number) => void
  onFit: () => void
  onFitSelection: () => void
  hasSelection: boolean
  onPlay: () => void
  canPlay: boolean
}

/** Zoom and Play, at the top-right of the canvas. */
export function ZoomMenu(p: ZoomMenuProps) {
  // Read here, not in the canvas: a pan or zoom then redraws this menu alone.
  const { zoom } = useViewport()

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2">
      <div className={FLOAT}>
        <Tooltip content={p.canPlay ? t('Play the flow') : t('Add a screen to play')}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            disabled={!p.canPlay}
            onClick={p.onPlay}
          >
            <Play className="h-3.5 w-3.5" />
            {t('Play')}
          </Button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-zGray-800" />
        <Menu>
          <MenuTrigger
            className="inline-flex h-7 min-w-[4.5rem] items-center justify-between gap-1 rounded px-2 font-mono text-[12px] text-main hover:bg-zGray-800"
            title={t('Zoom')}
          >
            {Math.round(zoom * 100)}%
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
          </MenuTrigger>
          <MenuContent align="end" className="min-w-52">
            <MenuItem hint={<Kbd combo="mod+=" />} onClick={p.onZoomIn}>
              {t('Zoom in')}
            </MenuItem>
            <MenuItem hint={<Kbd combo="mod+-" />} onClick={p.onZoomOut}>
              {t('Zoom out')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem hint={<Kbd combo="shift+1" />} onClick={p.onFit}>
              {t('Zoom to fit')}
            </MenuItem>
            <MenuItem
              hint={<Kbd combo="shift+2" />}
              disabled={!p.hasSelection}
              onClick={p.onFitSelection}
            >
              {t('Zoom to selection')}
            </MenuItem>
            <MenuItem hint={<Kbd combo="mod+0" />} onClick={() => p.onZoomTo(1)}>
              {t('Zoom to {percent}%', { percent: 100 })}
            </MenuItem>
            <MenuItem onClick={() => p.onZoomTo(0.5)}>
              {t('Zoom to {percent}%', { percent: 50 })}
            </MenuItem>
            <MenuItem onClick={() => p.onZoomTo(2)}>
              {t('Zoom to {percent}%', { percent: 200 })}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  )
}
