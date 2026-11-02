/** How long "You're all set" stays before moving on into the app by itself. */
export const AUTO_FINISH_MS = 2500

/**
 * Finishes once: after AUTO_FINISH_MS, or sooner when the user clicks. cancel()
 * stops the timer without finishing (the screen went away).
 */
export function autoFinish(
  onFinish: () => void,
  delay = AUTO_FINISH_MS,
): { finish: () => void; cancel: () => void } {
  let done = false
  const timer = setTimeout(() => finish(), delay)

  function finish() {
    if (done) return
    done = true
    clearTimeout(timer)
    onFinish()
  }

  return {
    finish,
    cancel: () => {
      done = true
      clearTimeout(timer)
    },
  }
}
