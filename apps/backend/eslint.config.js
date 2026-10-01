import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

import nuphos from '../../eslint-rules/index.js'

// Backend lint policy. Severity is assigned by kind: `error` means a wrong
// program, `warn` means debt worth seeing. Thresholds come from this
// codebase's measured distribution — the derivation is in the pull request.

const sizeRules = {
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
}

const coreCorrectness = {
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
  // False-positive-prone on async accumulator patterns, so it warns.
  'require-atomic-updates': 'warn',
}

const coreStyle = {
  'no-else-return': ['warn', { allowElseIf: false }],
  'no-lonely-if': 'warn',
  'no-unneeded-ternary': 'warn',
  'no-nested-ternary': 'warn',
  'object-shorthand': ['warn', 'always'],
  'prefer-template': 'warn',
  'no-implicit-coercion': 'warn',
  'no-param-reassign': ['warn', { props: false }],
  // `allowNamedFunctions` keeps named function expressions, whose name is what
  // shows up in stack traces. Kept identical across every workspace config.
  'prefer-arrow-callback': ['warn', { allowNamedFunctions: true }],
  'logical-assignment-operators': ['warn', 'always'],
  'no-console': 'warn',
  yoda: 'warn',
  // `curly` is NOT enabled: `eslint-config-prettier` sets it to 0
  // unconditionally, so any severity set here resolves to off.
}

// Blank line before every `return` and after a run of declarations. Prettier
// does not touch blank lines between statements, so this is unclaimed ground.
// It comes from `@stylistic` rather than core: the core rule is deprecated
// (8.53.0) and removed in ESLint 11, and the config-integrity gate rejects
// deprecated rules.
const blankLineDiscipline = {
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
    { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
  ],
}

// Comment discipline: no large blocks of prose, no repeated comments, no
// change history in source. Rule implementations and their own docs live in
// eslint-rules/; thresholds and the rejected alternatives are in the PR.
const commentDiscipline = {
  'nuphos/no-large-comment-block': ['warn', { max: 15 }],
  'nuphos/no-duplicate-comment': ['warn', { max: 2, minWords: 4 }],
  'nuphos/no-history-reference-comment': 'warn',
  'nuphos/no-orphaned-doc-comment': 'warn',
}

// bun types every matcher as returning `void`, so `no-floating-promises` sees
// no thenable here and cannot report this shape under any option.
const testAssertionHygiene = {
  'nuphos/no-unawaited-async-assertion': 'error',
}

export default defineConfig([
  globalIgnores([
    'dist',
    // Emitted from the Hono routes — regenerate with `bun run generate:api`.
    'src/generated/**',
    // Vendored verbatim and shipped to the agent runtime byte-for-byte.
    'src/lib/agent/builtin-skills/**',
    // Intentionally malformed / third-party snapshots.
    'fixtures/**',
  ]),

  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { unicorn, 'import-x': importX, '@stylistic': stylistic, nuphos },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
    },
    rules: {
      ...sizeRules,
      ...coreCorrectness,
      ...coreStyle,
      ...blankLineDiscipline,
      ...commentDiscipline,
      ...testAssertionHygiene,

      // ---- type-aware correctness: these stay errors -------------------
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-misused-spread': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // ---- type-aware quality: real debt, kept visible -----------------
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-confusing-void-expression': 'warn',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',
      '@typescript-eslint/no-unnecessary-type-parameters': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      '@typescript-eslint/no-invalid-void-type': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      // `type`, not the rule's default `interface`. Interfaces get no implicit
      // index signature, so the default direction breaks every
      // `Record<string, unknown>` assignment this codebase relies on.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/array-type': 'error',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/prefer-regexp-exec': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-shadow': 'warn',

      // Off: `no-unnecessary-condition` covers the same bug class here at a
      // fraction of the noise.
      '@typescript-eslint/strict-boolean-expressions': 'off',
      // Off: inference is accurate here, so these are ceremony.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Off: function declarations are hoisted, so forward refs are fine.
      '@typescript-eslint/no-use-before-define': 'off',

      // ---- sonarjs ------------------------------------------------------
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-identical-functions': ['warn', 4],
      // `sonarjs/no-commented-code` is NOT enabled: it cannot fire under this
      // config. Both `projectService: true` and `sonarjs.configs.recommended`
      // independently suppress it, and both are load-bearing here.
      'sonarjs/no-hardcoded-passwords': 'error',
      'sonarjs/no-hardcoded-secrets': 'error',
      'sonarjs/publicly-writable-directories': 'error',
      'sonarjs/no-clear-text-protocols': 'warn',
      'sonarjs/no-hardcoded-ip': 'warn',
      // Threshold 5 rather than the default 3: short literals like 'utf-8'
      // dominate below that.
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/todo-tag': 'warn',
      // sonarjs ships duplicates of rules typescript-eslint already owns.
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/unused-import': 'off',
      'sonarjs/prefer-regexp-exec': 'off',
      'sonarjs/deprecation': 'off',

      // ---- unicorn: bug-shaped rules only --------------------------------
      // `unicorn/recommended` is mostly naming and `no-null` taste, which this
      // codebase contradicts deliberately (Mongo and JSON APIs use null).
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/error-message': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/no-thenable': 'error',
      'unicorn/prefer-type-error': 'error',
      'unicorn/no-invalid-remove-event-listener': 'error',
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
      'unicorn/require-number-to-fixed-digits-argument': 'warn',
      'unicorn/prefer-logical-operator-over-ternary': 'warn',

      // ---- import hygiene ------------------------------------------------
      // import-x, not eslint-plugin-import: the latter crashes on ESLint 10
      // ("Cannot use 'in' operator to search for 'sourceType' in undefined")
      // and the merged fix is still unreleased.
      //
      // `import-x/no-cycle` is NOT enabled: a planted two-file cycle went
      // undetected here even with the resolver confirmed working.
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
      // Off: the resolver follows neither Bun's `bun:*` builtins nor the `#`
      // subpath imports in package.json, so every hit is a false positive.
      'import-x/no-unresolved': 'off',
    },
  },

  {
    // CLAUDE.md mandates an explanatory comment per env var here, and sibling
    // keys legitimately share one. Only the duplicate rule is waived; this
    // file clears the other two on its own.
    files: ['src/config.ts'],
    rules: { 'nuphos/no-duplicate-comment': 'off' },
  },

  {
    // Tests legitimately do things production code should not: long fixture
    // literals, deep describe/it nesting, repeated magic strings. The comment
    // rules are deliberately NOT waived — a test has readers too.
    files: ['**/*.test.ts', 'src/lib/test/**/*.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      complexity: 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/cognitive-complexity': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    // bun-types declares `rejects: Matchers<unknown>` and every matcher as
    // returning `void`, though they settle asynchronously. Both rules below are
    // type-driven, so they fire on `await expect(...).rejects.toThrow()` —
    // correct code — and pressure the author to drop the `await`.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },

  {
    // `scripts/` is dev-only tooling and sits outside tsconfig.json's
    // `include`, so there is no type program for it — lint it syntactically.
    // Same for the one `.mjs` helper under src/, which the project service
    // also refuses.
    files: ['scripts/**/*.ts', 'eslint.config.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-array-sort-compare': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
    },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
])
