/**
 * Platform detection + keyboard-combo formatting. Kept free of DOM/React so
 * node:test can exercise `comboParts` directly.
 */

export const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')
export const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')

const MAC_PARTS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
  enter: '↵',
  backspace: '⌫',
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
  backspace: 'Backspace',
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

// Apple's menu order: ⌃⌥⇧⌘ before the key, whatever order the combo lists them.
const MAC_MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'mod']

function macModifierRank(token: string): number {
  const index = MAC_MODIFIER_ORDER.indexOf(token.toLowerCase())

  return index === -1 ? MAC_MODIFIER_ORDER.length : index
}

/**
 * A combo as one plain string for menus and tooltips: '⇧⌘A' on mac (Apple
 * modifier order, no separators), 'Ctrl+Shift+A' elsewhere.
 */
export function comboText(combo: string, mac: boolean = isMac): string {
  if (!mac) return comboParts(combo, false).join('+')
  const tokens = combo.split('+').map((token) => token.trim())
  const sorted = [...tokens].sort((a, b) => macModifierRank(a) - macModifierRank(b))

  return comboParts(sorted.join('+'), true).join('')
}
