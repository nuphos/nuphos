import { createDeflate, constants as zlib } from 'node:zlib'

import type { NativeImage } from 'electron'
import type { Deflate } from 'node:zlib'

export type Rect = { x: number; y: number; width: number; height: number }

export const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff]
export const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
]
const s32 = (value: number) => be32(value >>> 0)

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)

  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** The watched page's pixels on this Mac, BGRA in device pixels, and what changed since the phone last got it. */
export class PageScreen {
  width = 0
  height = 0
  pixels = Buffer.alloc(0)
  private dirty: Rect | null = null

  get changed(): boolean {
    return this.dirty !== null
  }

  /**
   * Copies a repainted area in: the whole image, or with only the dirty area the
   * image is that area. True when the page changed size, which redraws it all.
   */
  paint(image: Pick<NativeImage, 'getSize' | 'toBitmap'>, dirty: Rect): boolean {
    const size = image.getSize()

    if (size.width === 0 || size.height === 0) return false
    const full = size.width !== dirty.width || size.height !== dirty.height
    const area = full ? { x: 0, y: 0, ...size } : dirty
    const width = full ? size.width : Math.max(area.x + area.width, this.width)
    const height = full ? size.height : Math.max(area.y + area.height, this.height)
    const resized = width !== this.width || height !== this.height

    if (resized) {
      Object.assign(this, { width, height, pixels: Buffer.alloc(width * height * 4) })
      this.invalidate()
    }
    const bitmap = image.toBitmap()

    for (let row = 0; row < area.height; row++)
      bitmap.copy(
        this.pixels,
        ((area.y + row) * this.width + area.x) * 4,
        row * area.width * 4,
        (row + 1) * area.width * 4,
      )
    this.dirty = this.dirty ? union(this.dirty, area) : area

    return resized
  }

  /** Marks the whole page changed, for a full update request. */
  invalidate(): void {
    this.dirty = { x: 0, y: 0, width: this.width, height: this.height }
  }

  /** What changed since the last call. */
  take(): Rect | null {
    const dirty = this.dirty

    this.dirty = null

    return dirty
  }
}

/** A FramebufferUpdate: the new size first when it changed, then the ZRLE rectangle. */
export function updateMessage(
  screen: PageScreen,
  rect: Rect | null,
  zrle: Buffer | null,
  resized: boolean,
) {
  const rects: number[][] = []

  if (resized) rects.push([0, 0, 0, 0, ...be16(screen.width), ...be16(screen.height), ...s32(-223)])
  if (rect && zrle)
    rects.push([
      ...be16(rect.x),
      ...be16(rect.y),
      ...be16(rect.width),
      ...be16(rect.height),
      ...s32(16),
      ...be32(zrle.length),
    ])

  return Buffer.concat([
    Buffer.from([0, 0, ...be16(rects.length)]),
    ...rects.map((header) => Buffer.from(header)),
    ...(zrle ? [zrle] : []),
  ])
}

const TILE = 64

/** ZRLE rectangles (RFB encoding 16) of a BGRA screen, on the one zlib stream a connection keeps. */
export class ZrleEncoder {
  private deflate: Deflate | undefined

  /** ZRLE for `rect`: 64×64 tiles, a solid colour where the tile is one, else raw, on one zlib stream. */
  encode(screen: { width: number; pixels: Buffer }, rect: Rect): Promise<Buffer | null> {
    if (rect.width === 0 || rect.height === 0) return Promise.resolve(null)
    const { pixels, width } = screen
    const parts: Buffer[] = []

    for (let ty = rect.y; ty < rect.y + rect.height; ty += TILE)
      for (let tx = rect.x; tx < rect.x + rect.width; tx += TILE) {
        const w = Math.min(TILE, rect.x + rect.width - tx)
        const h = Math.min(TILE, rect.y + rect.height - ty)
        const tile = Buffer.alloc(1 + w * h * 3)
        let solid = true
        let first = -1
        let at = 1

        for (let y = ty; y < ty + h; y++)
          for (let x = tx; x < tx + w; x++) {
            const p = (y * width + x) * 4
            const color = pixels.readUIntLE(p, 3)

            if (first < 0) first = color
            else if (color !== first) solid = false
            tile[at++] = pixels[p] ?? 0
            tile[at++] = pixels[p + 1] ?? 0
            tile[at++] = pixels[p + 2] ?? 0
          }
        parts.push(
          solid ? Buffer.from([1, first & 0xff, (first >> 8) & 0xff, (first >> 16) & 0xff]) : tile,
        )
      }

    return this.compress(Buffer.concat(parts))
  }

  private compress(data: Buffer): Promise<Buffer> {
    this.deflate ??= createDeflate()
    const deflate = this.deflate
    const chunks: Buffer[] = []
    const onData = (chunk: Buffer) => chunks.push(chunk)

    deflate.on('data', onData)
    deflate.write(data)

    return new Promise((resolve) => {
      deflate.flush(zlib.Z_SYNC_FLUSH, () => {
        deflate.off('data', onData)
        resolve(Buffer.concat(chunks))
      })
    })
  }

  close(): void {
    this.deflate?.close()
  }
}
