import { describe, expect, test } from 'bun:test'

import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { toSlackMrkdwn } from '@/lib/slack/mrkdwn/convert'

describe('escapeSlackMrkdwn', () => {
  test('escapes the three mrkdwn control characters', () => {
    expect(escapeSlackMrkdwn('a & b <c> d')).toBe('a &amp; b &lt;c&gt; d')
  })
})

describe('toSlackMrkdwn — emphasis', () => {
  test('CommonMark double-star bold becomes single-star mrkdwn bold', () => {
    expect(toSlackMrkdwn('**重點**：說明')).toBe('*重點*：說明')
  })

  test('underscore bold becomes single-star bold', () => {
    expect(toSlackMrkdwn('__loud__')).toBe('*loud*')
  })

  test('single-star italic becomes underscore italic', () => {
    expect(toSlackMrkdwn('*quiet*')).toBe('_quiet_')
  })

  test('underscore italic stays underscore italic', () => {
    expect(toSlackMrkdwn('_quiet_')).toBe('_quiet_')
  })

  test('snake_case identifiers are not italicised', () => {
    expect(toSlackMrkdwn('call get_user_name(id) now')).toBe('call get_user_name(id) now')
  })

  // CommonMark parses `***x***` as em wrapping strong, so the mrkdwn nests the
  // same way round. Slack renders either nesting identically.
  test('bold-italic nests as italic around bold', () => {
    expect(toSlackMrkdwn('***both***')).toBe('_*both*_')
  })

  test('strikethrough collapses to a single tilde', () => {
    expect(toSlackMrkdwn('~~gone~~')).toBe('~gone~')
  })

  test('adjacent bold runs each convert independently', () => {
    expect(toSlackMrkdwn('**a** and **b**')).toBe('*a* and *b*')
  })

  test('bold adjacent to CJK text converts', () => {
    expect(toSlackMrkdwn('我會出一張**審批卡**（要動哪些東西）')).toBe(
      '我會出一張*審批卡*（要動哪些東西）',
    )
  })

  test('unclosed bold markers are left untouched', () => {
    expect(toSlackMrkdwn('**unclosed and on we go')).toBe('**unclosed and on we go')
  })
})

describe('toSlackMrkdwn — links', () => {
  test('CommonMark link becomes a Slack link token', () => {
    expect(toSlackMrkdwn('[sample-project](https://example.com/projects/sample-project)')).toBe(
      '<https://example.com/projects/sample-project|sample-project>',
    )
  })

  test('balanced parentheses inside the URL are kept', () => {
    expect(toSlackMrkdwn('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe(
      '<https://en.wikipedia.org/wiki/Foo_(bar)|wiki>',
    )
  })

  test('query-string ampersands are escaped for Slack', () => {
    expect(toSlackMrkdwn('[q](https://x.dev/s?a=1&b=2)')).toBe('<https://x.dev/s?a=1&amp;b=2|q>')
  })

  test('image syntax degrades to a labelled link', () => {
    expect(toSlackMrkdwn('![chart](https://x.dev/c.png)')).toBe('<https://x.dev/c.png|chart>')
  })

  test('emphasis inside a link label is converted, the URL is not', () => {
    expect(toSlackMrkdwn('[**hot** fix](https://x.dev/a_b_c)')).toBe(
      '<https://x.dev/a_b_c|*hot* fix>',
    )
  })

  test('stars in the URL are not read as emphasis', () => {
    expect(toSlackMrkdwn('[q](https://x.dev/a*b*c)')).toBe('<https://x.dev/a*b*c|q>')
  })

  test('underscores in the URL are not read as emphasis', () => {
    expect(toSlackMrkdwn('[q](https://x.dev/_a_/~~b~~)')).toBe('<https://x.dev/_a_/~~b~~|q>')
  })

  test('the URL keeps its stars even when the label carries real emphasis', () => {
    expect(toSlackMrkdwn('[**hot**](https://x.dev/a*b*c)')).toBe('<https://x.dev/a*b*c|*hot*>')
  })

  test('a pipe in the URL is percent-encoded so the label boundary survives', () => {
    expect(toSlackMrkdwn('[q](https://x.dev/s?f=a|b)')).toBe('<https://x.dev/s?f=a%7Cb|q>')
  })

  test('non-http targets are left as literal text', () => {
    expect(toSlackMrkdwn('[anchor](#section-2)')).toBe('[anchor](#section-2)')
  })

  test('an unterminated link is left as literal text', () => {
    expect(toSlackMrkdwn('[label](https://x.dev')).toBe('[label](https://x.dev')
  })

  test('a bare URL is left for Slack to auto-link', () => {
    expect(toSlackMrkdwn('see https://example.com/x now')).toBe('see https://example.com/x now')
  })
})

describe('toSlackMrkdwn — Slack tokens are preserved', () => {
  test('user, channel, special and link tokens survive verbatim', () => {
    const input = '可以，<@U123ABC>。問 <#C0FF1CE|general>，<!here> 看 <https://x.dev|X>'

    expect(toSlackMrkdwn(input)).toBe(input)
  })

  test('a mention next to bold keeps both', () => {
    expect(toSlackMrkdwn('<@U1> **注意**')).toBe('<@U1> *注意*')
  })

  test('a subteam token survives', () => {
    expect(toSlackMrkdwn('<!subteam^S123|@ops> ping')).toBe('<!subteam^S123|@ops> ping')
  })
})

describe('toSlackMrkdwn — code', () => {
  test('inline code content is untouched', () => {
    expect(toSlackMrkdwn('run `npm i **x**` first')).toBe('run `npm i **x**` first')
  })

  // Code markup is never rewritten as prose, but its content is still escaped:
  // a `<@U1>` an author put inside a code sample must read as code, not fire a
  // notification. The info string goes because Slack has no language tag.
  test('fenced code is not rewritten as prose and cannot activate a mention', () => {
    const input = 'before\n```ts\nconst a = b ** 2\n// [x](y) and <@U1>\n```\nafter **bold**'

    expect(toSlackMrkdwn(input)).toBe(
      'before\n```\nconst a = b ** 2\n// [x](y) and &lt;@U1&gt;\n```\nafter *bold*',
    )
  })

  // CommonMark closes an unterminated fence at end of input; emitting the
  // closing fence is what keeps Slack rendering it as code.
  test('an unterminated fence is closed rather than leaking into prose', () => {
    expect(toSlackMrkdwn('x\n```\n**raw**')).toBe('x\n```\n**raw**\n```')
  })
})

// CommonMark code delimiters are variable-length: fences may be backticks OR
// tildes and any run of 3+, and an inline span may use any backtick run. A
// converter that only knows ``` and ` rewrites the rest as prose — and a
// `<@U…>` left active inside what the author wrote as code still notifies.
describe('toSlackMrkdwn — variable-length code delimiters', () => {
  test('a tilde fence protects its content', () => {
    expect(toSlackMrkdwn('~~~~\n**raw** [x](https://example.com)\n~~~~')).toBe(
      '```\n**raw** [x](https://example.com)\n```',
    )
  })

  test('a three-tilde fence protects its content', () => {
    expect(toSlackMrkdwn('~~~\n**raw**\n~~~')).toBe('```\n**raw**\n```')
  })

  test('a four-backtick fence may contain triple backticks', () => {
    expect(toSlackMrkdwn('````\n```\n**raw**\n```\n````')).toBe('```\n```\n**raw**\n```\n```')
  })

  test('a multi-backtick inline span protects a backtick and its content', () => {
    expect(toSlackMrkdwn('``code ` **raw**``')).toBe('``code ` **raw**``')
  })

  test('an info string is dropped — Slack has no language tag', () => {
    expect(toSlackMrkdwn('```ts\nconst a = 1\n```')).toBe('```\nconst a = 1\n```')
  })

  test('a mention inside a fence is rendered inert, not left notifying', () => {
    expect(toSlackMrkdwn('```\n<@U123ABC>\n```')).toBe('```\n&lt;@U123ABC&gt;\n```')
  })

  test('a mention inside a tilde fence is rendered inert', () => {
    expect(toSlackMrkdwn('~~~\n<@U123ABC>\n~~~')).toBe('```\n&lt;@U123ABC&gt;\n```')
  })

  test('a mention inside a multi-backtick inline span is rendered inert', () => {
    expect(toSlackMrkdwn('``<@U123ABC> `x` ``')).toBe('``&lt;@U123ABC&gt; `x` ``')
  })

  test('an indented code block is protected', () => {
    expect(toSlackMrkdwn('    **raw** <@U123ABC>')).toBe('```\n**raw** &lt;@U123ABC&gt;\n```')
  })
})

// A CommonMark backslash escape says "this is literal text, not markup". Slack
// has no backslash escape, so the converter — not Slack — has to honour it. The
// dangerous direction is a `\<@U…>` the author wrote to talk ABOUT a mention
// arriving as a live one.
describe('toSlackMrkdwn — CommonMark backslash escapes', () => {
  test('an escaped mention is rendered inert and cannot notify', () => {
    expect(toSlackMrkdwn('\\<@U123ABC>')).toBe('&lt;@U123ABC&gt;')
  })

  test('an escaped channel token is rendered inert', () => {
    expect(toSlackMrkdwn('\\<#C0FF1CE>')).toBe('&lt;#C0FF1CE&gt;')
  })

  test('a genuine unescaped mention still passes through', () => {
    expect(toSlackMrkdwn('<@U123ABC> and \\<@U456DEF>')).toBe('<@U123ABC> and &lt;@U456DEF&gt;')
  })

  test('an escaped link stays literal text', () => {
    expect(toSlackMrkdwn('\\[x](https://example.com)')).toBe('[x](https://example.com)')
  })

  // CommonMark reads `\**x**` as a literal star followed by real emphasis, so
  // the star stays literal and only the inner `*x*` converts. What must NOT
  // survive is the backslash itself, which Slack would show verbatim.
  test('an escaped emphasis marker stays literal and drops its backslash', () => {
    expect(toSlackMrkdwn('\\**x**')).toBe('*_x_*')
    expect(toSlackMrkdwn('\\**x**')).not.toContain('\\')
  })

  test('an escaped underscore does not open italics', () => {
    expect(toSlackMrkdwn('\\_x\\_')).toBe('_x_')
  })

  test('an escaped backtick does not open a code span', () => {
    expect(toSlackMrkdwn('\\`not code\\`')).toBe('`not code`')
  })

  test('a literal backslash survives', () => {
    expect(toSlackMrkdwn('C:\\\\path')).toBe('C:\\path')
  })
})

describe('toSlackMrkdwn — escaping', () => {
  test('bare control characters are escaped', () => {
    expect(toSlackMrkdwn('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
  })

  test('escaping does not touch a real Slack token on the same line', () => {
    expect(toSlackMrkdwn('<@U1> says a < b')).toBe('<@U1> says a &lt; b')
  })
})

// Slack's escaping and CommonMark's entities use the same syntax, so escaping
// an `&` that already opens an entity produces `&amp;amp;` — visible junk in
// prose, and a changed destination inside a URL.
describe('toSlackMrkdwn — existing entities are not double-escaped', () => {
  test('a named entity in prose is left as one entity', () => {
    expect(toSlackMrkdwn('AT&amp;T')).toBe('AT&amp;T')
  })

  test('an entity in a link destination does not change the destination', () => {
    expect(toSlackMrkdwn('[q](https://example.com/?a=1&amp;b=2)')).toBe(
      '<https://example.com/?a=1&amp;b=2|q>',
    )
  })

  test('a decimal numeric entity is preserved', () => {
    expect(toSlackMrkdwn('a &#38; b')).toBe('a &#38; b')
  })

  test('a hex numeric entity is preserved', () => {
    expect(toSlackMrkdwn('a &#x26; b')).toBe('a &#x26; b')
  })

  test('a non-control named entity is preserved', () => {
    expect(toSlackMrkdwn('&copy; 2026')).toBe('&copy; 2026')
  })

  test('a bare ampersand is still escaped', () => {
    expect(toSlackMrkdwn('a & b')).toBe('a &amp; b')
  })

  test('an ampersand that only looks like an entity is escaped', () => {
    expect(toSlackMrkdwn('a &notanentity b')).toBe('a &amp;notanentity b')
  })

  test('a raw ampersand in a link destination is escaped exactly once', () => {
    expect(toSlackMrkdwn('[q](https://example.com/?a=1&b=2)')).toBe(
      '<https://example.com/?a=1&amp;b=2|q>',
    )
  })
})

describe('toSlackMrkdwn — block structure', () => {
  test('dash bullets become mrkdwn bullet characters', () => {
    expect(toSlackMrkdwn('- one\n- two')).toBe('• one\n• two')
  })

  test('star and plus bullets become bullet characters too', () => {
    expect(toSlackMrkdwn('* one\n+ two')).toBe('• one\n• two')
  })

  test('nested bullet indentation is preserved', () => {
    expect(toSlackMrkdwn('- one\n  - deep')).toBe('• one\n  • deep')
  })

  test('ordered list markers are left alone', () => {
    expect(toSlackMrkdwn('1. one\n2. two')).toBe('1. one\n2. two')
  })

  test('headings become bold lines', () => {
    expect(toSlackMrkdwn('## Cost breakdown\ntext')).toBe('*Cost breakdown*\ntext')
  })

  test('blockquote markers survive escaping', () => {
    expect(toSlackMrkdwn('> quoted **loud**')).toBe('> quoted *loud*')
  })

  test('paragraph and line boundaries are preserved exactly', () => {
    expect(toSlackMrkdwn('one\ntwo\n\nthree')).toBe('one\ntwo\n\nthree')
  })
})

describe('toSlackMrkdwn — fail-safe', () => {
  test('empty and blank input round-trips', () => {
    expect(toSlackMrkdwn('')).toBe('')
    expect(toSlackMrkdwn('   ')).toBe('   ')
  })

  test('non-string input yields an empty string', () => {
    expect(toSlackMrkdwn(undefined as unknown as string)).toBe('')
  })

  test('private-use characters pass through unchanged', () => {
    expect(toSlackMrkdwn('a\uE000b\uE001c')).toBe('a\uE000b\uE001c')
  })

  // Input is CommonMark by contract (nothing tells the agent to write mrkdwn),
  // so a lone `*x*` means italic and is converted as such. Only tokens with no
  // CommonMark meaning — Slack's own — are guaranteed to round-trip, which is
  // why this conversion belongs at exactly one boundary and must not be
  // applied twice.
  test('Slack-only constructs round-trip; a lone star reads as CommonMark italic', () => {
    expect(toSlackMrkdwn('_italic_ ~strike~ <https://x.dev|X> <@U1>')).toBe(
      '_italic_ ~strike~ <https://x.dev|X> <@U1>',
    )
    expect(toSlackMrkdwn('*bold*')).toBe('_bold_')
  })
})

// Synthetic stand-in for the reported message: same shape (mention, CJK prose
// with full-width punctuation, a bullet list with bold leads, bold mid-sentence,
// several inline links in one paragraph), none of its content or identifiers.
describe('toSlackMrkdwn — reported-message regression fixture', () => {
  const SOURCE = [
    '可以，<@U123ABC>。把檔案丟進這個 thread（PDF / Markdown 都行）我就能接手，流程大致是：',
    '',
    '- **第一步**：把需求拆成項目清單（甲、乙、丙…），再估一次數字。',
    '- **第二步**：確認後我會出一張**審批卡**（要動哪些東西、風險與回滾）。',
    '',
    '目前綁定的專案有 [sample-project](https://example.com/projects/sample-project)、[sample-project-2](https://example.com/projects/sample-project-2)。',
  ].join('\n')

  const EXPECTED = [
    '可以，<@U123ABC>。把檔案丟進這個 thread（PDF / Markdown 都行）我就能接手，流程大致是：',
    '',
    '• *第一步*：把需求拆成項目清單（甲、乙、丙…），再估一次數字。',
    '• *第二步*：確認後我會出一張*審批卡*（要動哪些東西、風險與回滾）。',
    '',
    '目前綁定的專案有 <https://example.com/projects/sample-project|sample-project>、<https://example.com/projects/sample-project-2|sample-project-2>。',
  ].join('\n')

  test('renders the reported message shape as Slack mrkdwn', () => {
    expect(toSlackMrkdwn(SOURCE)).toBe(EXPECTED)
  })

  test('leaves no literal CommonMark markers behind', () => {
    const out = toSlackMrkdwn(SOURCE)

    expect(out).not.toContain('**')
    expect(out).not.toContain('](')
  })
})

// F1 (review round 1): the fallback must fail CLOSED. The block renderer
// recurses per nesting level, so a crafted depth exhausts the stack — and the
// old fallback handed the raw string straight to Slack, where `\` means
// nothing and a `\<@U…>` the author neutralized fires a live notification.
// Depth 12000 is the verified repro; 8000 still renders normally.
describe('toSlackMrkdwn — parse failure fails closed', () => {
  const OVERFLOW_DEPTH = 12_000

  test('an escaped mention cannot survive a render failure as an active token', () => {
    const out = toSlackMrkdwn(`${'> '.repeat(OVERFLOW_DEPTH)}\\<@U123ABC>`)

    expect(out).not.toContain('<@U123ABC>')
    expect(out).toContain('&lt;@U123ABC&gt;')
  })

  test('a bare mention is also inert when the render fails', () => {
    const out = toSlackMrkdwn(`${'> '.repeat(OVERFLOW_DEPTH)}<@U123ABC>`)

    expect(out).not.toContain('<@U123ABC>')
  })

  test('the fallback still returns the message rather than throwing or emptying it', () => {
    const out = toSlackMrkdwn(`${'> '.repeat(OVERFLOW_DEPTH)}payload text`)

    expect(out).toContain('payload text')
  })
})
