import type { CSSProperties } from 'react'

export const btn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 28,
  borderRadius: 6,
  border: '0.5px solid rgb(var(--color-border))',
  background: 'transparent',
  cursor: 'default',
  fontSize: 13,
  color: 'rgb(var(--color-text-secondary))',
}

export const segGroup: CSSProperties = {
  display: 'inline-flex',
  border: '0.5px solid rgb(var(--color-border))',
  borderRadius: 6,
  overflow: 'hidden',
}

export const segBtn = (active: boolean): CSSProperties => ({
  border: 'none',
  padding: '5px 9px',
  fontSize: 12,
  cursor: 'default',
  background: active ? 'rgb(var(--color-zViolet-500))' : 'transparent',
  color: active ? '#fff' : 'inherit',
})

export const tab: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 10px',
  fontSize: 13,
  background: 'transparent',
  border: 'none',
  cursor: 'default',
  color: 'rgb(var(--color-text-secondary))',
}

export const lbl: CSSProperties = {
  display: 'block',
  fontSize: 11,
  opacity: 0.7,
  margin: '0 0 3px',
}

export const inp: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '5px 8px',
  marginBottom: 10,
  fontSize: 13,
  borderRadius: 6,
  border: '0.5px solid rgb(var(--color-border))',
  background: 'transparent',
  outline: 'none',
  // Inputs/selects don't inherit color in Chromium (UA default is black) — set
  // it so field text stays readable in dark mode.
  color: 'rgb(var(--color-text-base))',
}
