import { describe, expect, test } from 'bun:test'

import routeAccess from '@/routes/route-access.json'
import { toolModuleFromAiSdkTools } from '@/lib/claude-code-preview/preview-tools/ai-sdk-adapter'

import { ARTIFACT_MAX_CHARS, createArtifactTool } from './artifact-tool'

import type { PreviewToolContext } from '@/lib/claude-code-preview/preview-tool-context'

const ctx: PreviewToolContext = { userId: 'u', teamId: 't', sessionId: 's', locale: 'en' }
const page = '<!doctype html><html><body><h1>Hi</h1></body></html>'

function artifactModule() {
  const frames: Record<string, unknown>[] = []
  const module = toolModuleFromAiSdkTools(
    { render_artifact: createArtifactTool() },
    {
      publish: (_ctx, frame) => {
        frames.push(frame)

        return Promise.resolve()
      },
    },
  )

  return { frames, call: module.handlers(ctx).render_artifact! }
}

describe('render_artifact', () => {
  test('the card gets the whole artifact, the agent only a short receipt', async () => {
    const { frames, call } = artifactModule()
    const input = {
      label: 'Showing the launch page',
      artifactId: 'launch-page',
      title: 'Launch page',
      kind: 'html',
      content: page,
    }

    const result = await call(input)

    expect(frames[0]).toMatchObject({
      type: 'tool-input-available',
      toolName: 'render_artifact',
      input,
    })
    expect(result.structuredContent).toEqual({
      artifactId: 'launch-page',
      title: 'Launch page',
      kind: 'html',
      characters: page.length,
      shown: 'The artifact is open beside the chat.',
    })
    expect(JSON.stringify(result)).not.toContain('<h1>')
  })

  test('rejects ids that cannot name a version line', async () => {
    const { call } = artifactModule()

    for (const artifactId of ['Launch Page', '-page', 'a'.repeat(65), '']) {
      const result = await call({
        label: 'x',
        artifactId,
        title: 'T',
        kind: 'markdown',
        content: '# T',
      })

      expect(result.isError).toBe(true)
    }
  })

  test('rejects an unknown kind, empty content and oversized content', async () => {
    const { call } = artifactModule()
    const base = { label: 'x', artifactId: 'doc', title: 'Doc' }

    expect((await call({ ...base, kind: 'react', content: 'x' })).isError).toBe(true)
    expect((await call({ ...base, kind: 'markdown', content: '' })).isError).toBe(true)
    expect(
      (await call({ ...base, kind: 'markdown', content: 'x'.repeat(ARTIFACT_MAX_CHARS + 1) }))
        .isError,
    ).toBe(true)
  })
})

describe('artifacts are never served publicly', () => {
  // route-access.test.ts fails on any served route missing from this table, so
  // an empty match here means no artifact route exists, public or otherwise.
  test('no route serves an artifact', () => {
    expect(Object.keys(routeAccess).filter((route) => /artifact/i.test(route))).toEqual([])
  })
})
