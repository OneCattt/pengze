'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'results');
const url = pathToFileURL(path.join(root, '彭泽三打一_原型验证.html')).href;
const checks = [];
const errors = [];
const externalRequests = [];

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PENGZE_CHROMIUM || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'home-844.png') });
    assert.equal(await page.locator('.home-title').textContent(), '三打一');
    assert.ok(await page.evaluate(() => document.fonts.check('16px "Pengze Serif"')));
    checks.push('file协议直接打开，首页及内嵌字体正常');

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/cards/manifest.json')));
    const decodedFaces = await page.evaluate(async () => {
      return Promise.all(Object.entries(PENGZE_CARD_ART).map(async ([key, src]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return { key, width: image.naturalWidth, height: image.naturalHeight, src };
      }));
    });
    assert.equal(decodedFaces.length, 54);
    for (const face of decodedFaces) {
      const expected = manifest.cards[face.key];
      assert.ok(expected, `未登记牌面${face.key}`);
      assert.equal(face.width, 240);
      assert.equal(face.height, 336);
      assert.equal(face.src, `data:image/webp;base64,${fs.readFileSync(path.join(root, 'assets/cards', expected.file)).toString('base64')}`);
    }
    const identity = await page.evaluate(() => {
      const cards = window.PengzeRules.deck();
      return { ids: new Set(cards.map(card => card.id)).size, faces: new Set(cards.map(card => PENGZE_CARD_ART[`${card.suit}${card.rank}`])).size, missing: cards.some(card => !PENGZE_CARD_ART[`${card.suit}${card.rank}`]) };
    });
    assert.deepEqual(identity, { ids: 108, faces: 54, missing: false });
    checks.push('54种内嵌牌面全部可解码、尺寸与文件正确，108张实体牌保留独立身份');

    for (const scene of ['bid', 'trump', 'bury', 'result', 'allpass', 'ai']) {
      await page.goto(`${url}?review=${scene}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `${scene}-844.png`) });
      assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 0);
    }
    checks.push('六个关键状态可打开，静态评审没有运行计时器');

    await page.goto(`${url}?review=bury`);
    assert.equal(await page.locator('.hand-fan .poker-card').count(), 33);
    assert.equal(await page.locator('.hand-fan .selected').count(), 3);
    assert.equal(await page.locator('[data-action="bury"]').isDisabled(), true);
    const visibleCorners = await page.locator('.hand-fan [data-card]').evaluateAll(elements => elements.every((element, index) => {
      const card = window.PengzeValidation.game.hands[0].find(card => card.id === element.dataset.card);
      const image = element.querySelector('.card-art');
      const cornerElement = element.querySelector('.corner');
      if (element.dataset.face !== `${card.suit}${card.rank}`) return false;
      if (index === elements.length - 1) return !cornerElement && image?.src === PENGZE_CARD_ART[element.dataset.face] && getComputedStyle(image).pointerEvents === 'none';
      const corner = cornerElement.getBoundingClientRect();
      const edge = elements[index + 1]?.getBoundingClientRect().left ?? element.getBoundingClientRect().right;
      return !image && corner.right <= edge + .5 && cornerElement.textContent === `${window.PengzeRules.RANK_NAMES[card.rank] || card.rank}${card.suit === 'J' ? '王' : window.PengzeRules.SUIT_SYMBOLS[card.suit]}`;
    }));
    assert.ok(visibleCorners, '33张手牌的角标完整露出且牌面映射正确');
    checks.push('33张手牌牌面对应实际卡牌，重叠角标完整可见，图片不拦截选牌');
    await page.locator('.hand-fan .selected').first().click({ position: { x: 6, y: 6 } });
    assert.equal(await page.locator('.hand-fan .selected').count(), 2);
    await page.evaluate(() => {
      const api = window.PengzeValidation;
      const selected = api.selected.slice();
      for (const id of selected) document.querySelector(`.hand-fan [data-card="${id}"]`).click();
    });
    assert.equal(await page.locator('.hand-fan .selected').count(), 0);
    const eightIds = await page.locator('.hand-fan [data-card]').evaluateAll(elements => elements.slice(0, 8).map(element => element.dataset.card));
    for (const id of eightIds) await page.locator(`.hand-fan [data-card="${id}"]`).click({ position: { x: 6, y: 6 } });
    assert.equal(await page.locator('[data-action="bury"]').isEnabled(), true);
    const ninthId = await page.locator('.hand-fan [data-card]').nth(8).getAttribute('data-card');
    await page.locator(`.hand-fan [data-card="${ninthId}"]`).click({ position: { x: 6, y: 6 } });
    assert.equal(await page.locator('.hand-fan .selected').count(), 8);
    await page.locator('[data-action="bury"]').click();
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.phase), 'burying');
    assert.equal(await page.locator('.bury-card').count(), 8);
    assert.equal(await page.locator('.bury-card .card-art').count(), 8);
    assert.equal(await page.locator('.bury-card .corner').count(), 0);
    assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 0);
    await page.waitForTimeout(280);
    await page.screenshot({ path: path.join(output, 'bury-animation-844.png') });
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'playing');
    assert.equal(await page.locator('.hand-fan .poker-card').count(), 25);
    assert.equal(await page.locator('.bottom-pile .card-back').count(), 8);
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.bottom.map(card => card.id).sort()), eightIds.slice().sort());
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.actor), 0);
    checks.push('33张真实可选，取消/8张上限/禁用按钮/翻面下沉/8张落底与数据一致');

    await page.evaluate(() => window.PengzeValidation.scenario('throwPair', true));
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.play-zone-0 .poker-card').length === 2);
    assert.equal(await page.locator('.play-zone-0 .card-art').count(), 2);
    assert.equal(await page.locator('.play-zone-0 .corner').count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ count: window.PengzeValidation.game.hands[0].length, penalty: window.PengzeValidation.game.penalty, actual: window.PengzeValidation.game.actual })), { count: 23, penalty: 20, actual: 0 });
    await page.screenshot({ path: path.join(output, 'throw-failure-844.png') });
    checks.push('甩错对子只实际出2张、扣20分，另外两张保留');

    await page.evaluate(() => window.PengzeValidation.scenario('ai', true));
    assert.equal(await page.locator('.toast.show').count(), 0);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.hands[1].length), 33);
    assert.equal(await page.locator('.hand-fan .poker-card').count(), 25);
    assert.equal(await page.locator('[data-seat="1"] .seat-count').textContent(), '手牌 33');
    assert.equal(await page.locator('.bottom-pile .poker-card').count(), 0);
    checks.push('AI收底33张可见数量，原底牌与对手手牌不泄露');

    await page.evaluate(() => window.PengzeValidation.scenario('result', true));
    assert.equal(await page.locator('.toast.show').count(), 0);
    assert.equal(await page.locator('#toast').isVisible(), false);
    await page.locator('[data-action="result-details"]').click();
    const rows = await page.locator('.result-table tbody tr').allTextContents();
    assert.ok(rows[0].includes('−30') && rows[0].includes('+15') && rows[0].includes('−15元'));
    assert.ok(rows[1].includes('+10') && rows[1].includes('−15') && rows[1].includes('−5元'));
    assert.equal(await page.locator('.mini-bottom-cards .poker-card').count(), 8);
    assert.equal(await page.locator('.mini-bottom-cards .card-art').count(), 8);
    assert.equal(await page.locator('.mini-bottom-cards .corner').count(), 0);
    await page.screenshot({ path: path.join(output, 'result-details-844.png') });
    checks.push('结算明细使用文档样本，分清游戏分、正常金额和额外转账');

    for (const viewport of [{ width: 667, height: 375 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.PengzeValidation.scenario('bury', true));
      assert.equal(await page.locator('.hand-fan [data-card]').count(), 33);
      const allVisible = await page.locator('.hand-fan [data-card]').evaluateAll(elements => elements.every(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.top + 10 <= innerHeight;
      }));
      assert.ok(allVisible);
      await page.screenshot({ path: path.join(output, `bury-${viewport.width}.png`) });
      await page.locator('[data-action="expand"]').click();
      assert.equal(await page.locator('.expanded-grid [data-card]').count(), 33);
      await page.locator('.expanded-grid [data-card]').nth(30).click();
      assert.equal(await page.locator('.expanded-grid .selected').count(), 4);
      await page.screenshot({ path: path.join(output, `expanded-${viewport.width}.png`) });
    }
    checks.push('667小屏与1440桌面33张无横向溢出，展开态末排可操作');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.portrait-guide').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'portrait-390.png') });
    checks.push('竖屏引导可见');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(`${url}?speed=fast`);
    await page.locator('[data-action="start"]').click();
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'bidding' && window.PengzeValidation.game.actor === 0);
    assert.equal(await page.locator('.hand-fan .poker-card').count(), 25);
    assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 1);
    const originalDeadline = await page.evaluate(() => window.PengzeValidation.deadline);
    await page.locator('#bid-value').fill('205');
    assert.equal(await page.evaluate(() => window.PengzeValidation.deadline), originalDeadline);
    await page.locator('[data-action="bid"]').click();
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'trump');
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.highest), 205);
    assert.equal(await page.locator('.hand-fan .poker-card').count(), 33);
    await page.locator('[data-action="trump"]').click();
    const buryIds = await page.locator('.hand-fan [data-card]').evaluateAll(elements => elements.slice(0, 8).map(element => element.dataset.card));
    for (const id of buryIds) await page.locator(`.hand-fan [data-card="${id}"]`).click({ position: { x: 6, y: 6 } });
    await page.locator('[data-action="bury"]').click();
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'playing' && window.PengzeValidation.timerCount === 1);
    const playingVersion = await page.evaluate(() => window.PengzeValidation.game.version);
    await page.evaluate(() => window.PengzeValidation.expireNow());
    await page.waitForFunction(() => window.PengzeValidation.game.managed === true);
    await page.waitForFunction(() => window.PengzeValidation.game.phase === 'result', null, { timeout: 30000 });
    assert.ok(await page.evaluate(version => window.PengzeValidation.game.version > version + 4, playingVersion));
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), true);
    assert.equal(await page.evaluate(() => window.PengzeValidation.timerCount), 0);
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.hands.map(hand => hand.length)), [0, 0, 0, 0]);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.result.net.reduce((sum, value) => sum + value, 0)), 0);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.history.length), 1);
    await page.screenshot({ path: path.join(output, 'full-game-result-844.png') });
    checks.push('真实浏览器完整牌局：发牌→205分叫分→33张→定主→扣底→超时持续托管→全部出完→结算');

    const totals = await page.evaluate(() => window.PengzeValidation.game.totals.slice());
    const first = await page.evaluate(() => window.PengzeValidation.game.first);
    await page.locator('[data-action="next"]').click();
    await page.evaluate(() => window.PengzeValidation.freeze());
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.round), 2);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.first), (first + 1) % 4);
    assert.deepEqual(await page.evaluate(() => window.PengzeValidation.game.totals), totals);
    checks.push('下一局保留累计、局数递增、首叫轮换，清除旧计时');

    await page.goto(`${url}?review=bid&speed=fast`);
    await page.evaluate(() => window.PengzeValidation.freeze(false));
    const clockStarted = Date.now();
    const remaining = await page.evaluate(() => window.PengzeValidation.deadline - Date.now());
    assert.ok(remaining > 19500 && remaining <= 20000);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.PengzeValidation.game.managed), false);
    const displayed = Number(await page.locator('[data-countdown]').textContent());
    assert.ok(displayed >= 18 && displayed <= 19);
    await page.waitForFunction(() => window.PengzeValidation.game.managed, null, { timeout: 22500 });
    const elapsed = Date.now() - clockStarted;
    assert.ok(elapsed >= 19500 && elapsed < 22500, `实际超时耗时${elapsed}毫秒`);
    await page.evaluate(() => window.PengzeValidation.freeze());
    checks.push(`真实等待20秒触发托管，实测${elapsed}毫秒，操作倒计时只有一个`);

    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    checks.push('无浏览器运行错误，无外部运行依赖请求');
    const artifact = fs.readFileSync(path.join(root, '彭泽三打一_原型验证.html'));
    const report = { date: '2026-11-08', artifactSha256: crypto.createHash('sha256').update(artifact).digest('hex'), figma: { fileKey: 'dROznof43d5cVxGKNj5vxM', nodeId: '2:7486' }, passed: checks.length, checks, errors, externalRequests, boundary: '本地Chromium与file协议验证；非微信真机验收，复杂混合甩牌仍以文档边界为准。' };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
