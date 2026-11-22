import assert from 'node:assert/strict'
import { test } from 'node:test'

import { homeGreeting, splitForAnimation } from './textUtils.ts'

test('greets the user by the first word of their display name', () => {
  assert.equal(homeGreeting('Yuanlin Lin'), "What's up next, Yuanlin?")
  assert.equal(homeGreeting('  Ada  '), "What's up next, Ada?")
})

test('drops the name when there is none', () => {
  assert.equal(homeGreeting(undefined), "What's up next?")
  assert.equal(homeGreeting('   '), "What's up next?")
})

test('the home title animates whole words, so an email or hyphenated word stays in one piece (#4544)', () => {
  assert.deepEqual(splitForAnimation("What's up next, jamie.rivera-long@example-team.com?", 'en'), [
    "What's",
    ' ',
    'up',
    ' ',
    'next,',
    ' ',
    'jamie.rivera-long@example-team.com?',
  ])
  assert.deepEqual(splitForAnimation('well-known', 'fr-FR'), ['well-known'])
})

test('the home title animates CJK per character', () => {
  assert.deepEqual(splitForAnimation('接下來做什麼？', 'zh-TW'), [
    '接',
    '下',
    '來',
    '做',
    '什',
    '麼',
    '？',
  ])
  assert.deepEqual(splitForAnimation('次は何？', 'ja'), ['次', 'は', '何', '？'])
  assert.deepEqual(splitForAnimation('👩‍💻 OK', 'ko'), ['👩‍💻', ' ', 'O', 'K'])
})

test('the home title pieces join back to the title', () => {
  for (const title of [
    '',
    ' ',
    '  leading and trailing  ',
    'many   spaces',
    'tab\tand\nnewline',
    'Nuphos 幫你 ship',
    'family 👨‍👩‍👧 here',
    'مرحبا بك',
  ]) {
    for (const lang of ['en', 'zh-TW', 'ar']) {
      assert.equal(
        splitForAnimation(title, lang).join(''),
        title,
        `${lang}: ${JSON.stringify(title)}`,
      )
    }
  }
})
