/**
 * Platform detection + keyboard-combo formatting. Kept free of DOM/React so
 * node:test can exercise `comboParts` directly.
 */

export const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')

const MAC_PARTS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
  enter: '↵',
  esc: 'Esc',
  tab: '⇥',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  plus: '+',
  minus: '−',
}

const OTHER_PARTS: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
  enter: 'Enter',
  esc: 'Esc',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  plus: '+',
  minus: '−',
}

/**
 * Turn a combo like 'mod+shift+t' into display parts: ['⌘','⇧','T'] on mac,
 * ['Ctrl','Shift','T'] elsewhere. Single characters are uppercased; tokens
 * missing from the map pass through as-is (so 'mod+,' → ['⌘',',']).
 */
export function comboParts(combo: string, mac: boolean = isMac): string[] {
  const table = mac ? MAC_PARTS : OTHER_PARTS

  return combo.split('+').map((raw) => {
    const token = raw.trim()
    const mapped = table[token.toLowerCase()]

    if (mapped) return mapped

    return token.length === 1 ? token.toUpperCase() : token
  })
}
