import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decisionRequestId,
  CONNECT_SELECTION_KEY,
  connectBlock,
  connectRowStatus,
  newConnectIds,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
  secretFieldsSavedReply,
  secretSavedReply,
  personalConnectStatus,
  withConnectIds,
} from './connectCardModel.ts'
import { questionPart } from './openQuestionParts.ts'
import { requestQuestion } from './replyTarget.ts'

import type { AgentCredentialSelection } from '../../../api'

function selection(partial: Partial<AgentCredentialSelection> = {}): AgentCredentialSelection {
  const empty = Object.fromEntries(
    [...Object.values(CONNECT_SELECTION_KEY), 'deviceIds'].map((key) => [key, []]),
  ) as unknown as AgentCredentialSelection

  return { ...empty, ...partial }
}

test('parseConnectRequest reads an integration decision and keeps known providers once', () => {
  assert.deepEqual(
    parseConnectRequest({
      category: 'integration',
      question: 'why',
      providers: ['linear', 'slack', 'linear', 'grafana'],
    }),
    { providers: ['linear', 'grafana'], reason: 'why', personal: false },
  )
  assert.equal(parseConnectRequest({ category: 'integration', providers: ['slack'] }), null)
  // Any other decision stays a plain question, even with providers.
  assert.equal(parseConnectRequest({ category: 'approval', providers: ['linear'] }), null)
  assert.equal(parseConnectRequest(undefined), null)
})

const ownGithub = [{ provider: 'personal' as const, id: 'github' as const }]

test("a request for the member's own credential is a personal Connect card; naming both is none", () => {
  assert.deepEqual(
    parseConnectRequest({ category: 'integration', question: 'why', credentials: ownGithub }),
    { providers: ['github'], reason: 'why', personal: true },
  )
  // What answers a request naming any access and the own credential at once is unclear.
  assert.equal(
    parseConnectRequest({
      category: 'integration',
      providers: ['github'],
      credentials: ownGithub,
    }),
    null,
  )
  assert.equal(
    parseConnectRequest({
      category: 'integration',
      credentials: [{ provider: 'github', id: '166381069' }],
    }),
    null,
  )
})

test("a personal row is selected only by the member's own credential, never a team binding", () => {
  const own = [{ provider: 'github' }]

  assert.equal(
    personalConnectStatus('github', selection({ githubInstallationIds: ['i1'] }), own),
    'available',
  )
  assert.equal(
    personalConnectStatus('github', selection({ personalCredentialIds: ['github'] }), own),
    'connected',
  )
  // Another provider's own credential does not select this one.
  assert.equal(
    personalConnectStatus('github', selection({ personalCredentialIds: ['linear'] }), own),
    'available',
  )
  // Not connected yet: nothing here can bind it.
  assert.equal(personalConnectStatus('linear', selection(), own), 'idle')
})

test("the Inbox and a Bot's chat draw a personal request from its record as the same card", () => {
  const part = questionPart(
    requestQuestion({
      id: 'q1',
      question: 'Select your own GitHub',
      category: 'integration',
      credentials: ownGithub,
    }),
  )

  assert.deepEqual(parseConnectRequest(part.input), {
    providers: ['github'],
    reason: 'Select your own GitHub',
    personal: true,
  })
})

test('parseChoiceRequest reads any other decision, with its options as replies', () => {
  assert.deepEqual(
    parseChoiceRequest({
      category: 'approval',
      question: ' Start it? ',
      options: ['Yes', '', 2, 'No'],
    }),
    { category: 'approval', question: 'Start it?', options: ['Yes', 'No'] },
  )
  assert.deepEqual(parseChoiceRequest({ category: 'preference', question: 'Which?' }), {
    category: 'preference',
    question: 'Which?',
    options: [],
  })
  // An integration decision with known providers is a Connect card instead.
  assert.equal(
    parseChoiceRequest({ category: 'integration', question: 'why', providers: ['linear'] }),
    null,
  )
  assert.equal(parseChoiceRequest({ category: 'approval', question: '  ' }), null)
  assert.equal(parseChoiceRequest(undefined), null)
})

test('a row is connected only when a bound credential of that provider is selected', () => {
  const available = selection({ linearWorkspaceIds: ['w1'] })

  assert.equal(
    connectRowStatus('linear', 'idle', selection({ linearWorkspaceIds: ['w1'] }), available),
    'connected',
  )
  // Bound to the team but not ticked for this chat.
  assert.equal(connectRowStatus('linear', 'idle', selection(), available), 'available')
  assert.equal(connectRowStatus('linear', 'cancelled', selection(), available), 'cancelled')
  assert.equal(connectRowStatus('grafana', 'idle', selection(), available), 'idle')
  // Several bound: one click must not select them all, so the user picks one.
  assert.equal(
    connectRowStatus('aws', 'idle', selection(), selection({ awsRoleIds: ['admin', 'read'] })),
    'choose',
  )
  // A stale selected id that no longer exists does not count.
  assert.equal(
    connectRowStatus('grafana', 'error', selection({ grafanaInstanceIds: ['gone'] }), available),
    'error',
  )
})

test('newConnectIds finds what a bind added, and withConnectIds selects it once', () => {
  const before = selection({ grafanaInstanceIds: ['g1'] })
  const after = selection({ grafanaInstanceIds: ['g1', 'g2'], linearWorkspaceIds: ['w1'] })
  const added = newConnectIds('grafana', before, after)

  assert.deepEqual(added, ['g2'])
  assert.deepEqual(
    withConnectIds(selection({ grafanaInstanceIds: ['g2'] }), 'grafana', added).grafanaInstanceIds,
    ['g2'],
  )
})

test('parseSecretRequest reads a credential decision that names a secret', () => {
  const input = {
    category: 'credential',
    question: 'Calling the API needs your OpenAI key.',
    secretName: 'OPENAI_API_KEY',
  }

  assert.deepEqual(parseSecretRequest(input), {
    name: 'OPENAI_API_KEY',
    reason: 'Calling the API needs your OpenAI key.',
  })
  // Its question card gives way to the secure input card.
  assert.equal(parseChoiceRequest(input), null)
  assert.equal(parseSecretRequest({ ...input, category: 'approval' }), null)
  assert.equal(parseSecretRequest({ ...input, secretName: '../etc/passwd' }), null)
})

test("parseSecretRequest reads a form's fields and site, and falls back to the one secret", () => {
  const input = {
    category: 'credential',
    question: 'Looking up your appointment needs these details.',
    secretName: 'CLINIC_LOOKUP',
    fields: [
      { name: 'NATIONAL_ID', label: ' National ID number ' },
      { name: 'BIRTH_DATE', label: 'Date of birth (YYYY-MM-DD)' },
    ],
    site: 'www.clinic.example',
  }
  const single = { name: 'CLINIC_LOOKUP', reason: input.question }

  assert.deepEqual(parseSecretRequest(input), {
    ...single,
    fields: [
      { name: 'NATIONAL_ID', label: 'National ID number' },
      { name: 'BIRTH_DATE', label: 'Date of birth (YYYY-MM-DD)' },
    ],
    site: 'www.clinic.example',
  })
  // It is never a question card: the details are not typed as an ordinary answer.
  assert.equal(parseChoiceRequest(input), null)
  // Fields or a site it cannot trust leave the one masked input, never a looser card.
  for (const patch of [
    { site: undefined },
    { site: 'https://www.clinic.example/lookup' },
    { site: 'clinic' },
    { site: 'WWW.Clinic.Example' },
    { site: 'www.clinic.example:0' },
    { fields: [] },
    { fields: [{ name: '../x', label: 'ID' }] },
    { fields: [{ name: 'ID', label: ' ' }] },
    { fields: [input.fields[0], input.fields[0]] },
    { fields: Array.from({ length: 7 }, (_, i) => ({ name: `F${String(i)}`, label: 'x' })) },
  ])
    assert.deepEqual(parseSecretRequest({ ...input, ...patch }), single)
  // A port is part of the site, as it is part of the page's origin.
  assert.equal(parseSecretRequest({ ...input, site: 'localhost:5199' })?.site, 'localhost:5199')
  // Without a secretName there is no secure card at all.
  assert.equal(parseSecretRequest({ ...input, secretName: undefined }), null)
})

test('a card with several fields replies as a saved secret, one file per field', () => {
  const reply = secretFieldsSavedReply('CLINIC_LOOKUP', [
    { name: 'NATIONAL_ID', path: '/runtime/nuphos-secret-a/0/NATIONAL_ID' },
    { name: 'BIRTH_DATE', path: '/runtime/nuphos-secret-b/0/BIRTH_DATE' },
  ])

  // Every client reads a reply that opens this way as the request's saved answer.
  assert.ok(reply.startsWith(secretSavedReply('CLINIC_LOOKUP')))
  assert.deepEqual(reply.split('\n').slice(1), [
    'NATIONAL_ID: /runtime/nuphos-secret-a/0/NATIONAL_ID',
    'BIRTH_DATE: /runtime/nuphos-secret-b/0/BIRTH_DATE',
  ])
})

test('an open request keeps its fields and site for the card drawn from the record', () => {
  const fields = [{ name: 'NATIONAL_ID', label: 'National ID number' }]
  const question = requestQuestion({
    id: 'req-1',
    category: 'credential',
    question: 'Needed for the lookup.',
    secretName: 'CLINIC_LOOKUP',
    fields,
    site: 'www.clinic.example',
  })

  assert.deepEqual(parseSecretRequest(questionPart(question).input), {
    name: 'CLINIC_LOOKUP',
    reason: 'Needed for the lookup.',
    fields,
    site: 'www.clinic.example',
  })
})

test('decisionRequestId reads the request a tool result names, also from text', () => {
  assert.equal(decisionRequestId({ ok: true, requestId: 'req-1' }), 'req-1')
  assert.equal(
    decisionRequestId({ content: [{ type: 'text', text: '{"ok":true,"requestId":"req-2"}' }] }),
    'req-2',
  )
  assert.equal(decisionRequestId('{"requestId": "req-3"}'), 'req-3')
  assert.equal(decisionRequestId({ ok: true }), undefined)
  assert.equal(decisionRequestId(undefined), undefined)
})

test('a member who cannot bind a connector is told who can, so nobody reinstalls an App', () => {
  // Binding a team's connector takes an administrator: the Connect button must not open GitHub.
  assert.deepEqual(connectBlock('github', true), undefined)
  assert.match(connectBlock('github', false)?.label ?? '', /admin/i)
  // Only GitHub's flow is an App install; GitLab's is OAuth, like the rest.
  assert.match(connectBlock('gitlab', false)?.label ?? '', /connect/i)
  assert.match(connectBlock('aws', false)?.label ?? '', /connect/i)
})

test('a bound credential stays usable for a member: only Connect is blocked', () => {
  // Selecting what the team already bound is not a bind, so `available` keeps its
  // "Use in task" — the block applies where Connect itself would be offered.
  const available = selection({ grafanaInstanceIds: ['g1'] })
  const status = connectRowStatus('grafana', 'idle', selection(), available)

  assert.equal(status, 'available')
  assert.equal(connectRowStatus('grafana', 'idle', selection(), selection()), 'idle')
})
