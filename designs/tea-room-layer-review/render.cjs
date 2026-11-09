'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function render() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1688, height: 780 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto('http://127.0.0.1:4311/tea-room-layer-review/index.html');
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode()));
    });
    assert.equal(await page.locator('.card').count(), 25);
    assert.equal(await page.locator('.back').count(), 8);
    assert.equal(await page.locator('.person').count(), 3);
    const captureOptions = { style: '.review-tools { visibility: hidden !important; }' };
    await page.screenshot({ path: path.join(__dirname, 'preview-1688.png'), ...captureOptions });
    await page.getByRole('button', { name: '纯素材叠图' }).click();
    assert.equal(await page.locator('.game-ui').isVisible(), false);
    await page.screenshot({ path: path.join(__dirname, 'layers-1688.png'), ...captureOptions });
    await page.getByRole('button', { name: '牌局排版' }).click();
    assert.equal(await page.locator('.game-ui').isVisible(), true);
    for (const width of [844, 667]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 375 });
      await page.screenshot({ path: path.join(__dirname, `preview-${width}.png`), ...captureOptions });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const bounds = await page.locator('.board').boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, '画板不得被横向裁切');
    }
    assert.deepEqual(errors, []);
    const report = { cards: 25, bottomCards: 8, characters: 3, viewportWidths: [1688, 844, 667], switchModes: 'passed', errors, scope: '静态素材叠图与排版，不代表真实牌局或真机验收' };
    fs.writeFileSync(path.join(__dirname, 'review-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}

render().catch(error => { console.error(error); process.exitCode = 1; });
