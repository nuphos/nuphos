import { Crosshair, Download, GripHorizontal, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { toast } from '../../components/ui/toast'

import { Group, IconBtn, SegBtn, TokenRow } from './PalettePanelParts'
import { TokenGraph } from './TokenGraph'
import { useInspect } from './useInspect'
import { usePageTokens } from './usePageTokens'
import { usePaletteState } from './usePaletteState'

import type { InspectResult } from './useInspect'
import type { MouseEvent as ReactMouseEvent } from 'react'

type Tab = 'tokens' | 'graph'
type SubView = 'page' | 'all'

const PANEL_W = 340

export function PalettePanel({ onClose }: { onClose: () => void }) {
  const state = usePaletteState()
  const { registry, overrides, rev } = state
  const { scan, rescan } = usePageTokens(registry)

  const [tab, setTab] = useState<Tab>('tokens')
  const [sub, setSub] = useState<SubView>('page')
  const [includeIsolated, setIncludeIsolated] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [pos, setPos] = useState({ x: 12, y: 80 })

  const jumpTo = (name: string) => {
    setTab('tokens')
    setSub('all')
    setHighlight(name)
  }

  // Inspect selection is event-driven (fired from the capture-phase click),
  // so it lands in a handler rather than an effect.
  const inspect = useInspect(registry, (result) => {
    setInspectResult(result)
    if (result.tokens.length) jumpTo(result.tokens[0])
  })

  // Initial page scan + rescan after HMR/theme rebuilds the registry.
  useEffect(() => {
    rescan()
  }, [rescan])

  // Drag by the titlebar.
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const onDragStart = (e: ReactMouseEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    const move = (ev: globalThis.MouseEvent) => {
      if (!dragRef.current) return
      const x = Math.max(0, Math.min(window.innerWidth - PANEL_W, ev.clientX - dragRef.current.dx))
      const y = Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragRef.current.dy))

      setPos({ x, y })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const doExport = () => {
    const json = JSON.stringify(state.exportJson(), null, 2)

    console.log(`[devPalette] export\n${json}`)
    void navigator.clipboard?.writeText(json).then(
      () => toast.success('Palette exported', 'Copied JSON to clipboard'),
      () => toast.error('Clipboard blocked', 'Palette JSON logged to console instead'),
    )
  }

  const doReset = () => {
    state.resetAll()
    rescan()
  }

  // Token rows for the active sub-view.
  const pageSet = new Set(scan?.tokens ?? [])
  const allNames = registry.order.filter((n) => registry.tokens.get(n))
  const visibleNames = sub === 'page' ? allNames.filter((n) => pageSet.has(n)) : allNames
  const rawNames = visibleNames.filter((n) => registry.tokens.get(n)!.group === 'raw')
  const semanticNames = visibleNames.filter((n) => registry.tokens.get(n)!.group === 'semantic')

  const body = (
    <div
      data-dev-palette=""
      className="fixed z-[1001] flex flex-col rounded-lg border border-zGray-800/70 bg-main text-main shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
      style={{ left: pos.x, top: pos.y, width: PANEL_W, maxHeight: '80vh' }}
    >
      {/* Titlebar */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-2 px-2.5 py-2 border-b border-zGray-800/60 cursor-move select-none"
      >
        <GripHorizontal className="h-3.5 w-3.5 text-tertiary" strokeWidth={2} />
        <span className="text-[12.5px] font-semibold">Palette</span>
        <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-tertiary">
          {state.theme}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn active={inspect.active} title="Inspect an element" onClick={inspect.toggle}>
            <Crosshair className="h-3.5 w-3.5" strokeWidth={2} />
          </IconBtn>
          <IconBtn title="Export JSON" onClick={doExport}>
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
          </IconBtn>
          <IconBtn title="Reset this theme's overrides" onClick={doReset}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          </IconBtn>
          <IconBtn title="Close" onClick={onClose}>
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </IconBtn>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-2.5 pt-2">
        <SegBtn active={tab === 'tokens'} onClick={() => setTab('tokens')}>
          Tokens
        </SegBtn>
        <SegBtn active={tab === 'graph'} onClick={() => setTab('graph')}>
          Graph
        </SegBtn>
      </div>

      {tab === 'tokens' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 px-2.5 py-2">
            <SegBtn active={sub === 'page'} onClick={() => setSub('page')}>
              On this page
            </SegBtn>
            <SegBtn active={sub === 'all'} onClick={() => setSub('all')}>
              All tokens
            </SegBtn>
            {sub === 'page' && (
              <button
                type="button"
                onClick={rescan}
                className="ml-auto rounded px-1.5 py-1 text-[11px] text-tertiary hover:bg-zGray-800/60 hover:text-secondary"
              >
                Rescan
              </button>
            )}
          </div>

          {inspectResult && (
            <div className="mx-2.5 mb-1.5 rounded-md border border-zGray-800/60 bg-elevated px-2 py-1.5 text-[11px]">
              <span className="text-tertiary">Inspected </span>
              <span className="font-mono text-secondary">{inspectResult.label}</span>
              {inspectResult.tokens.length === 0 && (
                <span className="text-tertiary"> — no matched tokens</span>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2.5 pb-2.5">
            {sub === 'page' && scan?.tokens.length === 0 && (
              <div className="py-6 text-center text-[12px] text-tertiary">
                No matched tokens on this page.
              </div>
            )}
            {semanticNames.length > 0 && (
              <Group label="Semantic / theme">
                {semanticNames.map((n) => (
                  <TokenRow
                    key={`${n}${String(rev)}`}
                    def={registry.tokens.get(n)!}
                    overridden={n in overrides}
                    highlighted={highlight === n}
                    onSetHex={(hex) => state.setTokenColor(n, hex)}
                    onReset={() => state.resetToken(n)}
                    onJump={jumpTo}
                  />
                ))}
              </Group>
            )}
            {rawNames.length > 0 && (
              <Group label="Palette scales">
                {rawNames.map((n) => (
                  <TokenRow
                    key={`${n}${String(rev)}`}
                    def={registry.tokens.get(n)!}
                    overridden={n in overrides}
                    highlighted={highlight === n}
                    onSetHex={(hex) => state.setTokenColor(n, hex)}
                    onReset={() => state.resetToken(n)}
                    onJump={jumpTo}
                  />
                ))}
              </Group>
            )}
            {sub === 'page' && scan && scan.skippedAlpha > 0 && (
              <div className="pt-2 text-[10.5px] text-tertiary">
                {scan.skippedAlpha} opacity-modified color(s) not matched (edit the base token to
                affect them).
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-tertiary">
            <input
              type="checkbox"
              checked={includeIsolated}
              onChange={(e) => setIncludeIsolated(e.target.checked)}
            />
            Show isolated literals
          </label>
          <div className="min-h-0 flex-1" style={{ height: 380 }}>
            <TokenGraph registry={registry} includeIsolated={includeIsolated} onSelect={jumpTo} />
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(body, document.body)
}
