import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const family = path.resolve(root, '../isi/family');
const check = process.argv.includes('--check');
const targets = ['Islandsun-Portal-Workspace', 'Islandsun-Revenue', 'IslandSun-AutoFeedback'];
const familyFiles = ['css/tokens.css', 'css/components.css', 'css/notifications.css', 'css/theme-control.css', 'css/extension-popup.css', 'css/row-hover.css', 'js/row-hover.js', 'js/theme.js', 'js/theme-control.js', 'js/notifications.js', 'js/toast-card.js', 'js/notice-motion.js', 'assets/icons/family.svg'];
const files = new Map();
for (const name of await readdir(path.join(root, 'shared'))) if (name.endsWith('.js')) files.set(`js/shared/${name}`, await readFile(path.join(root, 'shared', name)));
for (const name of familyFiles) files.set(`assets/family/${name}`, await readFile(path.join(family, name)));
const hash = value => createHash('sha256').update(value).digest('hex');
const version = JSON.parse(await readFile(path.join(family, 'family-manifest.json'), 'utf8')).version;
for (const target of targets) {
  const targetFiles = new Map([...files].filter(([name]) => target === 'Islandsun-Portal-Workspace' || name.startsWith('js/shared/update-')));
  targetFiles.set('css/update-popup.css', await readFile(path.join(root, 'shared/update-popup.css')));
  const manifest = `${JSON.stringify({ familyVersion: version, files: Object.fromEntries([...targetFiles].map(([name, value]) => [name, hash(value)])) }, null, 2)}\n`;
  const directory = path.join(root, target);
  const manifestPath = path.join(directory, 'managed-assets.json');
  let previous = null;
  try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const [name, content] of [...targetFiles, ['managed-assets.json', Buffer.from(manifest)]]) {
    const destination = path.join(directory, name);
    let existing;
    try { existing = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing?.equals(content)) continue;
    if (check) throw new Error(`${target}/${name} is missing or differs.`);
    if (existing && name !== 'managed-assets.json' && hash(existing) !== previous?.files[name]) throw new Error(`${target}/${name} has local edits. Reconcile before synchronizing.`);
    await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, content);
  }
  console.log(`${check ? 'Checked' : 'Synchronized'} ${target}; family ${version}`);
}
