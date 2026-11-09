'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifact = path.join(root, '彭泽三打一_原型验证.html');
const output = path.join(__dirname, 'results');
const url = pathToFileURL(artifact).href;

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PENGZE_CHROMIUM || undefined });
  const errors = [];
  const requests = [];
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(url);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll('.scene-image'), image => image.decode()));
      window.__originalSceneImages = Array.from(document.querySelectorAll('.scene-image'));
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/scene/manifest.json')));
    for (const [name, source] of Object.entries(manifest.images)) {
      const actual = await page.locator(`.scene-${name}`).evaluate(image => ({ source: image.src, width: image.naturalWidth, height: image.naturalHeight }));
      const bytes = fs.readFileSync(path.join(root, 'assets/scene', source.file));
      assert.equal(actual.source, `data:image/webp;base64,${bytes.toString('base64')}`);
      assert.equal(actual.width, source.width);
      assert.equal(actual.height, source.height);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
    }
    assert.equal(await page.locator('.scene-player-left').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'scene-home-844.png') });
    checks.push('五张运行时素材按清单内嵌并解码，首页显示茶室背景');

    for (const width of [844, 667, 1440]) {
      await page.setViewportSize({ width, height: width === 667 ? 375 : width === 1440 ? 900 : 390 });
      await page.waitForFunction(() => Math.abs(document.getElementById('board').getBoundingClientRect().width - Math.min(innerWidth / 844, innerHeight / 390) * 844) < .5);
      for (const id of ['bid', 'trump', 'bury', 'play', 'ai', 'result', 'allpass']) {
        await page.evaluate(id => window.PengzeValidation.scenario(id, true), id);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('.scene-player-left').isVisible(), true);
        assert.equal(await page.locator('.scene-player-top').isVisible(), true);
        assert.equal(await page.locator('.scene-player-right').isVisible(), true);
        assert.equal(await page.evaluate(() => window.__originalSceneImages.every(image => image.isConnected)), true);
        const layout = await page.evaluate(() => {
          const board = document.getElementById('board').getBoundingClientRect();
          const controls = document.querySelector('.controls')?.getBoundingClientRect();
          const hand = Array.from(document.querySelectorAll('.hand-fan .poker-card'), card => card.getBoundingClientRect());
          const brand = document.querySelector('.brand').getBoundingClientRect();
          const summary = document.querySelector('.score-summary').getBoundingClientRect();
          const actions = document.querySelector('.header-actions').getBoundingClientRect();
          return {
            boardVisible: board.left >= -1 && board.right <= innerWidth + 1 && board.top >= -1 && board.bottom <= innerHeight + 1,
            cardsVisible: hand.every(rect => rect.left >= board.left - 1 && rect.right <= board.right + 1 && rect.top >= board.top && rect.bottom <= board.bottom + 1),
            controlsSeparate: !controls || hand.every(rect => rect.top >= controls.bottom - .5),
            headerSeparate: brand.right <= summary.left && summary.right <= actions.left,
            noOverflow: document.documentElement.scrollWidth <= innerWidth,
            cardsClickable: window.PengzeValidation.game.phase === 'result' || Array.from(document.querySelectorAll('.hand-fan .poker-card')).every(card => {
              const rect = card.getBoundingClientRect();
              return document.elementFromPoint(rect.left + 3, rect.top + 3)?.closest('[data-card]') === card;
            }),
          };
        });
        for (const [condition, passed] of Object.entries(layout)) assert.ok(passed, `${width}px/${id}：${condition}`);
        await page.screenshot({ path: path.join(output, `scene-${id}-${width}.png`), animations: 'disabled' });
      }
      checks.push(`${width}px七个阶段：人物固定复用，手牌完整、抬牌与操作区分离，顶部信息不重叠`);
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      const api = window.PengzeValidation;
      api.scenario('play', true);
      while (api.game.trick.length < 4) api.game.play(api.game.actor, api.game.aiPlay(api.game.actor));
      api.refresh();
    });
    assert.equal(await page.locator('.play-zone').count(), 4);
    const separate = await page.evaluate(() => {
      const bottom = document.querySelector('.bottom-pile').getBoundingClientRect();
      const status = document.querySelector('.center-status').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.play-zone,.trick-caption'), zone => zone.getBoundingClientRect()).every(rect => {
        const overlapsBottom = rect.left < bottom.right && rect.right > bottom.left && rect.top < bottom.bottom && rect.bottom > bottom.top;
        return !overlapsBottom && rect.bottom <= status.top;
      });
    });
    assert.ok(separate, '四家出牌不得遮住底牌或收墩提示');
    await page.screenshot({ path: path.join(output, 'scene-four-plays-844.png') });
    checks.push('真实牌局四家出牌与底牌、收墩提示分离');

    await page.evaluate(() => window.PengzeValidation.scenario('bury', true));
    await page.locator('[data-action="expand"]').click();
    assert.equal(await page.locator('.expanded-grid [data-card]').count(), 33);
    await page.locator('.expanded-grid [data-card]').last().click();
    assert.equal(await page.locator('.expanded-grid .selected').count(), 4);
    await page.screenshot({ path: path.join(output, 'scene-expanded-844.png') });
    checks.push('场景图层不拦截展开区末张选牌，33张牌均存在');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    const report = { date: '2026-11-09', artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), passed: checks.length, checks, errors, requests, boundary: '本地Chromium下的实际HTML与真实牌局数据；非微信真机验收' };
    fs.writeFileSync(path.join(output, 'scene-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
