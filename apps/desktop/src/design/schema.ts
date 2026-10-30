// Data model for a Design: a team document of pages, each one canvas of
// objects (screens, sections, notes, ink, shapes) and the flow links between
// screens. Positions are absolute top-left canvas units; nothing nests — a
// section "contains" what sits inside its rectangle. Mirrors the backend model.

import { t } from '../i18n/index.ts'

export type DesignFrame = {
  id: string
  type: 'frame'
  title: string
  x: number
  y: number
  width: number
  height: number
  /** A complete HTML document, shown live in the artifact sandbox. */
  html: string
  sourceArtifact?: { sessionId: string; artifactId: string; version: number } | null
}

export type DesignSection = {
  id: string
  type: 'section'
  title: string
  x: number
  y: number
  width: number
  height: number
  color?: string | null
}

export type DesignText = {
  id: string
  type: 'text'
  text: string
  x: number
  y: number
  width: number
  fontSize?: number | null
  color?: string | null
}

export type DesignNote = {
  id: string
  type: 'note'
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string | null
}

export type DesignInk = {
  id: string
  type: 'ink'
  x: number
  y: number
  width: number
  height: number
  /** Relative to the stroke's top-left. */
  points: [number, number][]
  color?: string | null
  strokeWidth?: number | null
}

export type DesignShapeKind = 'rect' | 'ellipse' | 'arrow' | 'line'

export type DesignShape = {
  id: string
  type: 'shape'
  shape: DesignShapeKind
  x: number
  y: number
  /** A line or arrow runs from (x, y) to (x + width, y + height), so either may be negative. */
  width: number
  height: number
  color?: string | null
  text?: string | null
}

export type DesignObject =
  DesignFrame | DesignSection | DesignText | DesignNote | DesignInk | DesignShape

export type DesignObjectType = DesignObject['type']

export type DesignLink = {
  id: string
  source: string
  target: string
  label?: string | null
}

export type DesignPage = {
  id: string
  name: string
  objects: DesignObject[]
  links: DesignLink[]
}

export type Design = {
  id: string
  teamId: string
  name: string
  pages: DesignPage[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type DesignSummary = {
  id: string
  name: string
  pageCount: number
  frameCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type DesignOp =
  | { op: 'rename'; name: string }
  | { op: 'addPage'; page: { id: string; name: string }; after?: string | null }
  | { op: 'renamePage'; pageId: string; name: string }
  | { op: 'deletePage'; pageId: string }
  | { op: 'reorderPages'; pageIds: string[] }
  | { op: 'upsertObjects'; pageId: string; objects: DesignObject[] }
  | { op: 'deleteObjects'; pageId: string; objectIds: string[] }
  | { op: 'upsertLinks'; pageId: string; links: DesignLink[] }
  | { op: 'deleteLinks'; pageId: string; linkIds: string[] }

export type DesignDetailRef = { designId: string; designName: string }

/** Device presets a frame can take; width × height in canvas units. */
export const FRAME_PRESETS = {
  desktop: { label: t('Desktop|device'), width: 1440, height: 900 },
  tablet: { label: t('Tablet'), width: 834, height: 1194 },
  phone: { label: t('Phone'), width: 390, height: 844 },
} as const

export type FramePreset = keyof typeof FRAME_PRESETS

export function framePresetOf(frame: Pick<DesignFrame, 'width' | 'height'>): FramePreset | null {
  for (const [key, preset] of Object.entries(FRAME_PRESETS)) {
    if (preset.width === frame.width && preset.height === frame.height) return key as FramePreset
  }

  return null
}

/** The size most screens on the page already have, so a phone flow gets a phone screen. */
export function usualFrameSize(page: DesignPage | undefined): FramePreset {
  const counts = new Map<FramePreset, number>()

  for (const o of page?.objects ?? []) {
    const preset = o.type === 'frame' ? framePresetOf(o) : null

    if (preset) counts.set(preset, (counts.get(preset) ?? 0) + 1)
  }

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'desktop'
}

/** Objects with a box (everything but text, whose height follows its content). */
export function objectBox(o: DesignObject): {
  x: number
  y: number
  width: number
  height: number
} {
  if (o.type === 'text') return { x: o.x, y: o.y, width: o.width, height: (o.fontSize ?? 18) * 1.6 }
  if (o.type === 'shape') {
    return {
      x: Math.min(o.x, o.x + o.width),
      y: Math.min(o.y, o.y + o.height),
      width: Math.abs(o.width),
      height: Math.abs(o.height),
    }
  }

  return { x: o.x, y: o.y, width: o.width, height: o.height }
}

/** True when `inner` lies completely inside `outer`. */
export function insideSection(inner: DesignObject, outer: DesignSection): boolean {
  if (inner.id === outer.id) return false
  const b = objectBox(inner)

  return (
    b.x >= outer.x &&
    b.y >= outer.y &&
    b.x + b.width <= outer.x + outer.width &&
    b.y + b.height <= outer.y + outer.height
  )
}
