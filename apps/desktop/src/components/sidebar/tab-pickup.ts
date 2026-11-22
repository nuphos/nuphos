type Point = { clientX: number; clientY: number }

/**
 * Decides when a press on a tab becomes a drag, so clicks and swipes stay clicks:
 * the tab is picked up once the pointer travels `threshold` px from the press.
 * The click that ends a pickup is swallowed once, so dropping a tab never selects it.
 */
/** `events` is where pointer moves arrive (the window), read at press time so a server render never touches it. */
export function createTabPickup(threshold: number, events: () => EventTarget) {
  let stop: (() => void) | null = null
  let picked = false

  return {
    press: (press: Point, onPickUp: () => void) => {
      stop?.()
      picked = false
      const target = events()
      const move = (event: Event) => {
        const { clientX, clientY } = event as unknown as Point

        if (Math.hypot(clientX - press.clientX, clientY - press.clientY) < threshold) return
        end()
        picked = true
        onPickUp()
      }
      const end = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', end)
        stop = null
      }

      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', end)
      target.addEventListener('pointercancel', end)
      stop = end
    },
    cancel: () => {
      stop?.()
    },
    /** True once for the click that ends a pickup. */
    consumeClick: () => {
      const swallow = picked

      picked = false

      return swallow
    },
  }
}
