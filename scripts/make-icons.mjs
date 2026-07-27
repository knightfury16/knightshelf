/**
 * Generates the PWA icon set from a single vector source.
 *
 * The mark is three books of uneven height on a shelf — pure geometry, no text,
 * so it survives scaling down to a 48dp Android launcher icon and needs no font
 * installed at build time.
 *
 * Run with: npm run icons
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const VERMILION = '#a93a25';
const BONE = '#f2eee4';

/** @param {number} scale 1 = full bleed; below 1 insets art for the maskable safe zone. */
function artwork(scale) {
  const books = [
    { x: 142, y: 196, h: 200 },
    { x: 222, y: 156, h: 240 },
    { x: 302, y: 228, h: 168 },
  ];

  const shapes = [
    `<rect x="110" y="396" width="292" height="13" rx="3" fill="${BONE}"/>`,
    ...books.map(
      (b) => `<rect x="${b.x}" y="${b.y}" width="68" height="${b.h}" rx="4" fill="${BONE}"/>`,
    ),
  ].join('');

  const group =
    scale === 1
      ? shapes
      : `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${shapes}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="${VERMILION}"/>
${group}
</svg>`;
}

const full = artwork(1);
// Maskable icons are cropped to an arbitrary launcher shape; keeping the art
// inside the central ~68% guarantees nothing important is clipped.
const masked = artwork(0.68);

await writeFile(join(PUBLIC_DIR, 'favicon.svg'), full, 'utf8');
process.stdout.write('wrote favicon.svg\n');

const targets = [
  { file: 'icon-192.png', size: 192, svg: full },
  { file: 'icon-512.png', size: 512, svg: full },
  { file: 'icon-maskable-512.png', size: 512, svg: masked },
  { file: 'apple-touch-icon.png', size: 180, svg: masked },
];

for (const { file, size, svg } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC_DIR, file));
  process.stdout.write(`wrote ${file} (${size}px)\n`);
}
