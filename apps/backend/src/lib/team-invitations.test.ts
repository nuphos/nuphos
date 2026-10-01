import { describe, expect, test } from 'bun:test'

import { buildInvitationEmail } from './team-invitations'

describe('buildInvitationEmail', () => {
  test('names the inviter and team in the copy', () => {
    const { subject, html, text } = buildInvitationEmail({
      to: 'invitee@example.com',
      teamName: 'Acme',
      inviterName: 'Alice',
    })

    expect(subject).toBe("You're invited to Acme on Nuphos")
    expect(html).toContain('Alice has invited you to join')
    expect(html).toContain('<strong>Acme</strong>')
    expect(html).toContain('<strong>invitee@example.com</strong>')
    expect(text).toContain('Alice has invited you to join Acme on Nuphos.')
    expect(text).toContain('sign in with invitee@example.com')
  })

  test('falls back gracefully when inviter name / team name are blank', () => {
    const { subject, html, text } = buildInvitationEmail({
      to: 'x@example.com',
      teamName: '   ',
      inviterName: '',
    })

    expect(subject).toBe("You're invited to a team on Nuphos")
    // The apostrophe is HTML-escaped in the markup but plain in the text part.
    expect(html).toContain('You&#39;ve been invited to join')
    expect(html).toContain('<strong>a team</strong>')
    expect(text).toContain("You've been invited to join a team on Nuphos.")
  })

  test('includes the app link only when appUrl is provided', () => {
    const withUrl = buildInvitationEmail({
      to: 'x@example.com',
      teamName: 'Acme',
      inviterName: 'Alice',
      appUrl: 'https://nuphos.ai',
    })

    expect(withUrl.html).toContain('href="https://nuphos.ai"')
    expect(withUrl.html).toContain('Accept invitation</a>')
    expect(withUrl.text).toContain('https://nuphos.ai')

    const withoutUrl = buildInvitationEmail({
      to: 'x@example.com',
      teamName: 'Acme',
      inviterName: 'Alice',
    })

    expect(withoutUrl.html).not.toContain('<a href')
    expect(withoutUrl.text).not.toContain('http')
  })

  test('blank appUrl is treated as no link', () => {
    const { html } = buildInvitationEmail({
      to: 'x@example.com',
      teamName: 'Acme',
      inviterName: 'Alice',
      appUrl: '   ',
    })

    expect(html).not.toContain('<a href')
  })

  test('escapes HTML in team name, inviter name, and email', () => {
    const { html } = buildInvitationEmail({
      to: 'a"b@example.com',
      teamName: '<script>alert(1)</script>',
      inviterName: 'Bob & "Friends"',
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Bob &amp; &quot;Friends&quot;')
    expect(html).toContain('a&quot;b@example.com')
  })

  test('escapes the app link href', () => {
    const { html } = buildInvitationEmail({
      to: 'x@example.com',
      teamName: 'Acme',
      inviterName: 'Alice',
      appUrl: 'https://nuphos.ai/"><img src=x>',
    })

    expect(html).not.toContain('"><img src=x>')
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;')
  })
})
