import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChannelFace } from '../../api'

mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))
mock.module('../agent/panel/CredentialSelectorButton', () => ({
  CredentialSelectorButton: () => null,
}))
const { ChatIcon } = await import('./channelParts')

const faces: ChannelFace[] = [
  { id: 'bot', name: 'Writer', agent: { avatar: 'pick', provider: 'codex' } },
  { id: 'dana', name: 'Dana' },
  { id: 'eli', name: 'Eli' },
  { id: 'fay', name: 'Fay' },
]

function discs(html: string) {
  return [...html.matchAll(/data-chat-face="([^"]+)"[^>]*style="([^"]+)"/g)].map(
    ([, id, style]) => {
      const px = (name: string) =>
        Number(new RegExp(`(?:^|;)${name}:([\\d.]+)(?:px)?`).exec(style)?.[1])

      return {
        id,
        left: px('left'),
        top: px('top'),
        size: px('width'),
        ring: style.includes('2px'),
      }
    },
  )
}

test('a group chat in the sidebar is the design system cluster of three faces', () => {
  const html = renderToStaticMarkup(
    createElement(ChatIcon, { faces, title: 'Launch', sidebar: true }),
  )

  assert.deepEqual(discs(html), [
    { id: 'bot', left: 0, top: 0, size: 24, ring: true },
    { id: 'dana', left: 18, top: 12, size: 18, ring: true },
    { id: 'eli', left: 5, top: 22, size: 14, ring: true },
  ])
  assert.ok(html.includes('bg-surface-sunken'))
})

test('two other members take the cluster’s first two places', () => {
  const html = renderToStaticMarkup(
    createElement(ChatIcon, { faces: faces.slice(0, 2), title: 'Pair', sidebar: true }),
  )

  assert.deepEqual(
    discs(html).map(({ id, size }) => [id, size]),
    [
      ['bot', 24],
      ['dana', 18],
    ],
  )
})

test('other sizes scale the same cluster', () => {
  const html = renderToStaticMarkup(createElement(ChatIcon, { faces, title: 'Launch', size: 18 }))

  assert.deepEqual(
    discs(html).map(({ left, top, size }) => [left, top, size]),
    [
      [0, 0, 12],
      [9, 6, 9],
      [2.5, 11, 7],
    ],
  )
})

test('one other member is that member’s face alone, and nobody shows initials', () => {
  assert.deepEqual(
    discs(renderToStaticMarkup(createElement(ChatIcon, { faces: faces.slice(1, 2), title: 'x' }))),
    [],
  )
  assert.ok(renderToStaticMarkup(createElement(ChatIcon, { title: 'Launch room' })).includes('LR'))
})
