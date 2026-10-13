// Comment mode for the in-app browser. The page script runs in the page's main
// world (the guest is sandboxed and has no preload), so the page can replace
// anything it calls and decide the whole result. It only reports which element
// was clicked; the comment itself is typed in the host, out of the page's
// reach, and every page-controlled field is validated and bounded here.

export type PickedElement = {
  selector: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
}

const SELECTOR_LIMIT = 300
const TEXT_LIMIT = 80

/**
 * Installs comment mode once per document, optionally pins the element that
 * was just commented on, and resolves with the next clicked element — or null
 * when the user leaves comment mode from the page (Esc).
 */
export function commentModeScript(pin?: number): string {
  return `(() => {
  let s = window.__nuphosComments
  if (!s) {
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'closed' })
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
      'border:2px solid #d97757;background:rgba(217,119,87,.12);border-radius:3px'
    root.append(box)
    document.documentElement.append(host)
    const pins = []
    let locked = null
    let hovered = null
    let frame = 0

    const selectorFor = (el) => {
      const parts = []
      for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
        if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
          parts.unshift('#' + CSS.escape(node.id))
          break
        }
        const tag = node.localName
        const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.localName === tag) : []
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag)
      }
      return parts.join(' > ')
    }
    const tick = () => {
      const target = locked || hovered
      if (target) {
        const r = target.getBoundingClientRect()
        Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
      } else box.style.display = 'none'
      for (const pin of pins) {
        const r = pin.el.getBoundingClientRect()
        pin.node.style.left = r.left - 9 + 'px'
        pin.node.style.top = r.top - 9 + 'px'
      }
      frame = requestAnimationFrame(tick)
    }
    const move = (event) => { hovered = event.target }
    const swallow = (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const click = (event) => {
      swallow(event)
      if (!s.waiter || locked) return
      locked = event.target
      const r = locked.getBoundingClientRect()
      const resolve = s.waiter
      s.waiter = null
      resolve({
        selector: selectorFor(locked),
        text: (locked.innerText || '').slice(0, 500),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      })
    }
    const key = (event) => {
      if (event.key !== 'Escape') return
      swallow(event)
      s.exit()
    }
    const events = [['mousemove', move], ['mousedown', swallow], ['mouseup', swallow], ['click', click], ['keydown', key]]
    s = window.__nuphosComments = {
      waiter: null,
      arm: () => {
        locked = null
        return new Promise((resolve) => { s.waiter = resolve })
      },
      pin: (n) => {
        if (!locked) return
        const node = document.createElement('div')
        node.textContent = n
        node.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;width:18px;height:18px;' +
          'border-radius:9px;background:#d97757;color:#fff;font:600 11px/18px system-ui,sans-serif;' +
          'text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)'
        root.append(node)
        pins.push({ el: locked, node })
      },
      exit: () => {
        for (const [type, fn] of events) removeEventListener(type, fn, true)
        cancelAnimationFrame(frame)
        host.remove()
        delete window.__nuphosComments
        s.waiter?.(null)
      },
    }
    for (const [type, fn] of events) addEventListener(type, fn, true)
    frame = requestAnimationFrame(tick)
  }
  ${pin === undefined ? '' : `s.pin(${String(Math.trunc(pin))})`}
  return s.arm()
})()`
}

export const EXIT_COMMENT_MODE_SCRIPT = 'window.__nuphosComments?.exit()'

/** Validates the page's pick result; anything malformed is dropped. */
export function parsePick(raw: unknown): PickedElement | null {
  if (!raw || typeof raw !== 'object') return null
  const { selector, text, rect } = raw as Record<string, unknown>

  if (typeof selector !== 'string' || typeof text !== 'string') return null
  if (!rect || typeof rect !== 'object') return null
  const { x, y, width, height } = rect as Record<string, unknown>

  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null

  return {
    selector: oneLine(selector, SELECTOR_LIMIT).replaceAll('`', ''),
    text: oneLine(text, TEXT_LIMIT),
    rect: { x: x as number, y: y as number, width: width as number, height: height as number },
  }
}

/**
 * One composer paragraph per comment; the element screenshot travels as an
 * attachment. Ends with two newlines: the editor parks the caret before a lone
 * trailing newline, which would glue whatever the user types next onto it.
 */
export function formatComment(n: number, url: string, picked: PickedElement, note: string): string {
  const label = picked.text ? ` ("${picked.text}")` : ''

  return `Comment ${String(n)} on ${url} — \`${picked.selector}\`${label}: ${note.trim()}\n\n`
}

/** Padded capture area around an element, clipped at the page's top-left. */
export function captureArea(rect: PickedElement['rect']) {
  const pad = 8
  const x = Math.max(0, Math.floor(rect.x - pad))
  const y = Math.max(0, Math.floor(rect.y - pad))

  return {
    x,
    y,
    width: Math.max(1, Math.ceil(rect.x + rect.width + pad) - x),
    height: Math.max(1, Math.ceil(rect.y + rect.height + pad) - y),
  }
}

function oneLine(text: string, limit: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > limit ? `${line.slice(0, limit)}…` : line
}
