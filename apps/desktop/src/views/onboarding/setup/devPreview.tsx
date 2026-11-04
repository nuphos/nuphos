import { createRoot } from 'react-dom/client'

import { AgentSetupFlow } from './AgentSetupFlow'

let closePreview: (() => void) | undefined

/** Replay setup without creating another workspace or changing its membership. */
export function showRuntimeSetupPreview() {
  closePreview?.()
  document.getElementById('runtime-ux-preview')?.remove()
  const container = document.createElement('div')

  container.id = 'runtime-ux-preview'
  Object.assign(container.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '999',
    background: document.documentElement.classList.contains('light') ? '#f5f5f7' : '#18181b',
  })
  document.body.append(container)
  const root = createRoot(container)

  closePreview = () => {
    root.unmount()
    container.remove()
    closePreview = undefined
  }
  root.render(<AgentSetupFlow workspaceCreated onFinish={() => closePreview?.()} />)
}
