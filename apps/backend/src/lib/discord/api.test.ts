import { describe, expect, test } from 'bun:test'

import { NUPHOS_DISCORD_COMMAND, splitDiscordText } from './api'

describe('Nuphos Discord command', () => {
  test('allows members to use mode commands while handlers guard channel administration', () => {
    expect(NUPHOS_DISCORD_COMMAND.default_member_permissions).toBeNull()
    expect(NUPHOS_DISCORD_COMMAND.dm_permission).toBe(false)
    expect(NUPHOS_DISCORD_COMMAND.options.map((option) => option.name)).toEqual([
      'full-access',
      'auto',
      'enable',
      'disable',
    ])
  })
})

describe('splitDiscordText', () => {
  test('keeps short messages intact', () => {
    expect(splitDiscordText('hello')).toEqual(['hello'])
  })

  test('splits every message within Discord limit without losing text', () => {
    const input = Array.from({ length: 600 }, (_, index) => `word-${index}`).join(' ')
    const chunks = splitDiscordText(input)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
    expect(chunks.join('')).toBe(input)
  })

  test('does not emit an empty message', () => {
    expect(splitDiscordText('   ')).toEqual([])
  })

  test('closes and reopens fenced code blocks across Discord chunks', () => {
    const code = Array.from({ length: 300 }, (_, index) => `const value${index} = ${index}`).join(
      '\n',
    )
    const chunks = splitDiscordText(`Here is the result:\n\n\`\`\`ts\n${code}\n\`\`\``)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
    expect(chunks.every((chunk) => (chunk.match(/```/g)?.length ?? 0) % 2 === 0)).toBe(true)
    for (let index = 0; index < 300; index++) {
      expect(chunks.join('\n')).toContain(`const value${index} = ${index}`)
    }
  })

  test('respects the limit when boundary snapping excludes a closing fence', () => {
    const chunks = splitDiscordText(`\`\`\`txt\n${'a'.repeat(1986)}\n\`\`\` trailing text`)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
    expect(chunks.every((chunk) => (chunk.match(/```/g)?.length ?? 0) % 2 === 0)).toBe(true)
  })
})
