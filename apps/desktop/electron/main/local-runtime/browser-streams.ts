import { LocalBrowserStream } from './browser-stream.ts'
import { runBrowserCall } from './browser-tabs.ts'
import { BrowserViewStream } from './browser-view.ts'
import { watchDockTab } from './dock-tabs.ts'

import type { SocketLike } from './tunnel-client.ts'

/** The device tunnel's browser streams: the agent's `local_browser` calls, and a phone watching a dock tab. */
export const browserStreams = {
  connectBrowser: (): SocketLike => new LocalBrowserStream(runBrowserCall),
  connectBrowserView: (): SocketLike => new BrowserViewStream(watchDockTab),
}
