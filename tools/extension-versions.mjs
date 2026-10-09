import { readFile, writeFile } from 'node:fs/promises';
import { FAMILY_EXTENSIONS, parseUpdateFeed } from '../shared/update-logic.js';

const root = new URL('../', import.meta.url);
const feed = { schema: 1, extensions: {} };
for (const [key, entry] of Object.entries(FAMILY_EXTENSIONS)) {
  const manifest = JSON.parse(await readFile(new URL(`${entry.directory}/manifest.json`, root), 'utf8'));
  feed.extensions[key] = { version: manifest.version };
}
parseUpdateFeed(feed);
const content = `${JSON.stringify(feed, null, 2)}\n`;
const destination = new URL('extension-versions.json', root);
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== content) throw new Error('Version feed differs from local manifests. Regenerate after reviewing release versions.');
  console.log('Checked extension version feed.');
} else {
  await writeFile(destination, content);
  console.log('Prepared local version feed. No files were published.');
}
