import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  nuphosDescribeDefaultEffort,
  patchClaudeDefaultEffort,
} from '../image/claude-agent-acp/default-effort.mjs'

const options = (currentValue) => [
  {
    id: 'effort',
    category: 'thought_level',
    currentValue,
    options: ['default', 'low', 'medium', 'high'].map((value) => ({ value, name: value })),
  },
]
const query = (effort) => ({ getSettings: async () => ({ applied: { effort } }) })

test('the default choice names the level Claude Code will send', async () => {
  const config = options('default')

  await nuphosDescribeDefaultEffort(query('medium'), config)
  assert.equal(config[0].options[0].description, 'medium')
})

test('a pinned level, an unknown level or an old CLI leaves the choice alone', async () => {
  for (const [config, q] of [
    [options('high'), query('high')],
    [options('default'), query('ultra')],
    [options('default'), { getSettings: async () => Promise.reject(new Error('unsupported')) }],
  ]) {
    await nuphosDescribeDefaultEffort(q, config)
    assert.equal(config[0].options[0].description, undefined)
  }
})

test('the patch lands once at session creation and once after a config change', () => {
  const source = [
    '            const configOptions = buildConfigOptions(modes, models, modelInfos, settingsEffortForModel(settingsManager.getSettings(), currentModelInfo), agents, currentAgent, fastMode);',
    '            return configOptions;',
    '                session.effortPinnedByUser = value !== "default";',
    '            }',
    '        }',
    '    }',
    '',
  ].join('\n')
  const patched = patchClaudeDefaultEffort(source)

  assert.equal(patched.split('await nuphosDescribeDefaultEffort(').length - 1, 2)
  assert.match(patched, /fastMode\);\n {12}await nuphosDescribeDefaultEffort\(q, configOptions\);/)
  assert.match(
    patched,
    /\n {8}await nuphosDescribeDefaultEffort\(session\.query, session\.configOptions\);\n {4}\}\n$/,
  )
  assert.throws(() => patchClaudeDefaultEffort('nothing to patch'))
})
