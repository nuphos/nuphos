import { net } from 'electron'

/**
 * Send every main-process request through Chromium's network stack, the one
 * the window itself uses. Node's own fetch ignores the system proxy and gives
 * up on connects Chromium completes, so on VPNs and slow networks each backend
 * call timed out and retried for ~30s while the window was online. Call after
 * app ready: net.fetch is unavailable before it.
 */
export function routeFetchThroughChromium(): void {
  globalThis.fetch = (input, init) => net.fetch(input instanceof URL ? input.href : input, init)
}
