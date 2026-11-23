// A window reload keeps its modules cached (#4202), so it costs the dev server its document
// alone instead of ~2,000 module requests at once, the burst that could blank the window.
import type { Scenario } from './ui.ts'

/** Measured with the cache: 1 to 8 per load; without it: 2,001 to 2,152 (#4242). */
const MOST_REQUESTS = 100

export const reloadScenarios: Scenario[] = [
  {
    name: 'a window reload asks the dev server for its document, not its modules',
    run: async (page, _stack, desktop) => {
      if (!desktop) throw new Error("This scenario needs the main suite's window")
      const origin = `:${String(desktop.vitePort)}/`
      const cdp = await page.context().newCDPSession(page)
      const asked: string[] = []

      // What the browser did not take from its disk cache is what reached the dev server.
      cdp.on('Network.responseReceived', ({ response }) => {
        if (!response.fromDiskCache && response.url.includes(origin)) asked.push(response.url)
      })
      await cdp.send('Network.enable')
      try {
        await page.reload()
      } finally {
        await cdp.detach()
      }
      if (asked.length > MOST_REQUESTS)
        throw new Error(
          `The reload asked the dev server for ${String(asked.length)} things (at most ${String(MOST_REQUESTS)} expected), so its modules were not cached; check the e2e-keep-modules-cached plugin in apps/desktop/vite.config.ts. First ones: ${asked.slice(0, 5).join(', ')}`,
        )
    },
  },
]
