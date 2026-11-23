import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Backend lint configuration.
 *
 * TypeScript files use the recommended type-aware-free rules. A handful of
 * strictness rules are relaxed where the existing NestJS/Prisma code relies
 * on dynamic payloads (`any`) or test doubles.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'prisma/migrations/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'off',
      // Jest setup and CommonJS config files use require() by design.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
