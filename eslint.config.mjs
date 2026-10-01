import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import importX from 'eslint-plugin-import-x'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

import nuphos from './eslint-rules/index.js'

// Root lint policy — covers `scripts/` and `eslint-rules/`, which belong to
// no app and were linted by nothing. The apps own their own configs: separate
// dependency trees and tsconfigs, so a shared one would have to reach across
// package-manager boundaries.
//
// Type-aware rules are absent because there is no tsconfig at the repo root;
// these files run through `node --experimental-strip-types` and `bun`, never
// compiled. Severity and thresholds match the apps.

export default defineConfig([
  globalIgnores(['apps/**', 'node_modules/**', '**/dist/**']),

  {
    // `eslint-rules/` is linted here alongside `scripts/` — including by its
    // own comment rules. Dogfooding: if the limits are not livable for the
    // files that define them, they are not livable anywhere.
    files: ['scripts/**/*.{ts,mjs,js}', 'eslint-rules/**/*.{js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, sonarjs.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
    },
    plugins: { unicorn, 'import-x': importX, '@stylistic': stylistic, nuphos },
    rules: {
      // ---- comment discipline ---------------------------------------------
      'nuphos/no-large-comment-block': ['error', { max: 3 }],
      'nuphos/no-duplicate-comment': ['warn', { max: 2, minWords: 4 }],
      'nuphos/no-history-reference-comment': 'warn',
      'nuphos/no-orphaned-doc-comment': 'warn',
      // See apps/backend/eslint.config.js for why no-floating-promises misses this.
      'nuphos/no-unawaited-async-assertion': 'error',

      complexity: ['warn', { max: 15 }],
      'max-lines': ['error', { max: 300 }],
      'max-lines-per-function': [
        'warn',
        { max: 150, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-depth': ['warn', { max: 4 }],
      'max-params': ['warn', { max: 5 }],
      'max-statements': ['warn', { max: 40 }],
      'max-nested-callbacks': ['warn', { max: 4 }],

      // Correctness.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-caller': 'error',
      'no-iterator': 'error',
      'no-script-url': 'error',
      'no-labels': 'error',
      'no-sequences': 'error',
      'no-return-assign': ['error', 'always'],
      'no-constructor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      'no-multi-assign': 'error',
      'array-callback-return': 'error',
      'prefer-promise-reject-errors': 'error',
      'prefer-regex-literals': 'error',
      'prefer-object-spread': 'error',
      'prefer-exponentiation-operator': 'error',
      'symbol-description': 'error',
      'guard-for-in': 'error',
      'default-case-last': 'error',
      radix: 'error',
      'require-atomic-updates': 'warn',

      // Style.
      'no-else-return': ['warn', { allowElseIf: false }],
      'no-lonely-if': 'warn',
      'no-unneeded-ternary': 'warn',
      'no-nested-ternary': 'warn',
      'object-shorthand': ['warn', 'always'],
      'prefer-template': 'warn',
      'no-implicit-coercion': 'warn',
      'no-param-reassign': ['warn', { props: false }],
      // `allowNamedFunctions` keeps named function expressions, whose name is
      // what shows up in stack traces. Kept identical across every workspace.
      'prefer-arrow-callback': ['warn', { allowNamedFunctions: true }],
      'logical-assignment-operators': ['warn', 'always'],
      yoda: 'warn',
      // Blank line before every `return` and after a run of declarations.
      // Prettier does not touch blank lines between statements, so this is
      // unclaimed ground. It comes from `@stylistic` rather than core: the
      // core rule is deprecated (8.53.0) and removed in ESLint 11, and
      // `scripts/check-lint-config-integrity.mjs` rejects deprecated rules.
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      ],
      // `curly` is NOT enabled: `eslint-config-prettier` sets it to 0
      // unconditionally, so any severity here resolves to off.
      // CLI tools: printing is the product.
      'no-console': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // `type`, not the rule's default `interface`. Interfaces get no implicit
      // index signature, so the default direction breaks every
      // `Record<string, unknown>` assignment this codebase relies on.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/array-type': 'error',

      // sonarjs — same selection and reasoning as the apps.
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-identical-functions': ['warn', 4],
      // `sonarjs/no-commented-code` is NOT enabled — see backend config.
      'sonarjs/no-hardcoded-passwords': 'error',
      'sonarjs/no-hardcoded-secrets': 'error',
      'sonarjs/publicly-writable-directories': 'error',
      'sonarjs/no-clear-text-protocols': 'warn',
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/todo-tag': 'warn',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/unused-import': 'off',
      // Off: `kubectl` / `bun` / `git` by name is what a dev script is for.
      'sonarjs/no-os-command-from-path': 'off',

      // unicorn — same set as the apps.
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/error-message': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/no-thenable': 'error',
      'unicorn/prefer-type-error': 'error',
      'unicorn/no-single-promise-in-promise-methods': 'error',
      'unicorn/no-await-in-promise-methods': 'error',
      'unicorn/no-useless-promise-resolve-reject': 'error',
      'unicorn/no-instanceof-builtins': 'error',
      'unicorn/prefer-node-protocol': 'warn',
      'unicorn/prefer-single-call': 'warn',
      'unicorn/no-useless-spread': 'warn',
      'unicorn/no-useless-undefined': 'warn',
      'unicorn/prefer-array-find': 'warn',
      'unicorn/prefer-array-flat-map': 'warn',
      'unicorn/prefer-array-some': 'warn',
      'unicorn/prefer-date-now': 'warn',
      'unicorn/prefer-optional-catch-binding': 'warn',
      'unicorn/prefer-regexp-test': 'warn',
      'unicorn/prefer-string-slice': 'warn',
      'unicorn/prefer-set-has': 'warn',
      'unicorn/consistent-function-scoping': 'warn',

      // import hygiene. No resolver is configured (no tsconfig), so the
      // resolution-dependent rules stay off.
      'import-x/no-self-import': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-absolute-path': 'error',
      'import-x/no-empty-named-blocks': 'warn',
      'import-x/no-duplicates': 'warn',
      'import-x/first': 'warn',
      'import-x/newline-after-import': 'warn',
      'import-x/consistent-type-specifier-style': 'error',
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-unresolved': 'off',
    },
  },

  {
    files: ['scripts/**/*.test.{ts,mjs}', 'eslint-rules/**/*.test.mjs'],
    rules: {
      // RuleTester fixtures are deliberately repetitive and deliberately
      // contain the very patterns the rules ban — that is what makes them
      // fixtures. Linting them for comment discipline would be circular.
      'nuphos/no-duplicate-comment': 'off',
      'nuphos/no-history-reference-comment': 'off',

      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      complexity: 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/cognitive-complexity': 'off',
    },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
])
