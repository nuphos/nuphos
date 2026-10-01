import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { useEffect, useRef } from 'react'

import { tripleToHex } from './colorMath'
import { resolveComputed } from './registry'

import type { TokenDef } from './types'
import type { ReactNode } from 'react'

export function IconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode
  onClick: () => void
  title: string
  active?: boolean
}) {
  return (
    <BaseButton
      title={title}
      onClick={onClick}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded outline-none transition-colors',
        active
          ? 'bg-zViolet-500/20 text-zViolet-accent'
          : 'text-tertiary hover:bg-zGray-800/60 hover:text-secondary',
      )}
    >
      {children}
    </BaseButton>
  )
}

export function SegBtn({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <BaseButton
      onClick={onClick}
      className={clsx(
        'rounded px-2 py-1 text-[11.5px] font-medium outline-none transition-colors',
        active ? 'bg-elevated text-main' : 'text-tertiary hover:text-secondary',
      )}
    >
      {children}
    </BaseButton>
  )
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="sticky top-0 z-10 bg-main py-1 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function TokenRow({
  def,
  overridden,
  highlighted,
  onSetHex,
  onReset,
  onJump,
}: {
  def: TokenDef
  overridden: boolean
  highlighted: boolean
  onSetHex: (hex: string) => void
  onReset: () => void
  onJump: (name: string) => void
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const editable = def.kind === 'triple' || def.kind === 'ref'
  const resolved = resolveComputed(def.name) // reflects live overrides + var()
  const hex = tripleToHex(resolved) ?? '#000000'
  const short = def.name.replace('--color-', '')

  return (
    <div
      ref={rowRef}
      className={clsx(
        'flex items-center gap-2 rounded px-1 py-1',
        highlighted && 'ring-1 ring-zViolet-accent/60',
      )}
    >
      {editable ? (
        <input
          type="color"
          value={hex.slice(0, 7)}
          onChange={(e) => onSetHex(e.target.value)}
          className="h-6 w-6 flex-shrink-0 rounded border border-zGray-800/60 bg-transparent p-0"
          title={def.name}
        />
      ) : (
        <span
          className="h-6 w-6 flex-shrink-0 rounded border border-zGray-800/60"
          style={{ background: `rgb(var(${def.name}))` }}
          title={def.name}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] leading-tight">{short}</div>
        {def.kind === 'ref' && def.refs[0] && (
          <button
            type="button"
            onClick={() => onJump(def.refs[0])}
            className="truncate text-[10px] text-tertiary hover:text-zViolet-accent"
            title={`Go to ${def.refs[0]}`}
          >
            → {def.refs[0].replace('--color-', '')}
          </button>
        )}
        {(def.kind === 'rgba' || def.kind === 'other') && (
          <div className="truncate text-[10px] text-tertiary">{def.authored}</div>
        )}
      </div>

      {editable ? (
        <input
          type="text"
          defaultValue={hex.slice(0, 7)}
          key={hex + String(overridden)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSetHex((e.target as HTMLInputElement).value)
          }}
          onBlur={(e) => onSetHex(e.target.value)}
          spellCheck={false}
          className="w-[68px] flex-shrink-0 rounded border border-zGray-800/60 bg-field px-1.5 py-0.5 font-mono text-[11px] text-secondary outline-none focus:border-zViolet-accent/60"
        />
      ) : (
        <span className="w-[68px] flex-shrink-0 text-right text-[10px] text-tertiary">
          {def.kind}
        </span>
      )}

      <button
        type="button"
        onClick={onReset}
        disabled={!overridden}
        title={overridden ? 'Reset to stock' : 'Not overridden'}
        className={clsx(
          'h-4 w-4 flex-shrink-0 rounded-full transition-colors',
          overridden ? 'bg-zViolet-accent hover:bg-zViolet-400' : 'bg-zGray-800/50 opacity-40',
        )}
      />
    </div>
  )
}
