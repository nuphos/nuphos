import assert from 'node:assert/strict'
import test from 'node:test'

import { starterGreeting } from './starter-greeting.ts'

const LOCALES = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'th', 'id', 'es']
const INVITES: [string, readonly string[]][] = [
  ['no tool', []],
  ['only Linear', ['Linear']],
  ['other tools', ['GitHub', 'Notion']],
]
// Box, gift and trial credit, in every language the greeting speaks.
const BOX_WORDS =
  /\bBox\b|trial|credit|送你|試用|额度|額度|试用|試用クレジット|お試し|체험|크레딧|ทดลอง|เครดิต|uji coba|kredit|prueba|crédito/i

for (const [invite, tools] of INVITES) {
  test(`a Bot on the free computer keeps the Box wording (${invite})`, () => {
    const text = starterGreeting('en', tools, 'opencode')

    assert.match(text, /^Welcome! This is your first Box/)
    assert.match(text, /This Box is yours to try for now/)
    if (tools.length) assert.match(text, /trial credit/)
    else assert.match(text, /What would you like to try first\?$/)
  })

  for (const [agentRuntime, name] of [
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
  ]) {
    test(`a Bot on this computer's ${name} never mentions a Box or trial (${invite})`, () => {
      for (const locale of LOCALES) {
        const text = starterGreeting(locale, tools, agentRuntime)

        assert.doesNotMatch(text, BOX_WORDS, `${locale}: ${text}`)
        assert.ok(text.includes(name), `${locale} names ${name}`)
        assert.equal(text.split('\n\n').length, 3, `${locale} has three paragraphs`)
        for (const tool of tools) assert.ok(text.includes(tool), `${locale} names ${tool}`)
      }
    })
  }
}

test('the own-computer wording is the agreed English and Traditional Chinese', () => {
  assert.equal(
    starterGreeting('en', ['Linear'], 'codex'),
    [
      'Welcome! I’m your first Bot. I work in Codex on this computer, signed in with your own account, so you can give me a small task and see what a Bot can do.',
      'What I do uses your own Codex plan, just like when you use it yourself. This computer needs to be on and online for me to reply.',
      'You picked Linear. Click Connect Linear below, and I’ll take a look at what’s on your to-do list.',
    ].join('\n\n'),
  )
  assert.equal(
    starterGreeting('zh-TW', ['GitHub', 'Notion'], 'claude-code'),
    [
      '歡迎！我是你的第一個 Bot，在這台電腦的 Claude Code 上工作，用的是你自己的帳號。你可以先交給我一件小事，看看 Bot 能怎麼幫你。',
      '我做的事會用到你自己的 Claude Code 方案，跟你平常自己用一樣。這台電腦要開著、連上網路，我才能回覆你。',
      '你剛才選了GitHub、Notion。選下方想連接的工具，我們就能一起跑一個小任務。',
    ].join('\n\n'),
  )
})

test('an unknown locale falls back to English', () => {
  assert.match(starterGreeting('fr', [], 'codex'), /^Welcome! I’m your first Bot/)
})
