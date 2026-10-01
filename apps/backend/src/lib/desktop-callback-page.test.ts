import { describe, expect, test } from 'bun:test'

import { desktopCallbackPage } from '@/lib/desktop-callback-page'

// The page is the escaping boundary for every connector's OAuth callback:
// attacker-influenceable state/error/error_description eventually reach the
// deep link that flows into both an href attribute and an inline script.

function scriptLiteral(html: string): string {
  const m = /location\.href = (.+?)<\/script>/s.exec(html)

  if (!m?.[1]) throw new Error('script literal not found')

  return m[1]
}

function hrefValue(html: string): string {
  const m = /href="(nuphos:[^"]*)"/.exec(html)

  if (!m?.[1]) throw new Error('href not found')

  return m[1]
}

describe('desktopCallbackPage', () => {
  test('commits a document and fires the deep link from script', () => {
    const html = desktopCallbackPage('nuphos://slack-callback?state=abc')

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('location.href = ')
  })

  test('href is HTML-escaped and round-trips to the exact link', () => {
    // A URL always encodes < > " ' but keeps & between query params raw, so
    // the href attribute must escape at least the ampersand.
    const link = 'nuphos://cf-callback?state=a&binding_id=b&account_name=x'
    const href = hrefValue(desktopCallbackPage(link))

    expect(href).not.toMatch(/&(?!amp;)/) // no unescaped ampersand
    expect(href.replaceAll('&amp;', '&')).toBe(link)
  })

  test('script literal is valid JSON that decodes to the exact link', () => {
    const u = new URL('nuphos://slack-callback')

    u.searchParams.set('error_description', 'User said <no> & "left" \' now')
    const link = u.toString()
    const decoded = JSON.parse(scriptLiteral(desktopCallbackPage(link)).replaceAll('\\u003c', '<'))

    expect(decoded).toBe(link)
  })

  test('a </script> in the deep link cannot break out of the inline script', () => {
    // Not reachable via URLSearchParams (it encodes '<'), but the escaping must
    // hold even if a raw value is ever passed through.
    const html = desktopCallbackPage('nuphos://x?e=</script><script>alert(1)')
    const beforeClose = html.slice(0, html.indexOf('</script>'))

    expect(beforeClose).toContain('location.href = ')
    expect(beforeClose).not.toContain('<script>alert(1)')
    expect(html).not.toContain('</script><script>alert(1)')
  })

  test('quotes and backslashes in the link stay contained in the JS string', () => {
    const link = 'nuphos://x?e=a"b\\c'
    const lit = scriptLiteral(desktopCallbackPage(link))

    expect(JSON.parse(lit.replaceAll('\\u003c', '<'))).toBe(link)
  })
})
