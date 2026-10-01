import { useLayoutEffect, useRef } from 'react'

import { consumeSentMessageMotion } from './sentMessageMotion'

export function useSentMessageMotion(messageId: string) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current

    if (!element) return
    // Defer consumption until the committed frame so Strict Mode's setup /
    // cleanup probe cannot swallow the entrance. Cancel on unmount or ID change.
    const frame = requestAnimationFrame(() => {
      if (!consumeSentMessageMotion(messageId)) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      element.classList.add('t-panel-slide', 't-message-send')
      element.dataset.open = 'false'
      element.getBoundingClientRect()
      element.dataset.open = 'true'
    })
    const finish = (event: TransitionEvent) => {
      if (event.target === element) element.classList.remove('t-panel-slide', 't-message-send')
    }

    element.addEventListener('transitionend', finish)

    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('transitionend', finish)
      element.classList.remove('t-panel-slide', 't-message-send')
      delete element.dataset.open
    }
  }, [messageId])

  return ref
}
