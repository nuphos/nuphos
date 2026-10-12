// Element picking for the in-app browser. The script runs in the page's main
// world (the guest is sandboxed and has no preload), so the page can replace
// anything it calls and decide the whole result. Treat it as untrusted: the
// formatter validates and bounds every field before it reaches the composer.

const SELECTOR_LIMIT = 300
const HTML_LIMIT = 600

/** Resolves with the clicked element, or null when the pick is cancelled. */
export const PICK_ELEMENT_SCRIPT = `new Promise((resolve) => {
  window.__nuphosPick?.(null)
  const host = document.createElement('div')
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
    'border:2px solid #d97757;background:rgba(217,119,87,.15);border-radius:2px'
  host.attachShadow({ mode: 'closed' }).append(box)
  document.documentElement.append(host)

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
  const move = (event) => {
    const rect = event.target.getBoundingClientRect()
    Object.assign(box.style, {
      display: 'block',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    })
  }
  const swallow = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const click = (event) => {
    swallow(event)
    const el = event.target
    finish({ selector: selectorFor(el), html: el.outerHTML })
  }
  const key = (event) => {
    if (event.key !== 'Escape') return
    swallow(event)
    finish(null)
  }
  const finish = (result) => {
    removeEventListener('mousemove', move, true)
    removeEventListener('mousedown', swallow, true)
    removeEventListener('mouseup', swallow, true)
    removeEventListener('click', click, true)
    removeEventListener('keydown', key, true)
    host.remove()
    delete window.__nuphosPick
    resolve(result)
  }
  addEventListener('mousemove', move, true)
  addEventListener('mousedown', swallow, true)
  addEventListener('mouseup', swallow, true)
  addEventListener('click', click, true)
  addEventListener('keydown', key, true)
  window.__nuphosPick = finish
})`

export const CANCEL_PICK_SCRIPT = 'window.__nuphosPick?.(null)'

/**
 * Formats a picked element as composer text; the user's note goes after it.
 * `url` comes from the host. Returns null for a malformed pick result.
 */
export function formatPickedElement(url: string, picked: unknown): string | null {
  if (!picked || typeof picked !== 'object') return null
  const { selector: rawSelector, html: rawHtml } = picked as Record<string, unknown>

  if (typeof rawSelector !== 'string' || typeof rawHtml !== 'string') return null
  const selector = truncate(rawSelector.replace(/\s+/g, ' ').trim(), SELECTOR_LIMIT)
  const html = truncate(rawHtml, HTML_LIMIT)
  const longestRun = Math.max(2, ...(html.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longestRun + 1)

  // Two trailing newlines: the editor parks the caret before a lone trailing
  // newline, which would glue the user's note onto the closing fence.
  return [`Element on ${url}`, `Selector: ${selector}`, `${fence}html`, html, fence, '', ''].join(
    '\n',
  )
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
