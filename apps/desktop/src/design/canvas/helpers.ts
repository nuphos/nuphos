import { objectBox } from '../schema'

import type { DesignFrame, DesignObject, DesignPage } from '../schema'

export const PRIMARY = 'rgb(var(--color-zViolet-500))'

export const INK_COLORS = [
  '#6300FF',
  '#1D9E75',
  '#D85A30',
  '#BA7517',
  '#E53E3E',
  '#2B6CB0',
  '#000000',
]
export const NOTE_COLORS = ['#FFF3A3', '#FFD6A5', '#CDE8FF', '#D9F7D0', '#F5D0FE']
export const DEFAULT_INK = INK_COLORS[0]!
export const DEFAULT_NOTE = NOTE_COLORS[0]!

export function genId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10)
}

export const boxOf = objectBox

export function boundsOf(objects: DesignObject[]) {
  if (objects.length === 0) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity

  for (const o of objects) {
    const b = boxOf(o)

    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.width)
    y2 = Math.max(y2, b.y + b.height)
  }

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** A file name for a frame's HTML: the title as a slug. */
export function frameFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]/u)
    .filter(Boolean)
    .join('-')

  return `${slug || 'screen'}.html`
}

export function downloadHtml(title: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = frameFileName(title)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function decodeText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

/** The screen a Play starts from when none is picked: top-left first. */
export function firstFrame(page: DesignPage): DesignFrame | undefined {
  return page.objects
    .filter((o): o is DesignFrame => o.type === 'frame')
    .sort((a, b) => a.y - b.y || a.x - b.x)[0]
}
