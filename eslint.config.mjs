import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['ecosystem.config.cjs'],
    // PM2's ecosystem file is CommonJS even when the application uses ESM.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    '.vinext/**',
    '.wrangler/**',
    '.sites-runtime/**',
    'outputs/**',
    'public/**',
    '.pm2/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
