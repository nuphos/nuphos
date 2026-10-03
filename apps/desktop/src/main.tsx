import { config } from '@fortawesome/fontawesome-svg-core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fortawesome/fontawesome-svg-core/styles.css'
import './index.css'
import './styles/transitions-root.css'
import './styles/transitions.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ToastProvider } from './components/ui/ToastProvider'
import { installDevShim } from './devShim'
import { ThemeProvider } from './hooks/ThemeProvider'
import { initAnalytics, track } from './lib/analytics'
import { showFirstLaunchIntro } from './lib/firstLaunchIntro'
import { isMac } from './lib/platform'

// We import Font Awesome's CSS explicitly above, so stop the SVG core from
// injecting it again at runtime (prevents the brief flash of oversized icons).
config.autoAddCss = false

installDevShim()
initAnalytics()
track('app_ready')

if (isMac) {
  document.documentElement.classList.add('platform-darwin')
} else if (navigator.userAgent.includes('Windows')) {
  document.documentElement.classList.add('platform-windows')
} else if (navigator.userAgent.includes('Linux')) {
  document.documentElement.classList.add('platform-linux')
}

// Page zoom (cmd +/-) resizes the layout viewport, so `resize` fires on every
// zoom change. On each: publish the factor for the CSS traffic-light insets
// (they counter-scale to a fixed physical size) and ping main to move the native
// buttons vertically into the zoomed titlebar row.
const onZoomOrResize = () => {
  const factor = window.api.getZoomFactor?.() ?? 1

  document.documentElement.style.setProperty('--zoom-factor', String(factor || 1))
  window.api.notifyZoom?.()
}

const offFullScreen = window.api.onWindowFullScreenChanged?.((fullScreen) => {
  document.documentElement.classList.toggle('window-fullscreen', fullScreen)
})

if (import.meta.hot) import.meta.hot.dispose(() => offFullScreen?.())

onZoomOrResize()
window.addEventListener('resize', onZoomOrResize)

// Claim once in the main process so reloads and extra windows cannot replay.
if (await window.api.claimFirstLaunchIntro?.().catch(() => false)) showFirstLaunchIntro()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
