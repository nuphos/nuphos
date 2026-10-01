import { RuleTester } from 'eslint'

import rule from './no-orphaned-doc-comment.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

const doc = (text) => `/**\n * ${text}\n */`

ruleTester.run('no-orphaned-doc-comment', rule, {
  valid: [
    // One doc block per symbol is the whole point.
    `${doc('Adds.')}\nexport function add() {}\n${doc('Subtracts.')}\nexport function sub() {}\n`,
    // The opening block of a file documents the file, not the next symbol.
    `${doc('Module overview.')}\n${doc('Adds.')}\nexport function add() {}\n`,
    // A file overview written under the imports is still a file overview.
    `import x from 'x'\n${doc('Module overview.')}\n${doc('Adds.')}\nexport function add() {}\n`,
    // A line comment between them is not a second doc block.
    `const a = 1\n${doc('Adds.')}\n// aside\nexport function add() {}\n`,
    // A bare block comment is a banner, not documentation.
    `const a = 1\n/* Copyright someone. */\n${doc('Adds.')}\nexport function add() {}\n`,
    // A doc block followed by a banner is the same non-case in reverse.
    `const a = 1\n${doc('Adds.')}\n/* section */\nexport function add() {}\n`,
    // `/**` inside a string is not a comment.
    `const a = "/**\\n * not a comment\\n */"\nconst b = 2\n`,
    // Code between them means the first still documents something.
    `const a = 1\n${doc('Adds.')}\nexport function add() {}\n${doc('Subtracts.')}\nexport function sub() {}\n`,
    // Even a lone semicolon counts as the code the first block describes.
    `const a = 1\n${doc('Adds.')}\n;\n${doc('Subtracts.')}\nexport function sub() {}\n`,
  ],

  invalid: [
    {
      code: `const a = 1\n${doc('Documents nothing.')}\n${doc('Adds.')}\nexport function add() {}\n`,
      errors: [{ messageId: 'orphaned', data: { next: '5' }, line: 2 }],
    },
    // A blank line between them changes nothing: still no code.
    {
      code: `const a = 1\n${doc('Documents nothing.')}\n\n${doc('Adds.')}\nexport function add() {}\n`,
      errors: [{ messageId: 'orphaned' }],
    },
    // Three in a row orphan the first two.
    {
      code: `const a = 1\n${doc('One.')}\n${doc('Two.')}\n${doc('Three.')}\nexport function add() {}\n`,
      errors: [
        { messageId: 'orphaned', line: 2 },
        { messageId: 'orphaned', line: 5 },
      ],
    },
    // Trailing blocks at end of file document nothing either.
    {
      code: `export function add() {}\n${doc('One.')}\n${doc('Two.')}\n`,
      errors: [{ messageId: 'orphaned' }],
    },
  ],
})

console.log('no-orphaned-doc-comment: ok')
