import { describe, expect, test } from 'bun:test'

import { redirectNotice } from './consent-pages'

describe('redirectNotice', () => {
  test('names a known client host without a warning', () => {
    const html = redirectNotice('https://claude.ai/api/mcp/auth_callback')

    expect(html).toContain('claude.ai')
    expect(html).not.toContain('Unverified')
  })

  test('flags any other host as unverified', () => {
    const html = redirectNotice('https://claude.ai.example.net/cb')

    expect(html).toContain('claude.ai.example.net')
    expect(html).toContain('Unverified app')
  })

  test('describes loopback redirects as this computer', () => {
    expect(redirectNotice('http://127.0.0.1:8123/cb')).toContain('this computer')
  })
})
