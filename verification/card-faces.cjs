'use strict';

// 将真实展开区与隐藏附加角标后的原始图片对照，检测完整牌面是否被遮挡。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'results');
const artifact = path.join(root, '彭泽三打一_原型验证.html');

async function samePixels(page, first, second) {
  if (first.equals(second)) return true;
  // 忽略PNG编码及少量抗锯齿差异；成片角标遮挡或图案重影应触发失败。
  const difference = await page.evaluate(async ([first, second]) => {
    const images = await Promise.all([first, second].map(async data => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }));
    if (images[0].width !== images[1].width || images[0].height !== images[1].height) return 1;
    const canvas = document.createElement('canvas');
    canvas.width = images[0].width;
    canvas.height = images[0].height;
    const context = canvas.getContext('2d');
    const pixels = images.map(image => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
    let changed = 0;
    for (let index = 0; index < pixels[0].length; index += 4) {
      if ([0, 1, 2, 3].some(channel => Math.abs(pixels[0][index + channel] - pixels[1][index + channel]) > 16)) changed += 1;
    }
    return changed / (canvas.width * canvas.height);
  }, [first.toString('base64'), second.toString('base64')]);
  return difference <= .001;
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PENGZE_CHROMIUM || undefined });
  const checks = [];
  const failures = [];
  try {
    const page = await browser.newPage();
    for (const width of [667, 844, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 390 });
      await page.goto(`${pathToFileURL(artifact).href}?review=bury`);
      await page.evaluate(() => document.fonts.ready);
      for (const face of ['H11', 'H10', 'D5', 'D4']) {
        await page.locator(`.hand-fan [data-face="${face}"]`).first().click({ position: { x: 6, y: 6 } });
      }
      assert.equal(await page.locator('.hand-fan .selected').count(), 7);
      await page.waitForTimeout(180);
      const raised = await page.locator('.board').screenshot({ animations: 'disabled' });
      const imageMask = await page.addStyleTag({ content: '.hand-fan .poker-card:not(:last-child) .card-art{visibility:hidden!important}' });
      const clean = await page.locator('.board').screenshot({ animations: 'disabled' });
      await imageMask.evaluate(element => element.remove());
      if (!await samePixels(page, raised, clean)) failures.push(`${width}px：选中7张抬牌时，原始牌面图案露入角标区`);
      else checks.push(`${width}px：选中7张抬牌，角标区无原始图案重影`);
      await page.screenshot({ path: path.join(output, `selected-cards-${width}.png`) });
      for (const [scene, count] of [['bid', 25], ['bury', 33]]) {
        await page.goto(`${pathToFileURL(artifact).href}?review=${scene}`);
        await page.evaluate(() => document.fonts.ready);
        await page.locator('[data-action="expand"]').click();
        await page.locator('.expanded-grid .card-art').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        await page.waitForTimeout(180);
        const grid = page.locator('.expanded-grid');
        assert.equal(await grid.locator('.card-art').count(), count);
        const actual = await grid.screenshot({ animations: 'disabled' });
        const referenceStyle = await page.addStyleTag({ content: '.expanded-grid .corner{visibility:hidden!important}' });
        const reference = await grid.screenshot({ animations: 'disabled' });
        await referenceStyle.evaluate(element => element.remove());
        if (!await samePixels(page, actual, reference)) failures.push(`${width}px / ${count}张：完整牌面被附加角标遮挡`);
        else checks.push(`${width}px：${count}张展开牌与原始图片显示一致，图案没有遮挡或裁剪`);
        assert.ok(await grid.locator('.card-art').evaluateAll(images => images.every(image => getComputedStyle(image).clipPath === 'none')), '展开区不应裁掉原始图案');
        await page.screenshot({ path: path.join(output, `native-${count}-${width}.png`) });
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
    const report = { artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), passed: checks.length, checks };
    fs.writeFileSync(path.join(output, 'full-face-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
