import { ALLOWED_WEB_HOSTS, WEB_BASE_URL } from '../web-base-url'

// Resolved in the main process, where process.env exists, and handed to the
// renderer as plain values. Synchronous on purpose: the renderer reads the base
// URL inside link-rendering paths that cannot await.
export const appConfigApi = {
  webBaseUrl: WEB_BASE_URL,
  allowedWebHosts: [...ALLOWED_WEB_HOSTS],
}
