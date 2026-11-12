import { ipcRenderer } from 'electron'

export const sidebarGesturesApi = {
  onSidebarGesture: (callback: (phase: 'begin' | 'end') => void) => {
    const listener = (_event: unknown, phase: 'begin' | 'end') => callback(phase)

    ipcRenderer.on('sidebar:gesture-phase', listener)

    return () => ipcRenderer.off('sidebar:gesture-phase', listener)
  },
  sidebarAlignmentFeedback: () => ipcRenderer.send('sidebar:haptic'),
}
