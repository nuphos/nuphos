/**
 * The keyboard shortcuts shown in the ⌘/ cheat sheet. Pure data (no React)
 * so node:test can validate every combo renders through comboParts. Combos
 * use the 'mod+key' notation from src/lib/platform.ts.
 */

import { t } from '../i18n/index.ts'

import { isMac } from './platform.ts'

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
    title: t('Tabs & windows'),
    entries: [
      { label: t('New agent'), combos: ['mod+n'] },
      { label: t('New window'), combos: ['mod+shift+n'] },
      { label: t('New tab'), combos: ['mod+t'] },
      { label: t('Close tab'), combos: ['mod+w'] },
      { label: t('Reopen closed tab'), combos: ['mod+shift+t'] },
      { label: t('Previous / next tab'), combos: ['mod+shift+[', 'mod+shift+]'] },
      { label: t('Go to tab 1–8'), combos: ['mod+1'] },
      { label: t('Go to last tab'), combos: ['mod+9'] },
    ],
  },
  {
    title: t('App'),
    entries: [
      { label: t('Search agents and people'), combos: ['mod+k'] },
      { label: t('Switch agent'), combos: ['alt+up', 'alt+down'] },
      { label: t('Agent needing you'), combos: ['alt+shift+up', 'alt+shift+down'] },
      {
        label: t('Back / forward'),
        combos: isMac ? ['mod+[', 'mod+]'] : ['alt+left', 'alt+right'],
      },
      { label: t('User settings'), combos: ['mod+,'] },
      { label: t('Team settings'), combos: ['mod+shift+,'] },
      { label: t('Toggle sidebar'), combos: ['mod+b'] },
      { label: t('Toggle workspace panel'), combos: ['mod+j'] },
      { label: t('Next / previous area'), combos: ['F6', 'shift+F6'] },
      { label: t('Expand / restore workspace panel'), combos: ['mod+shift+enter'] },
      { label: t('Keyboard shortcuts'), combos: ['mod+/'] },
      { label: t('Zoom in / out'), combos: ['mod+plus', 'mod+minus'] },
      { label: t('Reset zoom'), combos: ['mod+0'] },
    ],
  },
  {
    title: t('Agent'),
    entries: [
      { label: t('Send message'), combos: ['enter'] },
      { label: t('New line'), combos: ['shift+enter'] },
      { label: t('Accept suggested prompt'), combos: ['tab'] },
      { label: t('Select effort'), combos: ['ctrl+shift+m'] },
      { label: t('Recall sent message'), combos: ['up', 'down'] },
      { label: t('Approve tool or plan'), combos: ['mod+enter'] },
      { label: t('Deny tool'), combos: ['mod+backspace'] },
      { label: t('Pick option 1–9'), combos: ['mod+alt+1'] },
      { label: t('Stop response'), combos: ['esc'] },
      { label: t('Copy last reply'), combos: ['mod+alt+c'] },
      { label: t('Find in conversation'), combos: ['mod+f'] },
      { label: t('Scroll conversation'), combos: ['pageup', 'pagedown'] },
      { label: t('Toggle agent summary'), combos: ['mod+i'] },
    ],
  },
  {
    title: t('General'),
    entries: [
      { label: t('Close dialog or overlay'), combos: ['esc'] },
      { label: t('Sidebar row menu'), combos: ['shift+F10'] },
    ],
  },
]
