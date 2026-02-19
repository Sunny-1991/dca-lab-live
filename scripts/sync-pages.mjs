import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'public');
const targetDir = path.join(rootDir, 'docs');
const localDataDir = path.join(rootDir, 'data', 'market-cache');
const targetDataDir = path.join(targetDir, 'data', 'market-cache');

await mkdir(targetDir, { recursive: true });
for (const entry of await readdir(targetDir, { withFileTypes: true })) {
  const fullPath = path.join(targetDir, entry.name);
  await rm(fullPath, { recursive: true, force: true });
}

await cp(sourceDir, targetDir, { recursive: true });
await mkdir(path.dirname(targetDataDir), { recursive: true });
await cp(localDataDir, targetDataDir, { recursive: true });
await writeFile(path.join(targetDir, '.nojekyll'), '');
console.log('synced docs/ from public/');
