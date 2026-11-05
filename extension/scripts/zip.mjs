// Packs dist/ into release/link-click-<version>.zip for the Chrome Web Store.
// Dependency-free (Node >= 22 for zlib.crc32). Run via `npm run zip`.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run `npm run build` first.');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// MS-DOS timestamp for "now" (0 is an invalid date that some tools reject).
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const files = walk(dist).filter((p) => !p.endsWith('.map')); // no sourcemaps in store builds
const local = [];
const central = [];
let offset = 0;

for (const file of files) {
  const name = Buffer.from(relative(dist, file).split('\\').join('/'));
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data) >>> 0;

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);   // version needed
  lh.writeUInt16LE(0x0800, 6); // UTF-8 names
  lh.writeUInt16LE(8, 8);    // deflate
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  local.push(lh, name, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(dosTime, 12);
  ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);
  offset += lh.length + name.length + comp.length;
}

const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `link-click-${version}.zip`);
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`${relative(root, out)} (${files.length} files)`);
