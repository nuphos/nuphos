import assert from 'node:assert/strict'
import test from 'node:test'

import {
  matchSlashCommands,
  matchSlashOptions,
  slashEnterTarget,
  slashKeyAction,
  slashShownRow,
  slashStep,
  slashToken,
} from './composerSlashCommands.ts'

import type { SlashOption } from './composerSlashCommands.ts'

const run = () => null
const commands = [
  { id: 'new', title: 'New agent', description: '', run },
  { id: 'fork', title: 'Fork agent', description: '', run },
  { id: 'model', title: 'Model', description: '', run },
]

test('a slash opens the menu at the start of the message or after a space', () => {
  assert.deepEqual(slashToken('/', '', '/'), { query: '', start: 0, leading: true })
  assert.deepEqual(slashToken('/fo', '', '/fo'), { query: 'fo', start: 0, leading: true })
  // Later in the message: only the agent's commands are offered.
  assert.deepEqual(slashToken('also use /je', '', 'also use /je'), {
    query: 'je',
    start: 9,
    leading: false,
  })
  assert.deepEqual(slashToken('/fo', ' and more', '/fo and more'), {
    query: 'fo',
    start: 0,
    leading: false,
  })
  assert.equal(slashToken('/a b', '', '/a b'), null)
  assert.equal(slashToken('see/fo', '', 'see/fo'), null)
  assert.equal(slashToken('a/b/c', '', 'a/b/c'), null)
  assert.equal(slashToken('/usr/lo', '', '/usr/lo'), null)
  // The caret must be at the end of the word.
  assert.equal(slashToken('/fo', 'o', '/foo'), null)
})

test('commands match by id prefix or title', () => {
  assert.deepEqual(
    matchSlashCommands(commands, 'agent').map((command) => command.id),
    ['new', 'fork'],
  )
  assert.deepEqual(
    matchSlashCommands(commands, 'mo').map((command) => command.id),
    ['model'],
  )
  assert.equal(matchSlashCommands(commands, '').length, 3)
})

test('Enter selects only when there is a row for it; Tab and the arrows work the menu', () => {
  assert.equal(slashKeyAction('Enter', false, false), null)
  assert.equal(slashKeyAction('Enter', false, true), 'enter')
  assert.equal(slashKeyAction('Enter', true, true), null)
  assert.equal(slashKeyAction('Tab', false, false), 'select')
  assert.equal(slashKeyAction('ArrowDown', false, false), 'next')
  assert.equal(slashKeyAction('ArrowUp', false, false), 'previous')
  assert.equal(slashKeyAction('Escape', false, false), 'dismiss')
})

const agent = [
  { name: 'review', description: 'Review the diff', hint: 'branch' },
  { name: 'compact', description: 'Compact the context' },
  { name: 'model', description: "The agent's own model command" },
]

test("the agent's commands come first, matched by name, then Nuphos actions", () => {
  assert.deepEqual(
    matchSlashOptions(agent, commands, 'mo').map((option) =>
      option.kind === 'agent' ? `agent:${option.command.name}` : `nuphos:${option.action.id}`,
    ),
    ['agent:model', 'nuphos:model'],
  )
  assert.equal(matchSlashOptions(agent, commands, '').length, agent.length + commands.length)
  assert.equal(matchSlashOptions([], commands, 'f')[0]?.kind, 'nuphos')
})

function label(option: SlashOption | null) {
  if (option === null) return null

  return option.kind === 'agent' ? `agent:${option.command.name}` : `nuphos:${option.action.id}`
}

test("the agent's commands are listed A to Z", () => {
  const skills = [
    { name: 'review', description: '' },
    { name: 'Jeun', description: '' },
    { name: 'browse', description: '' },
    { name: 'jeun-deploy', description: '' },
  ]

  assert.deepEqual(matchSlashOptions(skills, [], '').map(label), [
    'agent:browse',
    'agent:Jeun',
    'agent:jeun-deploy',
    'agent:review',
  ])
  assert.deepEqual(matchSlashOptions(skills, [], 'je').map(label), [
    'agent:Jeun',
    'agent:jeun-deploy',
  ])
})

test('mid-message, the menu offers only the agent commands', () => {
  assert.deepEqual(matchSlashOptions(agent, commands, 'mo', false).map(label), ['agent:model'])
  assert.deepEqual(matchSlashOptions([], commands, 'f', false), [])
})

test('/je + Enter completes the first command instead of sending', () => {
  const options = matchSlashOptions([{ name: 'jeun', description: '' }], commands, 'je')

  assert.equal(label(slashEnterTarget(options, 'je', { active: -1, armed: false })), 'agent:jeun')
})

test('Enter completes the row the pointer highlights, if it is an agent command', () => {
  const options = matchSlashOptions(
    [
      { name: 'jeun', description: '' },
      { name: 'jest', description: '' },
    ],
    [],
    'je',
  )

  assert.equal(label(slashEnterTarget(options, 'je', { active: 1, armed: false })), 'agent:jeun')
})

test('a command typed out in full is sent as it is', () => {
  const options = matchSlashOptions(agent, commands, 'model')

  assert.equal(slashEnterTarget(options, 'model', { active: -1, armed: false }), null)
  assert.equal(slashEnterTarget(options, 'MODEL', { active: -1, armed: false }), null)
})

test('a command typed out in full is sent even when a longer one sorts first', () => {
  const skills = [
    { name: 'review', description: '' },
    { name: 'review-pr', description: '' },
  ]
  const options = matchSlashOptions(skills, [], 'review', true, { 'review-pr': 5 })

  assert.deepEqual(options.map(label), ['agent:review-pr', 'agent:review'])
  assert.equal(slashEnterTarget(options, 'review', { active: -1, armed: false }), null)
  assert.equal(slashEnterTarget(options, 'Review', { active: -1, armed: false }), null)
  // A pointer resting on the longer one does not rewrite it either.
  assert.equal(slashEnterTarget(options, 'review', { active: 0, armed: false }), null)
  // The arrows still pick it.
  assert.equal(
    label(slashEnterTarget(options, 'review', { active: 0, armed: true })),
    'agent:review-pr',
  )
})

test('the first ↓ moves off the row shown highlighted', () => {
  const options = matchSlashOptions(
    [
      { name: 'debug', description: '' },
      { name: 'deploy', description: '' },
      { name: 'docs', description: '' },
    ],
    [],
    'd',
  )
  const target = slashEnterTarget(options, 'd', { active: -1, armed: false })
  const shown = slashShownRow(options, -1, target)

  assert.equal(shown, 0)
  assert.equal(slashStep(shown, 1, options.length), 1)
  assert.equal(slashStep(shown, -1, options.length), 2)
  // Nothing highlighted: ↓ goes to the first row, ↑ to the last.
  assert.equal(slashShownRow(options, -1, null), -1)
  assert.equal(slashStep(-1, 1, options.length), 0)
  assert.equal(slashStep(-1, -1, options.length), 2)
  assert.equal(slashStep(2, 1, options.length), 0)
})

test('/model + Enter never runs a Nuphos action unless the arrows picked it', () => {
  const options = matchSlashOptions([], commands, 'mo')

  assert.equal(slashEnterTarget(options, 'mo', { active: -1, armed: false }), null)
  assert.equal(slashEnterTarget(options, 'mo', { active: 0, armed: false }), null)
  assert.equal(label(slashEnterTarget(options, 'mo', { active: 0, armed: true })), 'nuphos:model')
})

test('/fork + Enter runs the Fork action instead of sending "/fork" to the agent', () => {
  const skills = [{ name: 'forklift', description: '' }]

  assert.equal(
    label(
      slashEnterTarget(matchSlashOptions([], commands, 'fork'), 'fork', {
        active: -1,
        armed: false,
      }),
    ),
    'nuphos:fork',
  )
  // Typed in full, it wins over a longer agent command sorted first.
  assert.equal(
    label(
      slashEnterTarget(matchSlashOptions(skills, commands, 'fork'), 'fork', {
        active: -1,
        armed: false,
      }),
    ),
    'nuphos:fork',
  )
  // An agent command with the same name is still the agent's.
  const same = matchSlashOptions([{ name: 'fork', description: '' }], commands, 'fork')

  assert.equal(slashEnterTarget(same, 'fork', { active: -1, armed: false }), null)
})

test('the most used commands come first, then A to Z', () => {
  const skills = [
    { name: 'review', description: '' },
    { name: 'deploy', description: '' },
    { name: 'debug', description: '' },
    { name: 'docs', description: '' },
  ]
  const usage = { review: 9, docs: 2 }

  assert.deepEqual(matchSlashOptions(skills, [], '', true, usage).map(label), [
    'agent:review',
    'agent:docs',
    'agent:debug',
    'agent:deploy',
  ])
  assert.deepEqual(matchSlashOptions(skills, [], 'de', true, usage).map(label), [
    'agent:debug',
    'agent:deploy',
  ])
})
