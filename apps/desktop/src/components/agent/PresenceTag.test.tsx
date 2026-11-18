import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PresenceTag } from './PresenceTag'

import type { BotPresence } from '../../api'

const tag = (presence: BotPresence) =>
  renderToStaticMarkup(createElement(PresenceTag, { presence }))

test("a Bot's row says whether it can reply, in the runtime menu's colours", () => {
  const cases: [BotPresence, string, string][] = [
    [{ state: 'online' }, 'bg-success', 'Online'],
    [{ state: 'busy' }, 'bg-success', 'Busy'],
    [{ state: 'offline', reason: 'computer_offline' }, 'bg-error', 'Offline'],
    [{ state: 'offline', reason: 'sign_in_required' }, 'bg-warning', 'Needs sign-in'],
    [{ state: 'offline', reason: 'usage_limit' }, 'bg-warning', 'Out of usage'],
    [{ state: 'offline', reason: 'runtime_deleted' }, 'bg-error', 'Unavailable'],
    [{ state: 'offline', reason: 'owner_removed' }, 'bg-error', 'Unavailable'],
  ]

  for (const [presence, color, word] of cases) {
    const html = tag(presence)

    assert.ok(html.includes(color) && html.includes(word), html)
  }
})
