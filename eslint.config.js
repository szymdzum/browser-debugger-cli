import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';
import tsdoc from 'eslint-plugin-tsdoc';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Apply to TypeScript files
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      'unused-imports': unusedImports,
      'no-relative-import-paths': noRelativeImportPaths,
      tsdoc: tsdoc,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...tseslint.configs['recommended-requiring-type-checking'].rules,

      // Disable no-undef for TypeScript files (TypeScript handles this better)
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      // Disable base rule as it conflicts with unused-imports plugin
      '@typescript-eslint/no-unused-vars': 'off',

      // Use unused-imports plugin for better unused variable detection
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // Disallow unused expressions
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],

      // Enhanced promise handling
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'warn',

      // Type safety improvements
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Switch exhaustiveness check
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          allowDefaultCaseForExhaustiveSwitch: false,
          requireDefaultForNonUnion: true,
        },
      ],

      // TSDoc syntax validation
      'tsdoc/syntax': 'warn',

      // Import path consistency - enforce @/* over relative paths
      'no-relative-import-paths/no-relative-import-paths': [
        'error',
        {
          allowSameFolder: true,
          rootDir: 'src',
          prefix: '@',
        },
      ],

      'import/no-unresolved': 'error',
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'type', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
            },
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
        },
      ],

      // Dependency layer enforcement - prevent architectural violations
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // Utils layer (Layer 1) cannot import from higher layers (except as noted)
            {
              target: './src/utils',
              from: './src/commands',
              message: 'Utils cannot import from commands (layer violation)',
            },
            {
              target: './src/utils',
              from: './src/daemon',
              message: 'Utils cannot import from daemon (layer violation)',
            },
            // Note: utils → ui is allowed for messages/logging/OutputBuilder
            // This is a pragmatic exception for error formatting and output building

            // Connection layer (Layer 1) cannot import from session layer (Layer 2)
            {
              target: './src/connection',
              from: './src/session',
              message: 'Connection cannot import from session (creates circular dependency)',
            },

            // UI layer (Layer 3) cannot import from commands layer (Layer 4)
            {
              target: './src/ui',
              from: './src/commands',
              message: 'UI cannot import from commands (upward dependency)',
            },

            // Types module can import from connection for Protocol types, but that's it
            {
              target: './src/types',
              from: './src/commands',
              message: 'Types cannot import from commands',
            },
            {
              target: './src/types',
              from: './src/ui',
              message: 'Types cannot import from UI',
            },
            {
              target: './src/types',
              from: './src/session',
              message: 'Types cannot import from session',
            },
            {
              target: './src/types',
              from: './src/daemon',
              message: 'Types cannot import from daemon',
            },
          ],
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  // Test files - disable no-floating-promises for Node.js test runner
  {
    files: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.contract.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  // Prettier integration - disable conflicting rules
  prettierConfig,
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', '*.js', '!eslint.config.js'],
  },
];
