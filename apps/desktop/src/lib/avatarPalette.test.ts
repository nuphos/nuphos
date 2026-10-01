import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVATAR_GRADIENTS, avatarGradient } from './avatarPalette.ts'

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))

  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05)
}

// The initials are white, so a swatch that drifts light makes them unreadable
// rather than merely ugly. Every stop, not just the average of the pair.
test('every gradient stop stays readable under white initials', () => {
  for (const gradient of AVATAR_GRADIENTS) {
    for (const stop of [gradient.from, gradient.to]) {
      assert.match(stop, /^#[0-9A-F]{6}$/, `${gradient.name} has a malformed stop: ${stop}`)
      const ratio = contrastWithWhite(stop)

      assert.ok(ratio >= 4.2, `${gradient.name} ${stop} is only ${ratio.toFixed(2)}:1 on white`)
    }
  }
})

test('a team keeps the same colour every render', () => {
  const name = '潮網科技研發部'

  assert.deepEqual(avatarGradient(name), avatarGradient(name))
  assert.deepEqual(avatarGradient(' Acme Cloud '), avatarGradient('Acme Cloud'))
})

test('the hash is position-sensitive', () => {
  assert.notDeepEqual(avatarGradient('Acme Cloud'), avatarGradient('Cloud Acme'))
})

test('a realistic set of team names spreads across the palette', () => {
  const names = [
    '潮網科技研發部',
    'Zeabur',
    'Acme Cloud',
    'さくらインターネット',
    '카카오엔터프라이즈',
    'Platform Team',
    'nuphos',
    '客戶成功部',
    'SRE',
    'Data Infra',
    'Growth',
    '雲端架構組',
  ]
  const used = new Set(names.map((n) => avatarGradient(n).name))

  assert.ok(used.size >= 6, `only ${used.size} distinct colours across ${names.length} teams`)
})

test('every swatch is reachable', () => {
  const used = new Set<string>()

  for (let i = 0; i < 4000; i++) used.add(avatarGradient(`team-${i}`).name)
  assert.equal(used.size, AVATAR_GRADIENTS.length)
})
