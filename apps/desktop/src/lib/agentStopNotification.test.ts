import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAgentStopNotification,
  finalAssistantText,
  pendingApprovalTool,
  stripMarkdown,
} from './agentStopNotification.ts'

import type { StopNotificationMessage, StopNotificationPart } from './agentStopNotification.ts'

const text = (t: string): StopNotificationPart => ({ type: 'text', text: t })
const tool = (toolName: string, state = 'output-available'): StopNotificationPart => ({
  type: 'tool',
  toolName,
  state,
})
const assistant = (...parts: StopNotificationPart[]): StopNotificationMessage => ({
  role: 'assistant',
  parts,
})
const user = (t: string): StopNotificationMessage => ({ role: 'user', parts: [text(t)] })

test('the final text is what follows the last tool call, not the narration before it', () => {
  const messages = [
    user('how many pods?'),
    assistant(
      text('Let me check the cluster.'),
      tool('bash'),
      { type: 'step-start' },
      text('There are 12 pods'),
      text(' running.'),
    ),
  ]

  assert.equal(finalAssistantText(messages), 'There are 12 pods running.')
})

test('a thinking block also bounds the answer', () => {
  const messages = [
    assistant(text('early narration'), { type: 'reasoning', text: 'hmm' }, text('The answer.')),
  ]

  assert.equal(finalAssistantText(messages), 'The answer.')
})

test('trailing chips after the answer are skipped, not treated as a boundary', () => {
  const messages = [
    assistant(text('Done.'), { type: 'memory-ingest' }, { type: 'memory-provenance' }),
  ]

  assert.equal(finalAssistantText(messages), 'Done.')
})

test('a turn that ends on a tool call has no final text', () => {
  assert.equal(finalAssistantText([assistant(text('Running it.'), tool('bash'))]), '')
})

test('markdown is flattened for the notification body', () => {
  assert.equal(
    finalAssistantText([assistant(text('## Done\n\n- **12** pods in `prod`'))]),
    'Done 12 pods in prod',
  )
})

test('a completed turn shows the answer', () => {
  assert.deepEqual(
    buildAgentStopNotification({
      outcome: { kind: 'finished' },
      title: 'Cluster check',
      messages: [assistant(tool('bash'), text('There are 12 pods running.'))],
    }),
    { title: 'Cluster check', body: 'There are 12 pods running.' },
  )
})

test('an untitled conversation falls back to the app name', () => {
  assert.equal(
    buildAgentStopNotification({
      outcome: { kind: 'finished' },
      title: '   ',
      messages: [assistant(text('hi'))],
    }).title,
    'Nuphos',
  )
})

test('a turn parked on an approval gate leads with what it is waiting for', () => {
  assert.equal(
    buildAgentStopNotification({
      outcome: { kind: 'finished' },
      messages: [
        assistant(text('I need to restart the deployment.'), tool('bash', 'approval-requested')),
      ],
    }).body,
    'Waiting for your approval: bash\nI need to restart the deployment.',
  )
})

test('an approval gate with no preamble still says why it stopped', () => {
  assert.equal(
    buildAgentStopNotification({
      outcome: { kind: 'finished' },
      messages: [assistant(tool('local_exec', 'approval-requested'))],
    }).body,
    'Waiting for your approval: local_exec',
  )
})

test('a resolved approval is not reported as pending', () => {
  assert.equal(
    pendingApprovalTool([assistant(tool('bash', 'approval-responded'), text('Restarted.'))]),
    null,
  )
})

test('a failure reports the cause without its telemetry context line', () => {
  assert.equal(
    buildAgentStopNotification({
      outcome: {
        kind: 'failed',
        cause:
          'The model went silent for 90s while streaming a tool call. (gave up after 3 continuation(s).)\ncontext=phase=renderer_auto_resume_exhausted streamId=abc',
      },
      messages: [assistant(text('partial'))],
    }).body,
    'The model went silent for 90s while streaming a tool call. (gave up after 3 continuation(s).)',
  )
})

test('a failure never falls back to the assistant text', () => {
  assert.equal(
    buildAgentStopNotification({
      outcome: { kind: 'failed', cause: '   ' },
      messages: [assistant(text('a half-written answer'))],
    }).body,
    'The agent stopped with an error.',
  )
})

test('a finish with nothing to show says so instead of going silent', () => {
  assert.equal(
    buildAgentStopNotification({ outcome: { kind: 'finished' }, messages: [user('hi')] }).body,
    'The agent finished without a text response.',
  )
})

test('a run whose conversation was closed names the conversation and points back to it', () => {
  assert.deepEqual(
    buildAgentStopNotification({
      outcome: { kind: 'ended-while-closed' },
      title: 'Cluster check',
    }),
    {
      title: 'Cluster check',
      body: 'The agent stopped while this conversation was closed — open it to see what happened.',
    },
  )
})

test('long bodies are truncated without splitting an emoji', () => {
  const body = buildAgentStopNotification({
    outcome: { kind: 'finished' },
    messages: [assistant(text('🚀'.repeat(300)))],
  }).body

  assert.equal([...body].length, 201)
  assert.ok(body.endsWith('🚀…'))
})

test('stripMarkdown collapses fenced code to a marker', () => {
  assert.equal(stripMarkdown('Run:\n```sh\nkubectl get pods\n```\ndone'), 'Run: [code] done')
})
