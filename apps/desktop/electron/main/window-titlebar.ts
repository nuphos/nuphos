export const TITLEBAR_ROW_H = 44 // CSS px at 100% (App.tsx and Sidebar.tsx)

export function titleBarOverlayFor(platform: NodeJS.Platform) {
  return platform !== 'darwin'
    ? {
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#9ca3af',
          height: TITLEBAR_ROW_H,
        },
      }
    : {}
}
