/**
 * The keyboard shortcuts shown in the ⌘/ cheat sheet. Pure data (no React)
 * so node:test can validate every combo renders through comboParts. Combos
 * use the 'mod+key' notation from src/lib/platform.ts.
 */

export type ShortcutEntry = {
  label: string
  /** One or more equivalent combos, each rendered as its own key cap group. */
  combos: string[]
}

export type ShortcutGroup = {
  title: string
  entries: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tabs & windows',
    entries: [
      { label: 'New agent', combos: ['mod+n'] },
      { label: 'New window', combos: ['mod+shift+n'] },
      { label: 'New tab', combos: ['mod+t'] },
      { label: 'Close tab', combos: ['mod+w'] },
      { label: 'Reopen closed tab', combos: ['mod+shift+t'] },
      { label: 'Previous / next tab', combos: ['mod+shift+[', 'mod+shift+]'] },
      { label: 'Go to tab 1–8', combos: ['mod+1'] },
      { label: 'Go to last tab', combos: ['mod+9'] },
    ],
  },
  {
    title: 'App',
    entries: [
      { label: 'Search agents and people', combos: ['mod+k'] },
      { label: 'User settings', combos: ['mod+,'] },
      { label: 'Team settings', combos: ['mod+shift+,'] },
      { label: 'Toggle sidebar', combos: ['mod+b'] },
      { label: 'Expand / restore workspace panel', combos: ['mod+shift+enter'] },
      { label: 'Keyboard shortcuts', combos: ['mod+/'] },
      { label: 'Zoom in / out', combos: ['mod+plus', 'mod+minus'] },
      { label: 'Reset zoom', combos: ['mod+0'] },
    ],
  },
  {
    title: 'Agent',
    entries: [
      { label: 'Send message', combos: ['enter'] },
      { label: 'New line', combos: ['shift+enter'] },
      { label: 'Accept suggested prompt', combos: ['tab'] },
      { label: 'Select effort', combos: ['ctrl+shift+m'] },
      { label: 'Recall sent message', combos: ['up', 'down'] },
      { label: 'Approve tool or plan', combos: ['mod+enter'] },
      { label: 'Deny tool', combos: ['mod+backspace'] },
      { label: 'Pick option 1–9', combos: ['alt+1'] },
      { label: 'Stop response', combos: ['esc'] },
      { label: 'Find in conversation', combos: ['mod+f'] },
      { label: 'Toggle agent summary', combos: ['mod+i'] },
    ],
  },
  {
    title: 'General',
    entries: [{ label: 'Close dialog or overlay', combos: ['esc'] }],
  },
]
