import { describe, expect, test } from 'bun:test'

import { nativeSkillFiles } from './native-skills'

describe('nativeSkillFiles', () => {
  test('pins the OpenAB Claude Code defaults', async () => {
    const settings = (await Bun.file(
      new URL('../agent/builtin-skills/skills/_runtime/settings.json', import.meta.url),
    ).json()) as Record<string, unknown>

    expect(settings).toMatchObject({
      outputStyle: 'Concise',
      fastMode: true,
      disableArtifact: true,
    })
    expect(settings).not.toHaveProperty('model')
  })

  test('materializes merged skills while omitting reserved plan', () => {
    const files = nativeSkillFiles([
      { relPath: 'plan/SKILL.md', content: Buffer.from('# reserved') },
      { relPath: 'nuphos-api/SKILL.md', content: Buffer.from('# unified api') },
      {
        relPath: 'nuphos-api/scripts/openapi.sh',
        content: Buffer.from('#!/bin/sh'),
      },
      { relPath: 'architecture-diagram/SKILL.md', content: Buffer.from('# architecture') },
      { relPath: 'nuphos-dashboards/SKILL.md', content: Buffer.from('# dashboards') },
      { relPath: 'demo/SKILL.md', content: Buffer.from('# demo') },
      { relPath: '_runtime/settings.json', content: Buffer.from('{}') },
      {
        relPath: '_runtime/scripts/oom-hint.sh',
        content: Buffer.from('#!/bin/sh'),
      },
    ])

    expect(new Set(files.map((file) => file.path))).toEqual(
      new Set([
        '_runtime/scripts/oom-hint.sh',
        '_runtime/settings.json',
        'architecture-diagram/SKILL.md',
        'nuphos-dashboards/SKILL.md',
        'demo/SKILL.md',
        'nuphos-api/SKILL.md',
        'nuphos-api/scripts/openapi.sh',
      ]),
    )
    expect(files.find((file) => file.path.endsWith('openapi.sh'))?.executable).toBe(true)
    expect(
      Buffer.from(
        files.find((file) => file.path.endsWith('demo/SKILL.md'))!.contentBase64,
        'base64',
      ).toString(),
    ).toBe('# demo')
    expect(files.find((file) => file.path.endsWith('oom-hint.sh'))?.executable).toBe(true)
  })
})
