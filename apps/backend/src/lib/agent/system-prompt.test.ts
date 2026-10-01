import { describe, expect, it } from 'bun:test'

import { getSystemPrompt, renderPromptTemplate } from './system-prompt'

describe('renderPromptTemplate', () => {
  it('renders provided variables and empties unknown placeholders', () => {
    const out = renderPromptTemplate('test.md', 'Budget {{max_output_tokens}} tokens{{unknown}}.', {
      max_output_tokens: 32000,
    })

    expect(out).toBe('Budget 32000 tokens.')
  })

  it('is not fooled by the variable name appearing as prose', () => {
    // The regression this guards: the prompt text mentions the variable in
    // prose but the {{placeholder}} itself is gone, so the model never sees
    // its output budget. renderPromptTemplate logs an error in that case —
    // here we only assert the render itself leaves prose intact.
    const out = renderPromptTemplate(
      'test.md',
      'Respect max_output_tokens at all times.',
      { max_output_tokens: 32000 },
      ['max_output_tokens'],
    )

    expect(out).toBe('Respect max_output_tokens at all times.')
  })
})

describe('vendored prompt files', () => {
  it('system prompt renders with its load-bearing placeholders', async () => {
    const resolved = await getSystemPrompt('en', { max_output_tokens: 32000 })

    expect(resolved.source).toBe('repo')
    expect(resolved.prompt).toContain('32000')
    expect(resolved.prompt).not.toContain('{{max_output_tokens}}')
    expect(resolved.prompt.length).toBeGreaterThan(1000)
  })
})
