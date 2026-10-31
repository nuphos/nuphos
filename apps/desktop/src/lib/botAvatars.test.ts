import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  BOT_AVATARS,
  DEFAULT_BOT_AVATAR_COUNT,
  botAvatarLabel,
  botAvatarName,
  botAvatarUrl,
  derivedBotAvatar,
} from './botAvatars.ts'

test('Agent identities resolve consistently to one of the first 28 shipped vector assets', () => {
  assert.equal(new Set(BOT_AVATARS).size, 29)
  const seen = new Set<string>()

  for (let i = 0; i < 1000; i++) {
    const id = `agent-${String(i)}`
    const url = botAvatarUrl(id)

    assert.equal(url, botAvatarUrl(id))
    assert.ok(BOT_AVATARS.some((name) => url.endsWith(name)))
    seen.add(url)
  }
  assert.equal(seen.size, DEFAULT_BOT_AVATAR_COUNT)
  for (const name of BOT_AVATARS) {
    const svg = readFileSync(new URL(`../../public/bot-avatars/${name}`, import.meta.url), 'utf8')

    assert.match(svg, /viewBox="0 0 256 256"/)
    assert.doesNotMatch(svg, /<image|<script|onload=|data:image/)
  }
})

// Swift reads this same fixture in apps/ios/tests/BotAvatarTests.swift.
test('Desktop and iOS share the exact ID mapping and SVG bytes', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('../../../ios/tests/fixtures/bot-avatars.json', import.meta.url), 'utf8'),
  ) as { id: string; file: string }[]

  for (const { id, file } of fixtures) assert.equal(botAvatarUrl(id), `/bot-avatars/${file}`)
  assert.equal(new Set(fixtures.map(({ file }) => file)).size, 28)
  for (const file of BOT_AVATARS) {
    const ios = new URL(
      `../../../ios/BotAvatars/BotAvatars.xcassets/bot-avatar-${file.slice(0, -4)}.imageset/${file}`,
      import.meta.url,
    )

    assert.deepEqual(
      readFileSync(ios),
      readFileSync(new URL(`../../public/bot-avatars/${file}`, import.meta.url)),
    )
  }
})

// The fixture was recorded with 28 characters. It must keep passing as characters are appended.
test('existing Agents keep their face; an appended character is pickable but never a default', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('../../../ios/tests/fixtures/bot-avatars.json', import.meta.url), 'utf8'),
  ) as { id: string; file: string }[]
  const firstTwentyEight = new Set<string>(BOT_AVATARS.slice(0, DEFAULT_BOT_AVATAR_COUNT))

  for (const { id, file } of fixtures) assert.equal(derivedBotAvatar(id), file, id)
  for (let i = 0; i < 1000; i++) {
    const file = derivedBotAvatar(`agent-${String(i)}`)

    assert.ok(firstTwentyEight.has(file))
    assert.notEqual(file, '29-amelia-earhart.svg')
  }
  assert.ok(BOT_AVATARS.includes('29-amelia-earhart.svg'))
  assert.equal(botAvatarUrl('any-agent', '29-amelia-earhart'), '/bot-avatars/29-amelia-earhart.svg')
})

test('a picked character wins; a name this build does not ship falls back to the ID', () => {
  assert.equal(botAvatarUrl('any-agent', '05-rembrandt'), '/bot-avatars/05-rembrandt.svg')
  assert.equal(botAvatarUrl('any-agent', '99-from-the-future'), botAvatarUrl('any-agent'))
  assert.equal(botAvatarUrl('any-agent', null), botAvatarUrl('any-agent'))
  for (const file of BOT_AVATARS) assert.match(botAvatarName(file), /^\d{2}-[a-z0-9-]{1,40}$/)
  assert.equal(botAvatarLabel('22-lady-with-an-ermine.svg'), 'Lady with an ermine')
  assert.equal(botAvatarLabel('03-mona-lisa.svg'), 'Mona Lisa')
  assert.equal(botAvatarLabel('10-van-gogh.svg'), 'Van Gogh')
  assert.equal(botAvatarLabel('29-amelia-earhart.svg'), 'Amelia Earhart')
  assert.equal(botAvatarName('29-amelia-earhart.svg'), '29-amelia-earhart')
})
