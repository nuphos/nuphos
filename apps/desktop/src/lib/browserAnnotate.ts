// Element picking for the in-app browser. The script runs in the page itself
// (the guest is sandboxed and has no preload), so everything it returns is
// page-controlled data: it only ever lands in the composer as plain text for
// the user to review before sending.

export type PickedElement = {
  url: string
  selector: string
  html: string
}

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
    finish({ url: location.href, selector: selectorFor(el), html: el.outerHTML })
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

/** Formats a picked element as composer text; the user's note goes after it. */
export function formatPickedElement(picked: PickedElement): string {
  const { url, selector, html: fullHtml } = picked
  const html = fullHtml.length > HTML_LIMIT ? `${fullHtml.slice(0, HTML_LIMIT)}…` : fullHtml
  const longestRun = Math.max(2, ...(html.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longestRun + 1)

  return [`Element on ${url}`, `Selector: ${selector}`, `${fence}html`, html, fence, ''].join('\n')
}
