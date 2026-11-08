'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const fonts = ['serif', 'sans'].map(family => {
  const filename = path.join(root, 'assets', `${family}.woff2`);
  return `@font-face{font-family:'Pengze ${family === 'serif' ? 'Serif' : 'Sans'}';src:url(data:font/woff2;base64,${fs.readFileSync(filename).toString('base64')}) format('woff2');font-weight:100 900;font-display:swap;}`;
}).join('\n');
const output = read('src/page.html')
  .replace('__FONTS__', fonts)
  .replace('__STYLE__', read('src/style.css'))
  .replace('__RULES__', read('src/rules.js'))
  .replace('__APP__', read('src/app.js'));
fs.writeFileSync(path.join(root, '彭泽三打一_原型验证.html'), output);
console.log(`已生成单文件HTML：${Buffer.byteLength(output)}字节`);
