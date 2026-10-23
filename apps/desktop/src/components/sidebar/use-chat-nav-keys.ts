import { useEffect, useRef } from 'react'

import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { useAgentUnreadSessions } from '../../lib/agentUnreadSessions'
import { chatRowIndicator } from '../../lib/runtimeExecution'

import { chatNavKey, chatRowToward } from './chat-nav'

import type { Item, Section } from './types'

/**
 * ⌥↑ / ⌥↓ open the previous / next chat in the sidebar; ⌥⇧↑ / ⌥⇧↓ skip to
 * the next one needing attention, i.e. showing the unread dot or the error mark.
 */
export function useChatNavKeys(
  sections: Section[],
  isGroupCollapsed: (section: Pick<Section, 'title' | 'defaultCollapsed'>) => boolean,
  onSelect: (key: string) => void,
  live: boolean,
) {
  const runtimeStates = useAgentRuntimeStates()
  const unread = useAgentUnreadSessions()
  const latest = useRef({ sections, isGroupCollapsed, onSelect, runtimeStates, unread })

  useEffect(() => {
    latest.current = { sections, isGroupCollapsed, onSelect, runtimeStates, unread }
  })

  useEffect(() => {
    // Behind an overlay the keys stay with its text fields.
    if (!live) return
    const onKeyDown = (event: KeyboardEvent) => {
      const nav = chatNavKey(event)

      if (!nav) return
      event.preventDefault()
      const now = latest.current
      const needsAttention = (item: Item) => {
        const sessionId = item.key.slice('agent-session:'.length)
        const indicator = chatRowIndicator(
          now.runtimeStates.get(sessionId),
          now.unread.has(sessionId),
        )

        return indicator === 'unread' || indicator === 'error'
      }
      const target = chatRowToward(
        now.sections,
        now.isGroupCollapsed,
        nav.step,
        nav.attentionOnly ? needsAttention : undefined,
      )

      if (!target) return
      if (target.onActivate) target.onActivate(false)
      else now.onSelect(target.key)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [live])
}
