import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Modules that shared packages must never import: they keep the analysis engine browser- and runner-independent. */
const FORBIDDEN_IN_SHARED_PACKAGES = [
  { group: ['chrome', '@types/chrome'], message: 'Shared packages must not use Chrome APIs.' },
  { group: ['react', 'react-dom', 'react/*'], message: 'Shared packages must not use React.' },
  {
    group: ['playwright', 'playwright/*', '@playwright/*'],
    message: 'Shared packages must not use Playwright.',
  },
  { group: ['node:*'], message: 'Shared packages must stay runtime-neutral (no Node.js APIs).' },
];

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/dist-e2e/',
    'coverage/',
    '**/*.tsbuildinfo',
    'test-results/',
    'playwright-report/',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },

  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_IN_SHARED_PACKAGES }],
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Shared packages must not use Chrome APIs.' },
        { name: 'window', message: 'Shared packages must not depend on the DOM.' },
        { name: 'document', message: 'Shared packages must not depend on the DOM.' },
        { name: 'process', message: 'Shared packages must stay runtime-neutral.' },
      ],
    },
  },

  // Extension build scripts and Vite config run in Node.js and use their own tsconfig.
  {
    files: [
      'apps/extension/vite.config.ts',
      'apps/extension/scripts/**/*.ts',
      'apps/extension/tests/manifest-policy.test.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./apps/extension/tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { 'no-console': 'off' },
  },

  // Plain JavaScript config files are not part of any tsconfig project.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
