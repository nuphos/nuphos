import { t } from '../i18n/index.ts'

import './firstLaunchIntro.css'

/** Shows the app icon over the first window for a moment, then fades it away. */
export function showFirstLaunchIntro() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  let preference: string | null = null

  try {
    preference = localStorage.getItem('atlas.theme')
  } catch {
    // Use the system theme when storage is unavailable.
  }
  const light =
    preference === 'light' ||
    (preference !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches)
  const intro = document.createElement('div')
  const icon = document.createElement('img')

  icon.src = '/nuphos-icon.png'
  icon.alt = ''
  intro.append(icon)
  intro.setAttribute('role', 'img')
  intro.setAttribute('aria-label', t('Welcome to Nuphos'))
  intro.className = 'first-launch-intro'
  intro.style.background = light ? '#fcfcfd' : '#18181b'
  let dismissing = false
  const dismiss = () => {
    clearTimeout(timeout)
    window.removeEventListener('keydown', onKeyDown)
    if (dismissing) return
    dismissing = true
    intro.classList.add('is-leaving')
    intro.addEventListener('transitionend', () => intro.remove(), { once: true })
    setTimeout(() => intro.remove(), 500)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss()
  }
  const timeout = setTimeout(dismiss, 1500)

  window.addEventListener('keydown', onKeyDown)
  document.body.append(intro)
}
