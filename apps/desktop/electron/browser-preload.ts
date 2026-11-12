// Preload for web pages in the Dock browser session (`persist:browser`), registered by
// `initWebviewGuard`. It exposes nothing to the page; it only fills in Chrome's own globals.
import { contextBridge } from 'electron'

import { addChromeObject } from './browser-preload/chrome-object'

contextBridge.executeInMainWorld({ func: addChromeObject })
