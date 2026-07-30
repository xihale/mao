import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'public/pagefind/**',
    'node_modules/**',
    '.astro/**',
    'build/**',
  ]),

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Config file itself is plain JS — no type-aware rules
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Astro: recommended + strict a11y. Type-aware TS rules don't work well on
  // .astro (parser falls back / types become `error`); astro check + tsc cover that.
  ...astro.configs['flat/recommended'],
  ...astro.configs['flat/jsx-a11y-strict'],
  {
    files: ['**/*.astro'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ['scripts/**/*.{ts,js}', 'astro.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['src/scripts/**/*.{ts,js}'],
    languageOptions: { globals: globals.browser },
  },
);
