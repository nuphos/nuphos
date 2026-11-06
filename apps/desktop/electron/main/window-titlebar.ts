export const TITLEBAR_ROW_H = 44 // CSS px at 100% (App.tsx and Sidebar.tsx)
// The workspace sheets sit one inset in from the window edge (`--sheet-inset` in
// index.css), so the title-bar row starts that much lower too.
export const TITLEBAR_TOP_INSET = 8

export function titleBarOverlayFor(platform: NodeJS.Platform) {
  return platform !== 'darwin'
    ? {
        // The OS draws the caption buttons from the window's top edge down to
        // this height. Covering the inset above and below the title-bar row
        // centres their glyphs on the same line as the row and the sheets.
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#9ca3af',
          height: TITLEBAR_ROW_H + 2 * TITLEBAR_TOP_INSET,
        },
      }
    : {}
}
