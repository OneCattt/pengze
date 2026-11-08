'use strict';

// 固定上游版本，保存原始矢量牌面及授权，再生成供页面使用的轻量图片。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const execute = promisify(execFile);

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets', 'cards');
const repository = 'AustinGabriel/Public-Domain-and-CC0-Playing-Cards';
const revision = '3765067c32fcef42a30e87022332db729658e7cd';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const rankNames = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
const suits = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' };
const cards = Object.entries(suits).flatMap(([suit, name]) => Array.from({ length: 13 }, (_, index) => {
  const rank = index + 2;
  return { key: `${suit}${rank}`, upstream: `svg cards/card fronts/${name}/${rankNames[rank] || rank} of ${name}.svg` };
}));
cards.push(
  { key: 'J15', upstream: 'svg cards/card fronts/jokers/black joker.svg' },
  { key: 'J16', upstream: 'svg cards/card fronts/jokers/red joker.svg' }
);

async function download(relative) {
  const endpoint = `repos/${repository}/contents/${relative.split('/').map(encodeURIComponent).join('/')}?ref=${revision}`;
  const { stdout } = await execute('gh', ['api', endpoint, '--header', 'Accept: application/vnd.github.raw+json'], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 45000 });
  return stdout;
}

async function run() {
  fs.mkdirSync(path.join(output, 'source'), { recursive: true });
  fs.mkdirSync(path.join(output, 'faces'), { recursive: true });
  const licenseFile = path.join(output, 'LICENSE-CC0.txt');
  if (!fs.existsSync(licenseFile)) fs.writeFileSync(licenseFile, await download('LICENSE'));
  const entries = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < cards.length) {
      const card = cards[cursor++];
      const source = `source/${card.key}.svg`;
      const file = `faces/${card.key}.webp`;
      const sourceFile = path.join(output, source);
      const svg = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile) : await download(card.upstream);
      fs.writeFileSync(sourceFile, svg);
      const image = await sharp(svg).resize(240, 336, { fit: 'contain' }).webp({ quality: 88, effort: 6 }).toBuffer();
      fs.writeFileSync(path.join(output, file), image);
      entries[card.key] = { upstream: card.upstream, source, file, width: 240, height: 336, bytes: image.length, sha256: digest(image), sourceSha256: digest(svg) };
    }
  }));
  const ordered = Object.fromEntries(cards.map(card => [card.key, entries[card.key]]));
  const sourceBytes = cards.reduce((total, card) => total + fs.statSync(path.join(output, entries[card.key].source)).size, 0);
  const imageBytes = cards.reduce((total, card) => total + entries[card.key].bytes, 0);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ repository: `https://github.com/${repository}`, revision, license: 'CC0-1.0', format: 'webp', sourceBytes, imageBytes, cards: ordered }, null, 2) + '\n');
  console.log(JSON.stringify({ cards: cards.length, sourceBytes, imageBytes, reduction: `${(100 * (1 - imageBytes / sourceBytes)).toFixed(1)}%` }, null, 2));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
