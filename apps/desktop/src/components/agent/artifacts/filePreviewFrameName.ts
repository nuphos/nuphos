/**
 * The HTML file preview frame's name. The main process refuses any navigation
 * of a frame by this name (electron/main/file-preview-guard.ts), whose test
 * checks the two agree. Kept apart so that test needs nothing from the DOM.
 */
export const FILE_PREVIEW_FRAME_NAME = 'nuphos-file-preview'
