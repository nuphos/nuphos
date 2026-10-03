import './firstLaunchIntro.css'

export function showFirstLaunchIntro() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const frame = document.createElement('iframe')

  let preference: string | null = null

  try {
    preference = localStorage.getItem('atlas.theme')
  } catch {
    // Use the system theme when storage is unavailable.
  }
  const light =
    preference === 'light' ||
    (preference !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches)
  const url = new URL('logo-intro/index.html', document.baseURI)

  url.searchParams.set('theme', light ? 'light' : 'dark')
  frame.src = url.href
  frame.title = 'Welcome to Nuphos'
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.className = 'first-launch-intro'
  frame.style.background = light ? '#fcfcfd' : '#18181b'
  let dismissing = false
  const dismiss = () => {
    clearTimeout(timeout)
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onKeyDown)
    if (dismissing) return
    dismissing = true
    frame.classList.add('is-leaving')
    frame.addEventListener('transitionend', () => frame.remove(), { once: true })
    setTimeout(() => frame.remove(), 500)
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.data === 'nuphos:introFinished') dismiss()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss()
  }
  // Also release the app if WebGL, module loading, or playback fails.
  const timeout = setTimeout(dismiss, 7000)

  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeyDown)
  document.body.append(frame)
}
