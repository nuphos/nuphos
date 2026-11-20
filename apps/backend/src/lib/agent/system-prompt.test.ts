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

  // Every Bot loads this prompt, so it must not cast the agent as only a
  // coding/ops assistant: the Bot's own role comes first, and research work
  // gets its own rules.
  it('defers to the Bot identity and carries the research rules', async () => {
    const { prompt } = await getSystemPrompt('en')

    expect(prompt).toContain('its identity block (`<nuphos_bot_identity>`) sets your role')
    expect(prompt).toContain('# Research and reports')
    expect(prompt).toContain('Never make up numbers.')
    expect(prompt).toContain('Cite only pages you opened or that a search returned')
    expect(prompt).toContain('`render_artifact`')
    expect(prompt).not.toContain('Coding agents are single-player')
  })
})
