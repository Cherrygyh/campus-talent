import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
// Resolve before the generated server changes its working directory.
process.env.DATA_DIR = path.resolve(projectRoot, process.env.DATA_DIR || 'data');
process.env.HOSTNAME ||= '127.0.0.1';
await import(pathToFileURL(path.join(projectRoot, '.next/standalone/server.js')).href);
