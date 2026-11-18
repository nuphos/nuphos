import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { channelAgentMention } from './ChannelAgentMention'

import type { ChannelAgent } from '../../api'

const agents = [{ sessionId: 'scribe', title: '書記官', ownerId: 'owner' }] as ChannelAgent[]
const href = '#mention:agent%3Ascribe'

test('an owned agent mention opens its session, while a foreign mention stays display-only', () => {
  let opened = ''
  const open = (id: string) => {
    opened = id
  }
  const own = channelAgentMention(href, '@書記官', agents, 'owner', open)

  assert.ok(isValidElement<{ onClick: () => void }>(own))
  assert.equal(own.type, 'button')
  own.props.onClick()
  assert.equal(opened, 'scribe')
  const foreign = channelAgentMention(href, '@書記官', agents, 'viewer', open)

  assert.ok(isValidElement(foreign))
  assert.equal(foreign.type, 'span')
  assert.ok(renderToStaticMarkup(foreign).includes('@書記官'))
  assert.equal(
    channelAgentMention('#mention:agent%3Astranger', '@Other', agents, 'owner', open),
    null,
  )
})
