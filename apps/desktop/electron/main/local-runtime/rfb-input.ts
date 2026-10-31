import type { WebContents } from 'electron'

/** X keysyms the phone sends for keys that type nothing, as Electron names them. */
const KEYS: Record<number, string> = {
  0xff08: 'Backspace',
  0xff09: 'Tab',
  0xff0d: 'Return',
  0xff1b: 'Escape',
  0xff50: 'Home',
  0xff51: 'Left',
  0xff52: 'Up',
  0xff53: 'Right',
  0xff54: 'Down',
  0xff55: 'PageUp',
  0xff56: 'PageDown',
  0xff57: 'End',
  0xffff: 'Delete',
}

type Modifier = 'shift' | 'control' | 'alt' | 'meta'

const MODIFIERS: Record<number, Modifier> = {
  0xffe1: 'shift',
  0xffe2: 'shift',
  0xffe3: 'control',
  0xffe4: 'control',
  0xffe9: 'alt',
  0xffea: 'alt',
  0xffeb: 'meta',
  0xffec: 'meta',
  0xffe7: 'meta',
  0xffe8: 'meta',
}
/** RFB pointer buttons: bit 0 left, 1 middle, 2 right; 3/4 wheel up/down, 5/6 left/right. */
const BUTTONS: [number, 'left' | 'middle' | 'right'][] = [
  [1, 'left'],
  [2, 'middle'],
  [4, 'right'],
]
const WHEEL_STEP = 60

/** The character a keysym types, if it types one: Latin-1, or Unicode as 0x01000000 + code point. */
function typed(keysym: number): string | undefined {
  if ((keysym >= 0x20 && keysym <= 0x7e) || (keysym >= 0xa0 && keysym <= 0xff))
    return String.fromCodePoint(keysym)
  if (keysym >= 0x01000100 && keysym <= 0x0110ffff) return String.fromCodePoint(keysym - 0x01000000)

  return undefined
}

/** Client messages of a fixed length: SetPixelFormat, update request, key, pointer. */
const FIXED_LENGTHS = new Map([
  [0, 20],
  [3, 10],
  [4, 8],
  [5, 6],
])

/**
 * How long the client message at the start of `bytes` is, or null until enough
 * of it arrived to tell. SetEncodings and ClientCutText carry a count; the rest
 * have a fixed length. An unknown message throws.
 */
export function clientMessageLength(bytes: Buffer): number | null {
  if (bytes.length === 0) return null
  const type = bytes.readUInt8(0)

  if (type === 2) return bytes.length >= 4 ? 4 + bytes.readUInt16BE(2) * 4 : null
  // As the backend's input filter reads it: a negative length is the extended form.
  if (type === 6) return bytes.length >= 8 ? 8 + Math.abs(bytes.readInt32BE(4)) : null
  const length = FIXED_LENGTHS.get(type)

  if (length === undefined) throw new Error(`message ${String(type)}`)

  return length
}

/**
 * A phone's RFB pointer and key events, sent to one page as Electron input
 * events: in the page's CSS pixels, never through the Mac's own pointer or
 * keyboard.
 */
export class PageInput {
  /** The page's device pixels per CSS pixel, for the phone's pointer. */
  scale = 1
  private buttons = 0
  private readonly modifiers = new Set<Modifier>()
  private readonly page: Pick<WebContents, 'isDestroyed' | 'sendInputEvent' | 'executeJavaScript'>

  constructor(page: Pick<WebContents, 'isDestroyed' | 'sendInputEvent' | 'executeJavaScript'>) {
    this.page = page
  }

  /**
   * The phone's pointer is in frame pixels; the page wants CSS pixels. The page
   * keeps the dock's own width while it is on the Mac's screen, not the phone's,
   * so the ratio comes from the page itself each time its frame changes size.
   */
  fit(frameWidth: number): void {
    if (this.page.isDestroyed()) return
    void (this.page.executeJavaScript('window.innerWidth') as Promise<unknown>)
      .then((css) => {
        if (typeof css === 'number' && css > 0) this.scale = frameWidth / css
      })
      .catch(() => {})
  }

  pointer(mask: number, rawX: number, rawY: number): void {
    const page = this.page

    if (page.isDestroyed()) return
    const x = Math.round(rawX / this.scale)
    const y = Math.round(rawY / this.scale)
    const modifiers = [...this.modifiers]
    const changed = mask ^ this.buttons

    page.sendInputEvent({ type: 'mouseMove', x, y, modifiers })
    for (const [bit, button] of BUTTONS)
      if (changed & bit)
        page.sendInputEvent({
          type: mask & bit ? 'mouseDown' : 'mouseUp',
          x,
          y,
          button,
          clickCount: 1,
          modifiers,
        })
    // Wheel bits come as a press then a release; the press scrolls.
    const pressed = mask & ~this.buttons
    const deltaY = (pressed & 8 ? WHEEL_STEP : 0) - (pressed & 16 ? WHEEL_STEP : 0)
    const deltaX = (pressed & 32 ? WHEEL_STEP : 0) - (pressed & 64 ? WHEEL_STEP : 0)

    if (deltaX || deltaY)
      page.sendInputEvent({ type: 'mouseWheel', x, y, deltaX, deltaY, modifiers })
    this.buttons = mask
  }

  key(down: boolean, keysym: number): void {
    const page = this.page

    if (page.isDestroyed()) return
    const modifier = MODIFIERS[keysym]

    if (modifier) {
      if (down) this.modifiers.add(modifier)
      else this.modifiers.delete(modifier)

      return
    }
    const modifiers = [...this.modifiers]
    const named = KEYS[keysym]
    const char = typed(keysym)
    // A shortcut (⌘A, ⌃C) is a key press; plain text is typed as characters.
    const shortcut = this.modifiers.has('meta') || this.modifiers.has('control')

    if (named || (char && shortcut)) {
      const keyCode = named ?? char ?? ''

      page.sendInputEvent({ type: down ? 'keyDown' : 'keyUp', keyCode, modifiers })
      if (down && keysym === 0xff0d) page.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    } else if (char && down) page.sendInputEvent({ type: 'char', keyCode: char, modifiers })
  }
}
