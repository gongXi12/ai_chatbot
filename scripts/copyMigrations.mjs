import { cp, mkdir } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../database/migrations/', import.meta.url));
const destination = fileURLToPath(new URL('../dist/database/migrations/', import.meta.url));
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });