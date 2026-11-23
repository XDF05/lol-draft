import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Frontend lint configuration (Next.js 16 flat config).
 *
 * Next's Core Web Vitals and TypeScript presets are authoritative; the
 * project only relaxes rules that conflict with the existing dynamic socket
 * payload types.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // These effects intentionally synchronize React state with browser
      // storage, media queries, and socket lifecycles; the compiler rule
      // flags the established pattern without a correctness issue.
      'react-hooks/set-state-in-effect': 'off',
      // Champion icons are external Data Dragon URLs; a plain <img> avoids
      // configuring remote image domains for every patch.
      '@next/next/no-img-element': 'off',
    },
  },
]);
