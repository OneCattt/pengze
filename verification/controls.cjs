'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifact = path.join(root, '彭泽三打一_原型验证.html');
const url = pathToFileURL(artifact).href;
const output = path.join(__dirname, 'results');

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PENGZE_CHROMIUM || undefined });
  const checks = [];
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    page.on('pageerror', error => errors.push(error.message));
    // 捕获旧回调，验证取消托管后旧计时器不会清除新的真人计时器。
    await page.addInitScript(() => {
      const original = window.setInterval;
      window.__controlTimers = [];
      window.setInterval = function (callback, delay, ...args) {
        window.__controlTimers.push(callback);
        return original(callback, delay, ...args);
      };
    });
    async function scene(id) {
      await page.goto(`${url}?review=${id}`);
      await page.evaluate(() => document.fonts.ready);
    }
    async function exit() {
      await page.locator('.table-header [data-action="exit"]').click();
      await page.locator('[data-action="confirm-exit"]').click();
      assert.equal(await page.evaluate(() => window.PengzeValidation.game.phase), 'home');
      assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 0);
      assert.equal(await page.locator('.motion-layer>*').count(), 0);
    }
    async function unchangedHome(delay) {
      const version = await page.evaluate(() => window.PengzeValidation.game.version);
      await page.waitForTimeout(delay);
      assert.deepEqual(await page.evaluate(() => ({ phase: window.PengzeValidation.game.phase, version: window.PengzeValidation.game.version, timer: window.PengzeValidation.timerCount })), { phase: 'home', version, timer: 0 });
    }

    await scene('bury');
    const metrics = await page.evaluate(async () => {
      const label = document.querySelector('.hand-fan .corner>span:first-child');
      const style = getComputedStyle(label);
      await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`);
      const context = document.createElement('canvas').getContext('2d');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return [...'23456789'].map(digit => {
        const box = context.measureText(digit);
        return { digit, ascent: box.actualBoundingBoxAscent, descent: box.actualBoundingBoxDescent, width: box.width };
      });
    });
    for (const field of ['ascent', 'descent', 'width']) assert.ok(Math.max(...metrics.map(item => item[field])) - Math.min(...metrics.map(item => item[field])) < .5, `数字${field}不一致`);
    await page.screenshot({ path: path.join(output, 'hand-digits-844.png') });
    checks.push('手牌2至9采用等高等宽数字，顶线、基线与宽度差均小于0.5px');

    for (const id of ['bid', 'trump', 'bury', 'play']) {
      await scene(id);
      await page.evaluate(() => { const api = window.PengzeValidation; api.game.expire(api.game.version); api.freeze(false); });
      const oldTimer = await page.evaluate(() => window.__controlTimers.length - 1);
      if (id === 'play') await page.screenshot({ path: path.join(output, 'controls-managed-844.png') });
      await page.locator('[data-action="resume"]').click();
      const version = await page.evaluate(() => window.PengzeValidation.game.version);
      const deadline = await page.evaluate(() => window.PengzeValidation.deadline);
      assert.ok(deadline - Date.now() > 19000);
      await page.evaluate(index => window.__controlTimers[index](), oldTimer);
      assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 1);
      assert.equal(await page.evaluate(() => window.PengzeValidation.deadline), deadline);
      await page.waitForTimeout(850);
      assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
      assert.equal(await page.evaluate(() => window.PengzeValidation.game.version), version);
      if (id === 'play') await page.screenshot({ path: path.join(output, 'controls-resumed-844.png') });
      checks.push(`${id}阶段取消托管恢复20秒，原700ms自动操作失效，旧回调不清除新计时器`);
    }

    await scene('bury');
    await page.evaluate(() => { const api = window.PengzeValidation; api.game.expire(api.game.version); api.freeze(false); });
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'burying');
    await page.locator('[data-action="resume"]').click();
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'playing');
    const buriedVersion = await page.evaluate(() => window.PengzeValidation.game.version);
    await page.waitForTimeout(850);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.version), buriedVersion);
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.hands.map(hand => hand.length)), [25, 25, 25, 25]);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.bottom.length), 8);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 1);
    checks.push('扣底翻面途中取消托管，8张动画及数据完成，真人首攻恢复手动');

    await scene('play');
    await page.evaluate(() => { const api = window.PengzeValidation; api.game.expire(api.game.version); api.freeze(false); });
    await page.waitForFunction(() => window.PengzeValidation.actionInProgress);
    const committedHandCount = await page.evaluate(() => window.PengzeValidation.game.hands[0].length);
    await page.locator('[data-action="resume"]').click();
    await page.waitForFunction(() => !window.PengzeValidation.actionInProgress);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    assert.ok(committedHandCount < 25);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.hands[0].length), committedHandCount);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.actor), 1);
    await exit();
    await unchangedHome(850);
    checks.push('出牌飞行动画途中取消托管，已提交的牌完成；随后退出使AI待执行操作失效');

    await scene('bid');
    await page.evaluate(() => window.PengzeValidation.freeze(false));
    const deadline = await page.evaluate(() => window.PengzeValidation.deadline);
    await page.locator('[data-action="exit"]').click();
    await page.screenshot({ path: path.join(output, 'exit-confirm-844.png') });
    await page.locator('.exit-panel [data-action="close"]').click();
    assert.equal(await page.evaluate(() => window.PengzeValidation.deadline), deadline);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.phase), 'bidding');
    await exit();
    checks.push('退出入口有确认，继续游戏保持原行动及原倒计时，确认退出后计时归零');

    for (const id of ['pickup', 'bury8', 'collecting']) {
      await scene(id === 'collecting' ? 'play' : id);
      if (id === 'bury8') await page.locator('[data-action="bury"]').click();
      else await page.evaluate(collecting => {
        const api = window.PengzeValidation;
        if (collecting) for (let index = 0; index < 4; index += 1) api.game.play(api.game.actor, api.game.aiPlay(api.game.actor));
        api.freeze(false);
      }, id === 'collecting');
      await exit();
      await unchangedHome(1200);
      checks.push(`${id}动画期间退出，旧动画及回调不再推进牌局`);
    }

    await scene('allpass');
    const history = await page.evaluate(() => JSON.stringify(window.PengzeValidation.game.history));
    const totals = await page.evaluate(() => window.PengzeValidation.game.totals.slice());
    await page.locator('[data-action="next"]').click();
    await exit();
    assert.equal(await page.evaluate(() => JSON.stringify(window.PengzeValidation.game.history)), history);
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.totals), totals);
    await page.locator('[data-action="start"]').click();
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'bidding');
    await page.evaluate(() => window.PengzeValidation.freeze());
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.hands.map(hand => hand.length)), [25, 25, 25, 25]);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.bottom.length), 8);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.PengzeValidation.game.history)), history);
    checks.push('发牌途中退出后立即重开，旧发牌循环失效，108张正确分配且保留已完成局累计');

    await scene('result');
    const settledTotals = await page.evaluate(() => window.PengzeValidation.game.totals.slice());
    const settledHistory = await page.evaluate(() => JSON.stringify(window.PengzeValidation.game.history));
    await page.evaluate(() => { window.PengzeValidation.game.managed = true; window.PengzeValidation.refresh(); });
    await page.locator('.result-panel [data-action="resume"]').click();
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 0);
    await page.locator('.result-panel [data-action="exit"]').click();
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.phase), 'home');
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.totals), settledTotals);
    assert.equal(await page.evaluate(() => JSON.stringify(window.PengzeValidation.game.history)), settledHistory);
    checks.push('结算页可取消托管及返回首页，已结算金额和历史保持不变');

    await page.setViewportSize({ width: 667, height: 375 });
    await scene('play');
    await page.evaluate(() => { window.PengzeValidation.game.expire(window.PengzeValidation.game.version); window.PengzeValidation.refresh(); });
    for (const action of ['resume', 'exit', 'rules']) assert.ok(await page.locator(`.table-header [data-action="${action}"]`).isVisible());
    await page.screenshot({ path: path.join(output, 'controls-667.png') });
    await page.locator('[data-action="resume"]').click();
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    await exit();
    checks.push('667横屏取消托管、退出及规则入口可见且可操作');

    assert.deepEqual(errors, []);
    const report = { artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'), passed: checks.length, checks, digitMetrics: metrics, errors, boundary: '本地Chromium验证；退出的正式奖罚仍待确认。' };
    fs.writeFileSync(path.join(output, 'controls-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
