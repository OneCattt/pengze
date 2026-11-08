'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Rules = require('../src/rules.js');
const results = [];
const card = (suit, rank, copy = 0) => ({ id: `${copy}-${suit}-${rank}`, suit, rank });
const pair = (suit, rank) => [card(suit, rank), card(suit, rank, 1)];

function check(name, action) {
  action();
  results.push({ name, status: 'passed' });
  console.log(`通过：${name}`);
}

function dealerGame(seed = 1, dealer = 0) {
  const game = new Rules.Game({ seed, first: 0 });
  game.start();
  game.finishDeal();
  for (let turn = 0; turn < 4; turn += 1) game.bid(game.actor, game.actor === dealer ? 80 : null);
  return game;
}

function assigned(preferences) {
  const game = new Rules.Game({ seed: 1, first: 0 });
  game.start();
  game.finishDeal();
  let pool = Rules.deck();
  game.hands = preferences.map(ids => ids.map(id => {
    const selected = pool.find(candidate => candidate.id === id);
    assert.ok(selected, id);
    pool = pool.filter(candidate => candidate.id !== id);
    return selected;
  }));
  pool = Rules.shuffle(pool, Rules.random(1440));
  for (const hand of game.hands) while (hand.length < 25) hand.push(pool.shift());
  game.bottom = pool;
  for (let turn = 0; turn < 4; turn += 1) game.bid(game.actor, game.actor === 0 ? 80 : null);
  game.finishPickup();
  game.chooseTrump(0, 'S');
  const protectedIds = new Set(preferences[0]);
  game.bury(0, game.hands[0].filter(candidate => !protectedIds.has(candidate.id)).slice(0, 8).map(candidate => candidate.id));
  game.finishBury();
  return game;
}

check('双副108张、实体唯一、每种牌两张、总分200', () => {
  const cards = Rules.deck();
  assert.equal(cards.length, 108);
  assert.equal(new Set(cards.map(candidate => candidate.id)).size, 108);
  assert.ok(Rules.groups(cards).every(group => group.length === 2));
  assert.equal(cards.filter(candidate => candidate.suit === 'J').length, 4);
  assert.equal(Rules.points(cards), 200);
});

check('先发牌后叫分，四人各25张、底牌8张', () => {
  const game = new Rules.Game({ seed: 4, first: 0 });
  game.start();
  assert.throws(() => game.bid(0, 80));
  for (let count = 0; count < 100; count += 1) game.dealOne();
  assert.equal(game.phase, 'dealing');
  game.dealOne();
  assert.equal(game.phase, 'bidding');
  assert.deepEqual(game.hands.map(hand => hand.length), [25, 25, 25, 25]);
  assert.equal(game.bottom.length, 8);
  game.assertIntegrity();
});

check('80起叫、5分步长、跳叫且无200分上限', () => {
  const game = new Rules.Game({ seed: 1, first: 0 });
  game.start(); game.finishDeal();
  assert.throws(() => game.bid(0, 75));
  assert.throws(() => game.bid(0, 81));
  game.bid(0, 205);
  assert.equal(game.phase, 'bidding');
  assert.throws(() => game.bid(1, 205));
  game.bid(1, 1000);
  game.bid(2, null);
  game.bid(3, null);
  assert.equal(game.actor, 0);
  game.bid(0, 1005);
  game.bid(1, null);
  assert.equal(game.dealer, 0);
  assert.equal(game.highest, 1005);
  assert.equal(game.phase, 'pickup');
});

check('全员不叫逐座位赔付、重复结算拦截、下一局轮换与累计', () => {
  for (let first = 0; first < 4; first += 1) {
    const game = new Rules.Game({ seed: 1, first });
    game.start(); game.finishDeal();
    for (let turn = 0; turn < 4; turn += 1) game.bid(game.actor, null);
    assert.equal(game.phase, 'result');
    assert.equal(game.totals[first], -30);
    assert.equal(game.totals.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(game.dealer, null);
    const totals = game.totals.slice();
    assert.throws(() => game.settle(game.result));
    assert.deepEqual(game.totals, totals);
    game.start();
    assert.equal(game.first, (first + 1) % 4);
    assert.equal(game.round, 2);
    assert.deepEqual(game.totals, totals);
    assert.equal(game.actual, 0);
    assert.equal(game.penalty, 0);
    assert.equal(game.trump, null);
  }
});

check('庄家必须25→33→25，收底和扣底完成前不能出牌', () => {
  for (let dealer = 0; dealer < 4; dealer += 1) {
    const game = dealerGame(2, dealer);
    assert.equal(game.hands[dealer].length, 33);
    assert.throws(() => game.chooseTrump(dealer, 'S'));
    game.finishPickup();
    assert.throws(() => game.chooseTrump(dealer, 'N'));
    game.chooseTrump(dealer, 'S');
    const ids = game.hands[dealer].slice(0, 8).map(candidate => candidate.id);
    assert.throws(() => game.bury(dealer, ids.slice(0, 7)));
    assert.throws(() => game.bury(dealer, [...ids.slice(0, 7), ids[0]]));
    game.bury(dealer, ids);
    assert.equal(game.hands[dealer].length, 25);
    assert.equal(game.bottom.length, 8);
    assert.equal(game.actual, 0);
    assert.throws(() => game.play(dealer, [game.hands[dealer][0].id]));
    game.finishBury();
    assert.equal(game.actor, dealer);
    game.assertIntegrity();
  }
});

check('扣王、主牌和计分牌合法，底牌分数不入抓分', () => {
  const game = dealerGame(7);
  game.finishPickup();
  game.chooseTrump(0, 'S');
  const chosen = game.hands[0].slice().sort((first, second) => Rules.points([second]) - Rules.points([first]) || second.rank - first.rank).slice(0, 8);
  game.bury(0, chosen.map(candidate => candidate.id));
  game.finishBury();
  assert.ok(Rules.points(game.bottom) > 0);
  assert.equal(game.actual, 0);
  assert.equal(game.actual - game.penalty, 0);
});

check('主副牌、普通A至2、大小王及同级先出', () => {
  assert.equal(Rules.effectiveSuit(card('H', 2), 'S'), 'H');
  assert.equal(Rules.effectiveSuit(card('D', 7), 'S'), 'D');
  assert.equal(Rules.effectiveSuit(card('J', 15), 'S'), 'T');
  const lead = Rules.analyze([card('H', 14)], 'S');
  assert.ok(Rules.beats([card('S', 2)], [card('H', 14)], lead, 'S'));
  assert.ok(!Rules.beats([card('D', 14)], [card('H', 2)], lead, 'S'));
  assert.ok(!Rules.beats([card('H', 14, 1)], [card('H', 14)], lead, 'S'));
  assert.ok(Rules.beats([card('J', 16)], [card('J', 15)], Rules.analyze([card('S', 14)], 'S'), 'S'));
});

check('对子、两连对、三连对和王对相连，跨副花色不合法', () => {
  assert.equal(Rules.analyze(pair('S', 14), 'S').kind, 'pair');
  assert.equal(Rules.analyze([card('S', 14), card('H', 14)], 'C').kind, 'mixed');
  for (const cards of [[...pair('J', 16), ...pair('J', 15)], [...pair('J', 15), ...pair('S', 14)], [...pair('S', 14), ...pair('S', 13)], [...pair('J', 16), ...pair('J', 15), ...pair('S', 14)]]) {
    assert.equal(Rules.analyze(cards, 'S').kind, 'tractor');
  }
  assert.equal(Rules.analyze([...pair('H', 14), ...pair('H', 12)], 'S').kind, 'throw');
});

check('跟牌必须同花色、数量正确、有对须跟、缺门可垫牌', () => {
  const lead = Rules.analyze(pair('H', 5), 'S');
  const hand = [...pair('H', 2), card('H', 4), card('H', 7), card('S', 14)];
  assert.throws(() => Rules.validateFollow(hand, [card('H', 4), card('H', 7)], lead, 'S'));
  assert.throws(() => Rules.validateFollow(hand, [card('H', 4), card('S', 14)], lead, 'S'));
  assert.throws(() => Rules.validateFollow(hand, [card('H', 4)], lead, 'S'));
  assert.ok(Rules.validateFollow(hand, pair('H', 2), lead, 'S'));
  assert.ok(Rules.validateFollow([card('H', 2), card('D', 2)], [card('H', 2), card('D', 2)], lead, 'S'));
  assert.ok(Rules.validateFollow(pair('D', 2), pair('D', 2), lead, 'S'));
});

check('跟拖拉机必须匹配结构，散牌或部分主牌不能杀对子', () => {
  const leadCards = [...pair('H', 4), ...pair('H', 5)];
  const lead = Rules.analyze(leadCards, 'S');
  const hand = [...pair('H', 6), ...pair('H', 7), card('H', 10), card('H', 12)];
  assert.throws(() => Rules.validateFollow(hand, [...pair('H', 6), card('H', 10), card('H', 12)], lead, 'S'));
  assert.ok(Rules.validateFollow(hand, [...pair('H', 6), ...pair('H', 7)], lead, 'S'));
  assert.ok(Rules.beats([...pair('S', 2), ...pair('S', 3)], leadCards, lead, 'S'));
  assert.ok(!Rules.beats([card('S', 14), card('J', 16)], pair('H', 2), Rules.analyze(pair('H', 2), 'S'), 'S'));
  assert.ok(!Rules.beats([card('H', 14), card('S', 14)], pair('H', 2), Rules.analyze(pair('H', 2), 'S'), 'S'));
});

check('甩错单张：只出最小失败单张，未出牌保留，庄家扣10分', () => {
  const ids = ['0-D-2', '0-D-4', '0-D-6'];
  const game = assigned([ids, ['0-D-3'], ['0-D-7'], ['0-D-8']]);
  const before = game.hands[0].length;
  const outcome = game.play(0, ids);
  assert.equal(outcome.failedCount, 1);
  assert.equal(outcome.cards[0].rank, 2);
  assert.equal(game.hands[0].length, before - 1);
  assert.ok(ids.slice(1).every(id => game.hands[0].some(candidate => candidate.id === id)));
  assert.equal(game.penalty, 10);
  assert.equal(game.actual, 0);
  assert.equal(game.actual - game.penalty, -10);
  game.assertIntegrity();
});

check('甩错对子：仅失败对子2张，庄家扣20分', () => {
  const ids = ['0-D-14', '1-D-14', '0-D-4', '1-D-4'];
  const game = assigned([ids, ['0-D-13', '1-D-13'], ['0-D-7'], ['0-D-8']]);
  const outcome = game.play(0, ids);
  assert.equal(outcome.failedCount, 2);
  assert.deepEqual(outcome.cards.map(candidate => candidate.rank), [4, 4]);
  assert.equal(game.hands[0].length, 23);
  assert.equal(game.penalty, 20);
  assert.equal(game.penalties.length, 1);
  assert.throws(() => game.play(0, ids));
  assert.equal(game.penalty, 20);
});

check('闲家甩错款只给庄家，不改变抓分，其他闲家不分担', () => {
  const ids = ['0-D-14', '1-D-14', '0-D-4', '1-D-4'];
  const game = assigned([ids, ['0-D-13', '1-D-13'], ['0-D-7'], ['0-D-8']]);
  game.dealer = 2;
  game.play(0, ids);
  assert.deepEqual(game.transfers, [-30, 0, 30, 0]);
  assert.equal(game.actual, 0);
  assert.equal(game.penalty, 0);
  game.assertIntegrity();
});

check('缺少明确牌例的成功甩牌不猜规则、不改牌和金额', () => {
  const ids = ['0-D-14', '1-D-14', '0-D-13', '1-D-13', '0-D-2'];
  const game = assigned([ids, ['0-D-3'], ['0-D-7'], ['0-D-8']]);
  const success = ['0-D-14', '1-D-14', '0-D-13', '1-D-13'];
  const snapshot = JSON.stringify(game);
  const pureThrow = Rules.analyze([card('D', 14), card('D', 12)], 'S');
  assert.equal(pureThrow.kind, 'throw');
  assert.throws(() => Rules.checkThrow([card('D', 14), card('D', 12)], [[card('D', 2)], [card('D', 3)], [card('D', 4)]], 'S'), error => error.code === 'NEEDS_EXAMPLE');
  assert.equal(JSON.stringify(game), snapshot);
  assert.equal(Rules.analyze(game.owned(0, success), 'S').kind, 'tractor');
});

check('历史10个金额示例、负有效分、四个庄家位置及金额守恒', () => {
  const examples = new Map([[80, 10], [85, 10], [90, 10], [95, 15], [100, 15], [110, 20], [75, -10], [70, -10], [65, -15], [60, -15]]);
  for (const [effective, expected] of examples) {
    for (let dealer = 0; dealer < 4; dealer += 1) {
      const result = Rules.normalSettlement(dealer, effective, 0, 80);
      assert.equal(result.perPlayer, expected);
      assert.equal(result.normal[dealer], expected * 3);
      assert.equal(result.net.reduce((sum, value) => sum + value, 0), 0);
    }
  }
  assert.equal(Rules.normalSettlement(0, 0, 10, 80).effective, -10);
  const sample = Rules.normalSettlement(0, 90, 20, 80, [15, -15, 0, 0]);
  assert.deepEqual(sample.net, [-15, -5, 10, 10]);
  assert.equal(sample.won, false);
});

check('旧版本计时回调失效，托管持续到后续行动', () => {
  const game = new Rules.Game({ seed: 1, first: 0 });
  game.start(); game.finishDeal();
  const version = game.version;
  assert.ok(game.expire(version));
  assert.equal(game.managed, true);
  game.bid(0, 80);
  assert.equal(game.expire(version), false);
  for (let turn = 0; turn < 3; turn += 1) game.bid(game.actor, null);
  game.finishPickup();
  game.chooseTrump(0, 'S');
  assert.equal(game.managed, true);
  game.bury(0, game.aiBury(0));
  game.finishBury();
  assert.equal(game.managed, true);
});

let normalGames = 0;
let passedGames = 0;
let completedTricks = 0;
check('250个种子完整AI牌局：合法跟牌、抓分来源、无抠底、108张守恒', () => {
  for (let seed = 1; seed <= 250; seed += 1) {
    const game = new Rules.Game({ seed });
    game.start(); game.finishDeal();
    let actions = 0;
    while (game.phase !== 'result') {
      assert.ok(actions++ < 500, `牌局未能结束，种子${seed}`);
      if (game.phase === 'bidding') game.bid(game.actor, game.aiBid(game.actor));
      else if (game.phase === 'pickup') game.finishPickup();
      else if (game.phase === 'trump') game.chooseTrump(game.actor, game.aiTrump(game.actor));
      else if (game.phase === 'bury') game.bury(game.actor, game.aiBury(game.actor));
      else if (game.phase === 'burying') game.finishBury();
      else if (game.phase === 'playing') game.play(game.actor, game.aiPlay(game.actor));
      else if (game.phase === 'collecting') { game.finishTrick(); completedTricks += 1; }
      else throw new Error(`未知阶段${game.phase}`);
      game.assertIntegrity();
    }
    assert.equal(game.result.net.reduce((sum, value) => sum + value, 0), 0);
    if (game.result.type === 'allPass') passedGames += 1;
    else {
      normalGames += 1;
      assert.ok(game.hands.every(hand => hand.length === 0));
      assert.equal(game.bottom.length, 8);
      assert.equal(Rules.points(game.captured.flat()) + Rules.points(game.bottom), 200);
      assert.equal(game.actual, Rules.points(game.captured[game.dealer]));
      assert.equal(game.result.effective, game.actual - game.penalty);
    }
  }
  assert.ok(normalGames >= 100);
});

const root = path.resolve(__dirname, '..');
const ruleDocument = fs.readFileSync(path.join(root, '彭泽三打一_完整规则与Figma原型需求_V1.md'));
const report = { date: '2026-11-08', rulesVersion: 'V1.1', rulesSha256: crypto.createHash('sha256').update(ruleDocument).digest('hex'), passed: results.length, results, simulation: { games: 250, normalGames, passedGames, completedTricks }, boundary: '复杂甩牌与升级地方差异牌例不推定；250局AI以单张、对子首攻，不代表全部拖拉机及混合结构验收。' };
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'rules-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: results.length, simulation: report.simulation }, null, 2));
