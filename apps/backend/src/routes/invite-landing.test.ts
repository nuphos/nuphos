import { describe, expect, test } from 'bun:test'

import { inviteLandingPage } from './invite-landing'

describe('inviteLandingPage', () => {
  test('names the team and offers open + download actions', () => {
    const html = inviteLandingPage('Acme')

    expect(html).toContain('Join <b>Acme</b> on Nuphos')
    expect(html).toContain('href="nuphos://open"')
    expect(html).toContain('href="https://nuphos.ai/download"')
    // The auto-launch script fires the same deep link the button offers.
    expect(html).toContain('location.href = "nuphos://open"')
  })

  test('falls back to a generic heading without a team name', () => {
    for (const value of [null, '', '   ']) {
      expect(inviteLandingPage(value)).toContain('Join your team on Nuphos')
    }
  })

  test('escapes HTML in the team name', () => {
    const html = inviteLandingPage('<script>alert(1)</script>')

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
