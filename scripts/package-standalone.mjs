import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('.next/standalone/.next', { recursive: true });
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
await cp('drizzle', '.next/standalone/drizzle', { recursive: true });
await build({
  entryPoints: ['lib/registration-sync-worker.ts'],
  outfile: '.next/standalone/registration-sync-worker.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
});
console.log('独立服务器部署包：.next/standalone');
