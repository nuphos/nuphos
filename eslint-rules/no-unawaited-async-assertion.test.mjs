import { RuleTester } from 'eslint'

import rule from './no-unawaited-async-assertion.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

ruleTester.run('no-unawaited-async-assertion', rule, {
  valid: [
    'await expect(p).rejects.toThrow()',
    'await expect(p).resolves.toBe(1)',
    'await expect(p).rejects.not.toThrow()',
    'function t() { return expect(p).rejects.toThrow() }',
    'void expect(p).rejects.toThrow()',
    'await Promise.all([expect(p).rejects.toThrow(), expect(q).rejects.toThrow()])',
    'const assertion = expect(p).rejects.toThrow()',
    // Synchronous matchers settle immediately — not this rule's business.
    'expect(x).toBe(1)',
    'expect(x).not.toBe(1)',
    'expect(fn).toThrow()',
    // `rejects` reached from something that is not an `expect()` call.
    'handler.rejects.toThrow()',
    'expect.rejectsTo.stringContaining("e")',
    // A computed property is not the modifier.
    'expect(p)[key].toThrow()',
  ],

  invalid: [
    {
      code: 'expect(p).rejects.toThrow()',
      errors: [
        {
          messageId: 'unawaited',
          data: { modifier: 'rejects' },
          suggestions: [{ messageId: 'addAwait', output: 'await expect(p).rejects.toThrow()' }],
        },
      ],
    },
    {
      code: 'expect(p).resolves.toBe(1)',
      errors: [
        {
          messageId: 'unawaited',
          data: { modifier: 'resolves' },
          suggestions: [{ messageId: 'addAwait', output: 'await expect(p).resolves.toBe(1)' }],
        },
      ],
    },
    // The `.not` link between the modifier and the matcher must not hide it.
    {
      code: 'expect(p).rejects.not.toThrow()',
      errors: [
        {
          messageId: 'unawaited',
          suggestions: [{ messageId: 'addAwait', output: 'await expect(p).rejects.not.toThrow()' }],
        },
      ],
    },
    // `expect.soft(...)` is still an expect call.
    {
      code: 'expect.soft(p).rejects.toThrow()',
      errors: [
        {
          messageId: 'unawaited',
          suggestions: [
            { messageId: 'addAwait', output: 'await expect.soft(p).rejects.toThrow()' },
          ],
        },
      ],
    },
    // Inside a loop, which is how a batch of cases is usually asserted.
    {
      code: 'for (const p of ps) expect(p).rejects.toThrow()',
      errors: [
        {
          messageId: 'unawaited',
          suggestions: [
            {
              messageId: 'addAwait',
              output: 'for (const p of ps) await expect(p).rejects.toThrow()',
            },
          ],
        },
      ],
    },
  ],
})

console.log('no-unawaited-async-assertion: ok')
