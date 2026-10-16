// Break the pre-existing routes/agent constants ↔ run-pump-helpers init-order
// cycle the composer's imports would otherwise trip (same as the sibling
// preview tests).
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

import { buildPreviewSystemPrompt } from './preview-prompt'

import type { AgentDevice } from '@/lib/agent/devices/store'

const devices: Record<string, Partial<AgentDevice>> = {
  box: { label: 'Box 1', box: {} as AgentDevice['box'] },
  mac: { label: 'MacBook' },
}

useAgentDeviceStore({
  getAgentDevice: async (_userId, deviceId) => (devices[deviceId] ?? null) as AgentDevice | null,
})

describe('buildPreviewSystemPrompt', () => {
  test('routes Plan, architecture, and Dashboards through native skills', async () => {
    const prompt = await buildPreviewSystemPrompt({
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
      diagramId: 'diagram-1',
    })

    expect(prompt).toContain('installed in `.claude/skills`')
    expect(prompt).toContain('native `nuphos-plan` skill')
    expect(prompt).toContain('native `architecture-diagram` skill FIRST')
    expect(prompt).toContain('native `nuphos-dashboards` skill FIRST')
    expect(prompt).toContain('canonical Nuphos REST APIs')
    expect(prompt).toContain('through its API script')
    expect(prompt).not.toContain('bound cost_dashboard_')
    expect(prompt).not.toContain('call the skill tool with "architecture-diagram"')
    expect(prompt).toContain('accepted by the ordinary `/teams/...` APIs')
    expect(prompt).toContain('canonical `_links`/resource paths')
    expect(prompt).not.toContain('skill_load')
  })

  test('carries the shared sandbox rules and no Codex-only section', async () => {
    const prompt = await buildPreviewSystemPrompt({
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
    })

    expect(prompt).toContain('## Tool memory budgets')
    expect(prompt).toContain('2 GiB RLIMIT_DATA')
    expect(prompt).toContain('## Credential handling')
    expect(prompt).toContain('`~/.aws/credentials`')
    expect(prompt).toContain('## Memory scope')
    expect(prompt).toContain('always pass `scope` explicitly')
    expect(prompt).not.toContain('## Workspace')
    expect(prompt).not.toContain('This is the Codex runtime')
  })

  test('warns every runtime that background monitors do not survive it', async () => {
    const prompt = await buildPreviewSystemPrompt({
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
    })

    expect(prompt).toContain('## Background monitoring')
    expect(prompt).toContain('Nothing you leave running inside this process survives it')
    expect(prompt).toContain('Either finish the wait inside this turn')
    // write_stdin is Codex's tool; Claude Code has no such thing.
    expect(prompt).not.toContain('write_stdin')
  })
})

test('Codex receives native skill paths and its runtime identity', async () => {
  const prompt = await buildPreviewSystemPrompt({
    provider: 'codex',
    userId: 'user-1',
    teamId: 'team-1',
    sessionId: 'conv-1',
    locale: 'en',
  })

  expect(prompt).toContain('running as Codex')
  expect(prompt).toContain('installed in `.agents/skills`')
  expect(prompt).toContain('nuphos-credentials')
  expect(prompt).toContain('nuphos-plan')
  expect(prompt).not.toContain('Claude Code')
  expect(prompt).toContain('## Workspace')
  expect(prompt).toContain('This is the Codex runtime')
  expect(prompt).toContain('## Tool memory budgets')
  expect(prompt).toContain('## Credential handling')
  expect(prompt).toContain('## Memory scope')
  expect(prompt).toContain('## Background monitoring')
  expect(prompt).toContain('write_stdin')
})

test('keeps the assembled prompt well inside the runtime prompt budget', async () => {
  const prompt = await buildPreviewSystemPrompt({
    provider: 'codex',
    userId: 'user-1',
    teamId: 'team-1',
    sessionId: 'conv-1',
    locale: 'en',
  })

  expect(prompt.length).toBeLessThan(120_000)
})

describe.each(['claude-code', 'codex'] as const)('%s tooling description', (provider) => {
  const build = () =>
    buildPreviewSystemPrompt({
      provider,
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
    })

  test('describes one Kubernetes setup and no classic sandbox', async () => {
    const prompt = await build()

    expect(prompt).toContain('call `get_kubeconfig`')
    expect(prompt).not.toContain('NO setup step')
    expect(prompt).not.toContain('Never run a kubeconfig-loading script')
    expect(prompt).not.toContain('injected into KUBECONFIG')
    expect(prompt).not.toContain('pre-authenticated')
    expect(prompt).not.toContain('Skill registry (authoritative)')
    expect(prompt).not.toContain('classic Nuphos sandbox')
    expect(prompt).not.toContain('bash access')
  })

  test('states the Zeabur rule once, conditioned on an attached provider', async () => {
    const prompt = await build()

    expect(prompt).toContain('When no Zeabur provider is listed, do not use either of them.')
    expect(prompt).not.toContain('Do NOT use the `zeabur` CLI')
  })
})

for (const provider of ['claude-code', 'codex'] as const) {
  test(`${provider} distinguishes provider login from Nuphos participants`, async () => {
    const prompt = await buildPreviewSystemPrompt({
      provider,
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
    })

    expect(prompt).toContain('Provider-supplied userEmail')
    expect(prompt).toContain('NOT the Nuphos participant')
    expect(prompt).toContain('sender.email, when present, is the sender’s Nuphos account email')
  })
}

test('a computer’s own agent is told it runs there, not in the team sandbox', async () => {
  const on = (deviceId: string) =>
    buildPreviewSystemPrompt({
      userId: 'user-1',
      teamId: 'team-1',
      sessionId: 'conv-1',
      locale: 'en',
      provider: 'codex',
      runtimeId: localRuntimeId({ userId: 'user-1', deviceId, provider: 'codex' }),
    })
  const box = await on('box')

  expect(box).toContain('running as Codex on Box 1, the computer this conversation runs on')
  expect(box).toContain('the `nuphos-desktop` tools for this conversation’s own desktop')
  expect(box).toContain('open a browser or another app on it with their `launch_app`')
  expect(box).toContain("local_exec is for the user's other devices, only when they ask for one")
  expect(box).not.toContain('inside the team sandbox')
  expect(await on('mac')).not.toContain('nuphos-desktop')
  // A runtime that is not a computer's, or one gone from the registry, keeps the sandbox line.
  expect(await on('gone')).toContain('inside the team sandbox')
})
