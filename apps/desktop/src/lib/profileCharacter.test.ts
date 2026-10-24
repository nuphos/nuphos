import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PROFILE_CHARACTERS,
  characterForLook,
  profileCharacterLabel,
  profileCharacterSrc,
} from './profileCharacter.ts'

test('every character ships one body and two eyes so the shared idle loop moves it', () => {
  for (const character of PROFILE_CHARACTERS) {
    const svg = readFileSync(
      new URL(`../../public${profileCharacterSrc(character)}`, import.meta.url),
      'utf8',
    )

    assert.equal(svg.match(/<g class="bot-body">/g)?.length, 1, character)
    assert.equal(svg.match(/<g class="bot-eye">/g)?.length, 2, character)
    assert.doesNotMatch(svg, /<style/, `${character} stays still until the app animates it`)
  }
})

test('six characters, three hairstyles per look, and switching look keeps the slot', () => {
  assert.equal(PROFILE_CHARACTERS.length, 6)
  assert.equal(characterForLook('girl'), 'girl-waves')
  assert.equal(characterForLook('girl', 'boy-curly'), 'girl-pony')
  assert.equal(characterForLook('boy', 'girl-bangs'), 'boy-side')
  assert.equal(characterForLook('boy', 'boy-side'), 'boy-side')
  assert.equal(profileCharacterLabel('girl-pony'), 'Girl, ponytail')
})
