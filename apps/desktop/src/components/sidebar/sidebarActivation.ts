/** Coalesce rapid mode changes; never reopen the conversation already displayed. */
export function sidebarActivation(delay = 0) {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    schedule(active: string, target: string, open: () => void) {
      clearTimeout(timer)
      if (active !== target) timer = setTimeout(open, delay)
    },
    cancel() {
      clearTimeout(timer)
    },
  }
}
