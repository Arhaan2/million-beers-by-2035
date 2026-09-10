import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function filesUnder(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const name = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(name) : [name];
    }),
  );
  return nested.flat();
}

export async function apiSourceTag() {
  const files = [
    ...(await filesUnder('apps/api/src')),
    ...(await filesUnder('apps/api/migrations')),
    'apps/api/wrangler.jsonc',
    'apps/api/package.json',
    'package-lock.json',
  ].sort();
  const hash = createHash('sha256');
  for (const name of files) {
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path.join(root, name)))
      .update('\0');
  }
  return `crew-${hash.digest('hex').slice(0, 40)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await apiSourceTag());
}
