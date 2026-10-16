import { cp, mkdir } from 'node:fs/promises';
await mkdir('.next/standalone/.next', { recursive: true });
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
await cp('drizzle', '.next/standalone/drizzle', { recursive: true });
console.log('独立服务器部署包：.next/standalone');
