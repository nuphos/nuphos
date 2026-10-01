import { RuleTester } from 'eslint'

import rule from './no-history-reference-comment.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

ruleTester.run('no-history-reference-comment', rule, {
  valid: [
    // Describes what the code does now — the shape the rule is steering toward.
    '// Readers normalize a missing list to empty.\nconst a = 1\n',
    // ADR refs are allowed by default: a pointer to a living design document is
    // the alternative to inlining the rationale, not an instance of it.
    '// Ranking half of the access-decay index (ADR-0008).\nconst a = 1\n',
    // A date bounding a window that is still in force is an operational fact.
    '// Introductory pricing through 2026-08-31; reverts to 3 / 15 / 0.3.\nconst a = 1\n',
    '// Absent on records written before 2026-07-15.\nconst a = 1\n',
    // A bare `#123` is not an issue reference; colors and anchors are common.
    '// background #336699 with a 12px radius\nconst a = 1\n',
    // Not a date: no month component.
    '// keep the 2026 forecast in sync\nconst a = 1\n',
    // A ticket-shaped string inside code is not a comment.
    'const id = "ZEA-10078"\n',
    // Directive comments are exempt.
    '// eslint-disable-next-line no-console -- see PR #456\nconst a = 1\n',
    // Turning a category off works.
    {
      code: '// captured 2026-07-08 in prod\nconst a = 1\n',
      options: [{ flagDates: false }],
    },
    {
      code: '// see ZEA-10078\nconst a = 1\n',
      options: [{ ticketPrefixes: [] }],
    },
  ],

  invalid: [
    {
      code: '// Thinking-block invariants (ZEA-10078): none of these may reorder.\nconst a = 1\n',
      errors: [{ messageId: 'ticket', data: { ref: 'ZEA-10078' } }],
    },
    {
      code: '// Slack mapping guard added for NUPS-598.\nconst a = 1\n',
      errors: [{ messageId: 'ticket', data: { ref: 'NUPS-598' } }],
    },
    {
      code: '// Regression coverage for issue #338: a Slack run whose stream failed.\nconst a = 1\n',
      errors: [{ messageId: 'issue', data: { ref: 'issue #338' } }],
    },
    {
      code: '// Error toasts are whitelist-only (PR #496).\nconst a = 1\n',
      errors: [{ messageId: 'issue', data: { ref: 'PR #496' } }],
    },
    {
      code: '// The 2026-07-24 incident shape: Karpenter drained the node mid-turn.\nconst a = 1\n',
      errors: [{ messageId: 'date', data: { ref: '2026-07-24' } }],
    },
    // Year-month alone still counts.
    {
      code: '// Cloudflare OAuth endpoints (confirmed live, 2026-06).\nconst a = 1\n',
      errors: [{ messageId: 'date', data: { ref: '2026-06' } }],
    },
    // A JSDoc block is checked the same way.
    {
      code: '/**\n * Monitoring incident entry (route B of ZEA-10063).\n */\nconst a = 1\n',
      errors: [{ messageId: 'ticket', data: { ref: 'ZEA-10063' } }],
    },
    // One report per comment even when several markers appear.
    {
      code: '// ZEA-10078 so the paths are testable — the 2026-07-07 regression.\nconst a = 1\n',
      errors: [{ messageId: 'ticket', data: { ref: 'ZEA-10078' } }],
    },
    // Two offending comments are two reports.
    {
      code: '// see ZEA-1\nconst a = 1\n// see NUPS-2\nconst b = 2\n',
      errors: [{ messageId: 'ticket' }, { messageId: 'ticket' }],
    },
    // ADR can be made a violation if a project wants that.
    {
      code: '// Ranking half of the access-decay index (ADR-0008).\nconst a = 1\n',
      options: [{ ticketPrefixes: ['ADR'], allowedPrefixes: [] }],
      errors: [{ messageId: 'ticket', data: { ref: 'ADR-0008' } }],
    },
    // A second date later in the same comment is reported when the first is
    // inside a validity window.
    {
      code: '// valid after 2026-01-01; the 2026-07-08 rollout changed the shape.\nconst a = 1\n',
      errors: [{ messageId: 'date', data: { ref: '2026-07-08' } }],
    },
  ],
})

console.log('no-history-reference-comment: ok')
