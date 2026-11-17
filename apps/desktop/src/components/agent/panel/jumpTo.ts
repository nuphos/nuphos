/** Scrolls to a chat post or conversation message and flashes it, if it is on screen. */
export function jumpTo(id: string) {
  const key = CSS.escape(id)
  const target = document.querySelector<HTMLElement>(
    `[data-post-id="${key}"], [data-message-id="${key}"]`,
  )

  if (!target) return
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.remove('cell-flash')
  requestAnimationFrame(() => target.classList.add('cell-flash'))
}
