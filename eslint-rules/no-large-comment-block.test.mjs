import { RuleTester } from 'eslint'

import rule from './no-large-comment-block.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

const line = (n, text = 'prose') =>
  Array.from({ length: n }, (_, i) => `// ${text} ${i + 1}`).join('\n')

ruleTester.run('no-large-comment-block', rule, {
  valid: [
    { code: `${line(3)}\nconst a = 1\n`, options: [{ max: 5 }] },
    // Exactly at the limit is fine; the rule reports only past it.
    { code: `${line(5)}\nconst a = 1\n`, options: [{ max: 5 }] },
    // Code between the two halves means neither half is a large block.
    {
      code: `${line(5)}\nconst a = 1\n${line(5)}\nconst b = 2\n`,
      options: [{ max: 5 }],
    },
    // A trailing comment shares its line with code, so it is not comment-only.
    {
      code: 'const a = 1 // one\nconst b = 2 // two\nconst c = 3 // three\n',
      options: [{ max: 2 }],
    },
    // `//` inside a string is not a comment.
    {
      code: 'const u = "// a\\n// b\\n// c\\n// d"\nconst v = 1\n',
      options: [{ max: 2 }],
    },
    // Directive comments are instructions to tooling, not prose.
    {
      code: [
        '/* eslint-disable no-console */',
        '// eslint-disable-next-line no-alert',
        '// eslint-disable-next-line no-debugger',
        '// eslint-disable-next-line no-eval',
        'const a = 1',
      ].join('\n'),
      options: [{ max: 2 }],
    },
  ],

  invalid: [
    {
      code: `${line(6)}\nconst a = 1\n`,
      options: [{ max: 5 }],
      errors: [{ messageId: 'tooLong', data: { count: '6', max: '5' }, line: 1, endLine: 6 }],
    },
    // A blank line does not end the run: 3 + 3 is still a 6-line block.
    {
      code: `${line(3)}\n\n${line(3)}\nconst a = 1\n`,
      options: [{ max: 5 }],
      errors: [{ messageId: 'tooLong', data: { count: '6', max: '5' } }],
    },
    // A single block comment spanning too many lines counts the same way.
    {
      code: `/**\n * a\n * b\n * c\n * d\n * e\n */\nconst a = 1\n`,
      options: [{ max: 5 }],
      errors: [{ messageId: 'tooLong', data: { count: '7', max: '5' } }],
    },
    // Two separate over-long blocks are two separate reports.
    {
      code: `${line(6)}\nconst a = 1\n${line(6)}\nconst b = 2\n`,
      options: [{ max: 5 }],
      errors: [{ messageId: 'tooLong' }, { messageId: 'tooLong' }],
    },
    // Default threshold is 15.
    {
      code: `${line(16)}\nconst a = 1\n`,
      errors: [{ messageId: 'tooLong', data: { count: '16', max: '15' } }],
    },
    // A block running to end of file is still reported.
    {
      code: `const a = 1\n${line(6)}\n`,
      options: [{ max: 5 }],
      errors: [{ messageId: 'tooLong', data: { count: '6', max: '5' } }],
    },
  ],
})

console.log('no-large-comment-block: ok')
