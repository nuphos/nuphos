import type { Collection, ObjectId } from 'mongodb'

import { db } from '@/lib/db'

// A design is a team document of pages; each page is one canvas of objects and
// the flow links between screens. Positions are absolute top-left canvas units;
// nothing nests — a section "contains" what sits inside its rectangle.

/** A screen: a complete HTML document shown live in a sandboxed frame. */
export type DesignFrame = {
  id: string
  type: 'frame'
  title: string
  x: number
  y: number
  width: number
  height: number
  html: string
  /** Set when the frame was added from a chat artifact, so it can be traced back. */
  sourceArtifact?: { sessionId: string; artifactId: string; version: number }
}

export type DesignSection = {
  id: string
  type: 'section'
  title: string
  x: number
  y: number
  width: number
  height: number
  color?: string
}

export type DesignText = {
  id: string
  type: 'text'
  text: string
  x: number
  y: number
  width: number
  fontSize?: number
  color?: string
}

export type DesignNote = {
  id: string
  type: 'note'
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string
}

/** A freehand stroke; `points` are relative to the stroke's top-left. */
export type DesignInk = {
  id: string
  type: 'ink'
  x: number
  y: number
  width: number
  height: number
  points: [number, number][]
  color?: string
  strokeWidth?: number
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
  color?: string
  text?: string
}

export type DesignObject =
  DesignFrame | DesignSection | DesignText | DesignNote | DesignInk | DesignShape

/** A flow arrow between two frames: "from this screen you get to that one". */
export type DesignLink = {
  id: string
  source: string
  target: string
  label?: string
}

export type DesignPage = {
  id: string
  name: string
  objects: DesignObject[]
  links: DesignLink[]
}

export type Design = {
  _id: ObjectId
  teamId: ObjectId
  name: string
  pages: DesignPage[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export const designs = (): Collection<Design> => db().collection<Design>('designs')
