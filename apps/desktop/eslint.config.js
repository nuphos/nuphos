import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

import nuphos from '../../eslint-rules/index.js'

// Desktop lint policy. Mirrors apps/backend/eslint.config.js — same severity
// philosophy and the same thresholds — plus the React and Electron specifics.

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
  // `allowNamedFunctions` keeps named function expressions: `forwardRef` and
  // `memo` wrappers rely on the name for the React component display name, so
  // rewriting them as arrows makes them anonymous in crash stacks and DevTools.
  'prefer-arrow-callback': ['warn', { allowNamedFunctions: true }],
  'logical-assignment-operators': ['warn', 'always'],
  yoda: 'warn',
  // `curly` is NOT enabled: `eslint-config-prettier` sets it to 0
  // unconditionally, so any severity set here resolves to off.
}

// Blank-line discipline — see apps/backend/eslint.config.js for why the rule
// comes from `@stylistic` and not from ESLint core.
const blankLineDiscipline = {
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
    { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
  ],
}

// Comment discipline — see apps/backend/eslint.config.js.
const commentDiscipline = {
  'nuphos/no-large-comment-block': ['warn', { max: 15 }],
  'nuphos/no-duplicate-comment': ['warn', { max: 2, minWords: 4 }],
  'nuphos/no-history-reference-comment': 'warn',
  'nuphos/no-orphaned-doc-comment': 'warn',
  // See apps/backend/eslint.config.js for why no-floating-promises misses this.
  'nuphos/no-unawaited-async-assertion': 'error',
}

const sharedPluginRules = {
  // ---- sonarjs --------------------------------------------------------
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
  'sonarjs/prefer-regexp-exec': 'off',
  'sonarjs/deprecation': 'off',
  // Off: React already treats props as immutable by contract.
  'sonarjs/prefer-read-only-props': 'off',

  // ---- unicorn: bug-shaped rules only (see backend config) ------------
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

  // ---- import hygiene --------------------------------------------------
  // `import-x/no-cycle` is NOT enabled — see backend config.
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
}

const typeAwareRules = {
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
  // Off: `onClick={() => setState(x)}` is idiomatic React, not a bug.
  '@typescript-eslint/no-confusing-void-expression': 'off',
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
  '@typescript-eslint/consistent-type-imports': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-shadow': 'warn',

  // Off for the same reasons as backend.
  '@typescript-eslint/strict-boolean-expressions': 'off',
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-use-before-define': 'off',
}

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'release', 'public/logo-intro/logo-intro.js']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      sonarjs.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { unicorn, 'import-x': importX, '@stylistic': stylistic, nuphos },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: './tsconfig.app.json' }),
      ],
    },
    rules: {
      ...sizeRules,
      ...coreCorrectness,
      ...coreStyle,
      ...blankLineDiscipline,
      ...commentDiscipline,
      ...sharedPluginRules,
      ...typeAwareRules,
      // The renderer is a GUI; `console` is how it reports to the dev console.
      'no-console': 'off',
    },
  },

  {
    // `tsconfig.app.json` does not include test files, so there is no type
    // program for them. Opt them out of type-aware linting entirely rather
    // than widening what `pnpm typecheck` compiles.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: false } },
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      complexity: 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/cognitive-complexity': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-for-in-array': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/require-array-sort-compare': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
    },
  },

  {
    // Electron main/preload run in Node, not the browser.
    files: ['electron/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
])
