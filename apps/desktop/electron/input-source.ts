import { execFile } from 'node:child_process'

// Chromium cannot change the macOS input source, so ask Text Input Sources
// through JXA, which ships with macOS: no native module to build or sign.
const SELECT_ASCII_SOURCE =
  "ObjC.import('Carbon'); $.TISSelectInputSource($.TISCopyCurrentASCIICapableKeyboardInputSource())"

/** Switches to the user's ASCII-capable keyboard (e.g. ABC) so a launcher query
 *  typed right after focus is not composed by a CJK input method. */
export function selectAsciiInputSource(): void {
  if (process.platform !== 'darwin') return
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SELECT_ASCII_SOURCE], () => {})
}
