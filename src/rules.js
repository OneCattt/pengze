(function (scope) {
  'use strict';

  const SUITS = ['S', 'H', 'C', 'D'];
  const SUIT_NAMES = { S: '黑桃', H: '红桃', C: '梅花', D: '方块', T: '主牌' };
  const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦', J: '王' };
  const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小', 16: '大' };

  function requireRule(condition, message, code = 'ILLEGAL') {
    if (!condition) {
      const error = new Error(message);
      error.code = code;
      throw error;
    }
  }

  function deck() {
    const cards = [];
    for (let copy = 0; copy < 2; copy += 1) {
      for (const suit of SUITS) {
        for (let rank = 2; rank <= 14; rank += 1) {
          cards.push({ id: `${copy}-${suit}-${rank}`, suit, rank });
        }
      }
      cards.push({ id: `${copy}-J-15`, suit: 'J', rank: 15 });
      cards.push({ id: `${copy}-J-16`, suit: 'J', rank: 16 });
    }
    return cards;
  }

  function random(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6D2B79F5;
      let mixed = Math.imul(value ^ (value >>> 15), value | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(cards, generator = Math.random) {
    const result = cards.slice();
    for (let cursor = result.length - 1; cursor > 0; cursor -= 1) {
      const target = Math.floor(generator() * (cursor + 1));
      [result[cursor], result[target]] = [result[target], result[cursor]];
    }
    return result;
  }

  function points(cards) {
    return cards.reduce((total, card) => total + (card.rank === 5 ? 5 : [10, 13].includes(card.rank) ? 10 : 0), 0);
  }

  function effectiveSuit(card, trump) {
    return card.suit === 'J' || card.suit === trump ? 'T' : card.suit;
  }

  function name(card) {
    return card.suit === 'J' ? `${RANK_NAMES[card.rank]}王` : `${SUIT_NAMES[card.suit]}${RANK_NAMES[card.rank] || card.rank}`;
  }

  function sort(cards, trump) {
    const order = ['T', ...SUITS.filter(suit => suit !== trump)];
    return cards.slice().sort((first, second) => {
      return order.indexOf(effectiveSuit(first, trump)) - order.indexOf(effectiveSuit(second, trump)) || second.rank - first.rank || first.id.localeCompare(second.id);
    });
  }

  function groups(cards) {
    const result = new Map();
    for (const card of cards) {
      const key = `${card.suit}-${card.rank}`;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(card);
    }
    return Array.from(result.values());
  }

  function pairs(cards) {
    return groups(cards).filter(group => group.length === 2).sort((first, second) => first[0].rank - second[0].rank);
  }

  function runs(pairGroups) {
    const result = [];
    for (const pair of pairGroups) {
      const previous = result[result.length - 1];
      if (previous && previous[previous.length - 1][0].rank + 1 === pair[0].rank) previous.push(pair);
      else result.push([pair]);
    }
    return result;
  }

  function analyze(cards, trump) {
    if (!cards.length) return { kind: 'empty', count: 0, label: '未选牌' };
    const suit = effectiveSuit(cards[0], trump);
    if (cards.some(card => effectiveSuit(card, trump) !== suit)) return { kind: 'mixed', count: cards.length, label: '不同花色' };
    const pairGroups = pairs(cards);
    const highest = Math.max(...cards.map(card => card.rank));
    if (cards.length === 1) return { kind: 'single', count: 1, suit, highest, label: '单张' };
    if (cards.length === 2 && pairGroups.length === 1) return { kind: 'pair', count: 2, suit, highest, label: '对子' };
    if (pairGroups.length * 2 === cards.length && runs(pairGroups).length === 1) {
      return { kind: 'tractor', count: cards.length, suit, highest, label: `${pairGroups.length}连对` };
    }
    const components = runs(pairGroups).map(run => ({
      kind: run.length === 1 ? 'pair' : 'tractor',
      cards: run.flat(),
      highest: run[run.length - 1][0].rank
    }));
    const paired = new Set(pairGroups.flat().map(card => card.id));
    for (const card of cards) if (!paired.has(card.id)) components.push({ kind: 'single', cards: [card], highest: card.rank });
    return { kind: 'throw', count: cards.length, suit, highest, components, label: '甩牌' };
  }

  function sameStructure(first, second) {
    return first.kind === second.kind && first.count === second.count && ['single', 'pair', 'tractor'].includes(first.kind);
  }

  function beats(candidate, current, lead, trump) {
    const contender = analyze(candidate, trump);
    const incumbent = analyze(current, trump);
    if (!sameStructure(contender, lead)) return false;
    if (contender.suit !== lead.suit && contender.suit !== 'T') return false;
    if (!sameStructure(incumbent, lead)) return true;
    if (contender.suit === 'T' && incumbent.suit !== 'T') return true;
    if (contender.suit !== incumbent.suit) return false;
    return contender.highest > incumbent.highest;
  }

  function tractorOptions(cards, pairCount) {
    const options = [];
    for (const run of runs(pairs(cards))) {
      for (let start = 0; start + pairCount <= run.length; start += 1) options.push(run.slice(start, start + pairCount).flat());
    }
    return options;
  }

  function validateFollow(hand, selected, lead, trump) {
    requireRule(selected.length === lead.count, `请跟${lead.count}张牌`);
    const matching = hand.filter(card => effectiveSuit(card, trump) === lead.suit);
    const followed = selected.filter(card => effectiveSuit(card, trump) === lead.suit);
    requireRule(followed.length === Math.min(matching.length, lead.count), `请先跟完${SUIT_NAMES[lead.suit]}`);
    if (matching.length < lead.count || lead.kind === 'single') return true;
    const requiredPairs = Math.min(pairs(matching).length, Math.floor(lead.count / 2));
    requireRule(pairs(followed).length >= requiredPairs, '有对子，须跟对子');
    if (lead.kind === 'tractor') {
      const available = tractorOptions(matching, lead.count / 2);
      if (available.length) requireRule(analyze(followed, trump).kind === 'tractor', '有同长度拖拉机，须跟拖拉机');
      else {
        const usefulRuns = runs(pairs(matching)).filter(run => run.length > 1);
        if (usefulRuns.length && requiredPairs > 1) {
          requireRule(false, '该拆分跟牌组合尚需升级牌例核对，请用“提示”选择保留连对的跟法', 'NEEDS_EXAMPLE');
        }
      }
    }
    return true;
  }

  function cost(cards, trump, donate = false) {
    return cards.reduce((total, card) => total + card.rank + (effectiveSuit(card, trump) === 'T' ? 30 : 0) + points([card]) * (donate ? -5 : 2), 0);
  }

  function chooseFollow(hand, lead, trump, preferHigh = false, donate = false) {
    const matching = hand.filter(card => effectiveSuit(card, trump) === lead.suit);
    const byCost = cards => cards.slice().sort((first, second) => cost([first], trump, donate) - cost([second], trump, donate));
    const options = [];
    if (matching.length >= lead.count) {
      if (lead.kind === 'single') options.push(...matching.map(card => [card]));
      else if (lead.kind === 'pair' && pairs(matching).length) options.push(...pairs(matching));
      else if (lead.kind === 'tractor' && tractorOptions(matching, lead.count / 2).length) options.push(...tractorOptions(matching, lead.count / 2));
      else {
        const pairGroups = pairs(matching);
        if (lead.kind === 'tractor' && runs(pairGroups).some(run => run.length > 1)) {
          requireRule(false, '拖拉机拆分优先级尚需升级牌例核对', 'NEEDS_EXAMPLE');
        }
        const preferredPairs = pairGroups.sort((first, second) => cost(first, trump, donate) - cost(second, trump, donate)).slice(0, Math.floor(lead.count / 2)).flat();
        const used = new Set(preferredPairs.map(card => card.id));
        options.push([...preferredPairs, ...byCost(matching.filter(card => !used.has(card.id))).slice(0, lead.count - preferredPairs.length)]);
      }
    } else {
      const otherCards = hand.filter(card => effectiveSuit(card, trump) !== lead.suit);
      options.push([...matching, ...byCost(otherCards).slice(0, lead.count - matching.length)]);
      if (!matching.length && lead.suit !== 'T') {
        const trumps = hand.filter(card => effectiveSuit(card, trump) === 'T');
        if (lead.kind === 'single') options.push(...trumps.map(card => [card]));
        if (lead.kind === 'pair') options.push(...pairs(trumps));
        if (lead.kind === 'tractor') options.push(...tractorOptions(trumps, lead.count / 2));
      }
    }
    const legal = options.filter(option => option.length === lead.count);
    requireRule(legal.length > 0, '未找到合法跟牌');
    legal.sort((first, second) => cost(first, trump, donate) - cost(second, trump, donate));
    return preferHigh ? legal[legal.length - 1] : legal[0];
  }

  function checkThrow(selected, opponents, trump) {
    const shape = analyze(selected, trump);
    requireRule(shape.kind !== 'mixed', '首攻只能选择同一有效花色');
    if (shape.kind !== 'throw') return { cards: selected, failedCount: 0 };
    const failures = shape.components.filter(component => opponents.some(hand => {
      const matching = hand.filter(card => effectiveSuit(card, trump) === shape.suit);
      if (component.kind === 'single') return matching.some(card => card.rank > component.highest);
      if (component.kind === 'pair') return pairs(matching).some(pair => pair[0].rank > component.highest);
      return tractorOptions(matching, component.cards.length / 2).some(option => analyze(option, trump).highest > component.highest);
    }));
    requireRule(failures.length > 0, '成功甩牌的复杂跟牌与牌权仍需具体升级牌例，验证稿暂不推定', 'NEEDS_EXAMPLE');
    requireRule(new Set(failures.map(component => component.kind)).size === 1 && failures[0].kind !== 'tractor', '多个失败结构的选择仍需升级牌例核对', 'NEEDS_EXAMPLE');
    requireRule(!opponents.some(hand => !hand.some(card => effectiveSuit(card, trump) === shape.suit) && hand.some(card => effectiveSuit(card, trump) === 'T')), '缺门杀牌对甩牌检查的影响仍需升级牌例核对', 'NEEDS_EXAMPLE');
    failures.sort((first, second) => first.highest - second.highest);
    return { cards: failures[0].cards, failedCount: failures[0].cards.length };
  }

  function normalSettlement(dealer, actual, penalty, target, transfers = [0, 0, 0, 0]) {
    const effective = actual - penalty;
    const difference = effective - target;
    const perPlayer = difference === 0 ? 10 : Math.sign(difference) * (5 + 5 * Math.floor((Math.abs(difference) + 5) / 10));
    const normal = Array.from({ length: 4 }, (_, player) => player === dealer ? perPlayer * 3 : -perPlayer);
    return { type: 'normal', dealer, actual, penalty, effective, target, perPlayer, normal, transfers: transfers.slice(), net: normal.map((amount, player) => amount + transfers[player]), won: difference >= 0 };
  }

  function allPassSettlement(first) {
    const normal = Array.from({ length: 4 }, (_, player) => player === first ? -30 : 10);
    return { type: 'allPass', first, normal, transfers: [0, 0, 0, 0], net: normal.slice() };
  }

  class Game {
    constructor(options = {}) {
      this.generator = options.seed === undefined ? Math.random : random(options.seed);
      this.first = options.first === undefined ? Math.floor(this.generator() * 4) : options.first;
      this.round = 0;
      this.totals = [0, 0, 0, 0];
      this.managed = false;
      this.version = 0;
      this.phase = 'home';
      this.history = [];
    }

    start() {
      requireRule(['home', 'result'].includes(this.phase), '本局尚未结束');
      if (this.round) this.first = (this.first + 1) % 4;
      this.round += 1;
      this.hands = [[], [], [], []];
      this.stock = shuffle(deck(), this.generator);
      this.bottom = [];
      this.trick = [];
      this.captured = [[], [], [], []];
      this.bids = [null, null, null, null];
      this.passed = [false, false, false, false];
      this.highest = 0;
      this.dealer = null;
      this.trump = null;
      this.leader = null;
      this.lastTrick = null;
      this.actual = 0;
      this.penalty = 0;
      this.transfers = [0, 0, 0, 0];
      this.penalties = [];
      this.result = null;
      this.actor = this.first;
      this.phase = 'dealing';
      this.version += 1;
      return this;
    }

    dealOne() {
      requireRule(this.phase === 'dealing', '当前不是发牌阶段');
      const dealt = this.hands.reduce((total, hand) => total + hand.length, 0);
      if (dealt < 100) {
        const player = (this.first + dealt) % 4;
        this.hands[player].push(this.stock.shift());
        return player;
      }
      this.bottom = this.stock.splice(0);
      this.phase = 'bidding';
      this.version += 1;
      return null;
    }

    finishDeal() {
      while (this.phase === 'dealing') this.dealOne();
      this.assertIntegrity();
    }

    bid(player, amount) {
      this.requireAction('bidding', player);
      if (amount === null) {
        this.passed[player] = true;
        this.bids[player] = 'pass';
      } else {
        requireRule(Number.isSafeInteger(amount) && amount >= 80 && amount % 5 === 0 && amount > this.highest, '80分起叫，以5分递增，须高于当前最高分');
        this.highest = amount;
        this.dealer = player;
        this.bids[player] = amount;
      }
      this.version += 1;
      if (this.passed.every(Boolean)) return this.settle(allPassSettlement(this.first));
      if (this.dealer !== null && this.passed.filter(Boolean).length === 3) {
        this.hands[this.dealer].push(...this.bottom);
        this.bottom = [];
        this.actor = this.dealer;
        this.phase = 'pickup';
        this.assertIntegrity();
        return;
      }
      do this.actor = (this.actor + 1) % 4;
      while (this.passed[this.actor]);
    }

    finishPickup() {
      requireRule(this.phase === 'pickup', '尚未收底');
      requireRule(this.hands[this.dealer].length === 33, '庄家收底必须为33张');
      this.phase = 'trump';
      this.version += 1;
    }

    chooseTrump(player, suit) {
      this.requireAction('trump', player);
      requireRule(SUITS.includes(suit), '请选择四种花色之一');
      this.trump = suit;
      this.phase = 'bury';
      this.version += 1;
    }

    owned(player, ids) {
      requireRule(Array.isArray(ids) && new Set(ids).size === ids.length, '不能重复选择同一张牌');
      const cards = ids.map(id => this.hands[player].find(card => card.id === id));
      requireRule(cards.every(Boolean), '所选牌不在当前手牌中');
      return cards;
    }

    bury(player, ids) {
      this.requireAction('bury', player);
      requireRule(ids.length === 8, '请选择恰好8张底牌');
      const cards = this.owned(player, ids);
      this.bottom = cards;
      this.hands[player] = this.hands[player].filter(card => !ids.includes(card.id));
      this.phase = 'burying';
      this.version += 1;
      this.assertIntegrity();
      return cards;
    }

    finishBury() {
      requireRule(this.phase === 'burying' && this.bottom.length === 8 && this.hands.every(hand => hand.length === 25), '扣底尚未正确完成');
      this.phase = 'playing';
      this.actor = this.dealer;
      this.leader = this.dealer;
      this.version += 1;
    }

    preview(player, ids) {
      this.requireAction('playing', player);
      const cards = this.owned(player, ids);
      requireRule(cards.length > 0, '请先选择出牌');
      if (this.trick.length) {
        validateFollow(this.hands[player], cards, analyze(this.trick[0].cards, this.trump), this.trump);
        return { cards, failedCount: 0 };
      }
      const opponents = this.hands.filter((_, seat) => seat !== player);
      const outcome = checkThrow(cards, opponents, this.trump);
      const lead = analyze(outcome.cards, this.trump);
      if (lead.kind === 'tractor') for (const hand of opponents) chooseFollow(hand, lead, this.trump);
      return outcome;
    }

    play(player, ids) {
      const outcome = this.preview(player, ids);
      const playedIds = new Set(outcome.cards.map(card => card.id));
      if (outcome.failedCount) {
        if (player === this.dealer) this.penalty += outcome.failedCount * 10;
        else {
          this.transfers[player] -= outcome.failedCount * 15;
          this.transfers[this.dealer] += outcome.failedCount * 15;
        }
        this.penalties.push({ player, count: outcome.failedCount, cards: outcome.cards.map(card => card.id) });
      }
      this.hands[player] = this.hands[player].filter(card => !playedIds.has(card.id));
      this.trick.push({ player, cards: outcome.cards });
      this.version += 1;
      if (this.trick.length === 4) this.phase = 'collecting';
      else this.actor = (this.actor + 1) % 4;
      this.assertIntegrity();
      return outcome;
    }

    winner() {
      requireRule(this.trick.length > 0, '当前牌墩为空');
      let best = this.trick[0];
      const lead = analyze(best.cards, this.trump);
      for (const entry of this.trick.slice(1)) if (beats(entry.cards, best.cards, lead, this.trump)) best = entry;
      return best.player;
    }

    finishTrick() {
      requireRule(this.phase === 'collecting' && this.trick.length === 4, '四人尚未完成跟牌');
      const winner = this.winner();
      const cards = this.trick.flatMap(entry => entry.cards);
      this.captured[winner].push(...cards);
      if (winner === this.dealer) this.actual += points(cards);
      this.lastTrick = { winner, points: points(cards), cards: cards.slice() };
      this.trick = [];
      this.actor = winner;
      this.leader = winner;
      this.version += 1;
      if (this.hands.every(hand => hand.length === 0)) this.settle(normalSettlement(this.dealer, this.actual, this.penalty, this.highest, this.transfers));
      else this.phase = 'playing';
      this.assertIntegrity();
      return this.lastTrick;
    }

    settle(result) {
      requireRule(this.phase !== 'result', '本局已结算');
      requireRule(result.net.reduce((total, amount) => total + amount, 0) === 0, '结算金额不守恒');
      this.result = result;
      this.totals = this.totals.map((amount, player) => amount + result.net[player]);
      this.history.push({ round: this.round, ...result });
      this.phase = 'result';
      this.actor = null;
      this.version += 1;
    }

    requireAction(phase, player) {
      requireRule(this.phase === phase && this.actor === player, '当前不能执行此操作');
    }

    expire(expectedVersion) {
      if (this.version !== expectedVersion || this.actor !== 0 || !['bidding', 'trump', 'bury', 'playing'].includes(this.phase)) return false;
      this.managed = true;
      return true;
    }

    resume() {
      if (!this.managed || this.phase === 'home') return false;
      this.managed = false;
      this.version += 1;
      return true;
    }

    leave() {
      if (this.phase === 'home') return false;
      this.phase = 'home';
      this.managed = false;
      this.actor = null;
      this.hands = [[], [], [], []];
      this.stock = [];
      this.bottom = [];
      this.trick = [];
      this.captured = [[], [], [], []];
      this.result = null;
      this.version += 1;
      return true;
    }

    aiBid(player) {
      const hand = this.hands[player];
      const bestSuit = Math.max(...SUITS.map(suit => hand.filter(card => card.suit === suit).length));
      const strength = hand.filter(card => card.suit === 'J').length * 12 + hand.filter(card => card.rank === 14).length * 5 + pairs(hand).length * 4 + bestSuit * 2;
      const willingness = Math.floor((45 + strength) / 5) * 5;
      const next = Math.max(80, this.highest + 5);
      return willingness >= next ? next : null;
    }

    aiTrump(player) {
      return SUITS.slice().sort((first, second) => {
        const strength = suit => this.hands[player].filter(card => card.suit === suit).reduce((total, card) => total + 4 + card.rank / 3, 0) + pairs(this.hands[player].filter(card => card.suit === suit)).length * 8;
        return strength(second) - strength(first);
      })[0];
    }

    aiBury(player) {
      const hand = this.hands[player];
      const paired = new Set(pairs(hand).flat().map(card => card.id));
      return hand.slice().sort((first, second) => {
        const value = card => cost([card], this.trump) + (paired.has(card.id) ? 20 : 0) + hand.filter(other => other.suit === card.suit).length;
        return value(first) - value(second);
      }).slice(0, 8).map(card => card.id);
    }

    aiPlay(player) {
      const hand = this.hands[player];
      if (!this.trick.length) {
        const options = [];
        for (const suit of ['T', ...SUITS.filter(suit => suit !== this.trump)]) {
          const matching = hand.filter(card => effectiveSuit(card, this.trump) === suit);
          options.push(...pairs(matching));
        }
        const candidate = options.sort((first, second) => cost(first, this.trump) - cost(second, this.trump))[0];
        return (candidate || hand.slice().sort((first, second) => cost([first], this.trump) - cost([second], this.trump)).slice(0, 1)).map(card => card.id);
      }
      const lead = analyze(this.trick[0].cards, this.trump);
      const winner = this.winner();
      const teammate = player !== this.dealer && winner !== this.dealer;
      const low = chooseFollow(hand, lead, this.trump, false, teammate);
      const high = chooseFollow(hand, lead, this.trump, true, false);
      const incumbent = this.trick.find(entry => entry.player === winner).cards;
      const choice = !teammate && beats(high, incumbent, lead, this.trump) ? high : low;
      return choice.map(card => card.id);
    }

    assertIntegrity() {
      const active = [...this.stock, ...this.hands.flat(), ...this.bottom, ...this.trick.flatMap(entry => entry.cards), ...this.captured.flat()];
      requireRule(active.length === 108 && new Set(active.map(card => card.id)).size === 108, '牌数异常：必须完整且唯一地保留108张');
      requireRule(points(active) === 200, '牌组总分异常');
      if (this.dealer !== null) requireRule(points(this.captured[this.dealer]) === this.actual, '庄家抓分与实际牌墩不一致');
      requireRule(this.transfers.reduce((total, amount) => total + amount, 0) === 0, '甩错转账不守恒');
      return true;
    }
  }

  const api = { SUITS, SUIT_NAMES, SUIT_SYMBOLS, RANK_NAMES, deck, random, shuffle, points, effectiveSuit, name, sort, groups, pairs, runs, analyze, sameStructure, beats, validateFollow, chooseFollow, checkThrow, normalSettlement, allPassSettlement, Game };
  scope.PengzeRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
