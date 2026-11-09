'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'designs/tea-room-layer-review');
const output = path.join(root, 'assets/scene');
const sizes = { room: [1688, 780], table: [1700, 514], 'player-left': [302, 444], 'player-top': [360, 332], 'player-right': [348, 390] };

async function run() {
  const sources = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'asset-manifest.json'), 'utf8'));
  fs.mkdirSync(output, { recursive: true });
  const images = {};
  for (const [name, [width, height]] of Object.entries(sizes)) {
    const source = path.join(sourceRoot, sources[name].preview);
    const file = `${name}.webp`;
    const image = await sharp(source).resize(width, height, { fit: name === 'room' ? 'cover' : 'fill' }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(output, file), image);
    images[name] = { file, width, height, bytes: image.length, sha256: crypto.createHash('sha256').update(image).digest('hex'), source: `designs/tea-room-layer-review/${sources[name].source}`, sourceSha256: sources[name].sourceSha256 };
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ source: '用户提供的五张茶室和人物素材', images }, null, 2) + '\n');
  console.log(`已准备${Object.keys(images).length}张场景素材，共${Object.values(images).reduce((sum, image) => sum + image.bytes, 0)}字节`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
