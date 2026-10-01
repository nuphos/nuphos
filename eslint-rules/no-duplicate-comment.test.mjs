import { RuleTester } from 'eslint'

import rule from './no-duplicate-comment.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

ruleTester.run('no-duplicate-comment', rule, {
  valid: [
    // Twice is allowed at the default max of 2.
    'const a = 1 // optional because old docs predate this field\nconst b = 2 // optional because old docs predate this field\n',
    // Distinct sentences never group.
    [
      '// the first thing this file does',
      'const a = 1',
      '// the second thing this file does',
      'const b = 2',
      '// the third thing this file does',
      'const c = 3',
    ].join('\n'),
    // Too short to be prose: below minWords, so short markers like `// ---`
    // or `// see below` never trip the rule.
    '// see\nconst a = 1\n// see\nconst b = 2\n// see\nconst c = 3\n',
    [
      '// prettier-ignore because the table alignment is meaningful',
      'const a = 1',
      '// prettier-ignore because the table alignment is meaningful',
      'const b = 2',
      '// prettier-ignore because the table alignment is meaningful',
      'const c = 3',
    ].join('\n'),
    [
      '// @ts-expect-error upstream types are wrong here',
      'const a = 1',
      '// @ts-expect-error upstream types are wrong here',
      'const b = 2',
      '// @ts-expect-error upstream types are wrong here',
      'const c = 3',
    ].join('\n'),
  ],

  invalid: [
    // Three identical comments: the third is reported.
    {
      code: [
        '// rotation metadata fixed until key rotation is implemented',
        'const a = 1',
        '// rotation metadata fixed until key rotation is implemented',
        'const b = 2',
        '// rotation metadata fixed until key rotation is implemented',
        'const c = 3',
      ].join('\n'),
      errors: [{ messageId: 'repeated', data: { count: '3', first: '1' }, line: 5 }],
    },
    // The real shape from src/models.ts: identical prose, only the backticked
    // identifier differs. Normalization drops quoted spans so they group.
    {
      code: [
        '// Optional: existing team docs predate this field, so readers use `doc.larkApps ?? []`.',
        'const a = 1',
        '// Optional: existing team docs predate this field, so readers use `doc.asanaAccounts ?? []`.',
        'const b = 2',
        '// Optional: existing team docs predate this field, so readers use `doc.notionIntegrations ?? []`.',
        'const c = 3',
        '// Optional: existing team docs predate this field, so readers use `doc.hetznerAccounts ?? []`.',
        'const d = 4',
      ].join('\n'),
      errors: [
        { messageId: 'repeated', data: { count: '4', first: '1' }, line: 5 },
        { messageId: 'repeated', data: { count: '4', first: '1' }, line: 7 },
      ],
    },
    // Block and line comments with the same content group together.
    {
      code: [
        '/** the same thing said again and again */',
        'const a = 1',
        '// the same thing said again and again',
        'const b = 2',
        '/* the same thing said again and again */',
        'const c = 3',
      ].join('\n'),
      errors: [{ messageId: 'repeated', data: { count: '3', first: '1' }, line: 5 }],
    },
    // A stricter max reports from the second occurrence onward.
    {
      code: [
        '// this sentence appears more than once',
        'const a = 1',
        '// this sentence appears more than once',
        'const b = 2',
      ].join('\n'),
      options: [{ max: 1 }],
      errors: [{ messageId: 'repeated', data: { count: '2', first: '1' }, line: 3 }],
    },
  ],
})

console.log('no-duplicate-comment: ok')
