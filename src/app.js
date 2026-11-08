(function () {
  'use strict';

  const Rules = window.PengzeRules;
  const board = document.getElementById('board');
  const surface = document.getElementById('surface');
  const overlay = document.getElementById('overlay');
  const motion = document.getElementById('motion');
  const toastElement = document.getElementById('toast');
  const params = new URLSearchParams(location.search);
  const names = ['我', '电脑一', '电脑二', '电脑三'];
  const initials = ['我', '一', '二', '三'];
  const centers = [{ x: 37, y: 352 }, { x: 40, y: 180 }, { x: 403, y: 73 }, { x: 804, y: 180 }];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let game = new Rules.Game();
  let selected = new Set();
  let chosenTrump = 'S';
  let bidValue = 80;
  let panel = null;
  let ruleSection = null;
  let showDetails = false;
  let actionTimer = null;
  let toastTimer = null;
  let deadline = 0;
  let generation = 0;
  let scale = 1;
  let fast = params.get('speed') === 'fast';
  let frozen = params.has('review');
  let demoName = '';
  const events = [];

  function escape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function amount(value) {
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;
  }

  function record(action, details = {}) {
    events.push({ time: new Date().toISOString(), round: game.round, phase: game.phase, action, ...details });
    if (events.length > 500) events.shift();
  }

  function toast(message) {
    clearTimeout(toastTimer);
    toastElement.hidden = false;
    toastElement.textContent = message;
    toastElement.classList.add('show');
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 3500);
  }

  function clearToast() {
    clearTimeout(toastTimer);
    toastElement.hidden = true;
    toastElement.classList.remove('show');
    toastElement.textContent = '';
  }

  function resize() {
    scale = Math.min(innerWidth / 844, innerHeight / 390);
    board.style.transform = `scale(${scale})`;
  }

  function cardHTML(card, options = {}) {
    const red = card.suit === 'H' || card.suit === 'D' || card.rank === 16;
    const joker = card.suit === 'J';
    const rank = Rules.RANK_NAMES[card.rank] || card.rank;
    const suit = joker ? '王' : Rules.SUIT_SYMBOLS[card.suit];
    const face = `${card.suit}${card.rank}`;
    const active = options.interactive;
    return `<${active ? 'button' : 'div'} class="poker-card ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${options.small ? 'played-card' : ''} ${options.selected ? 'selected' : ''}" data-face="${face}" ${active ? `type="button" data-action="card" data-card="${card.id}" aria-label="${Rules.name(card)}" aria-pressed="${Boolean(options.selected)}"` : `aria-label="${Rules.name(card)}"`} ${options.style ? `style="${options.style}"` : ''}><img class="card-art" src="${PENGZE_CARD_ART[face]}" width="240" height="336" alt="" aria-hidden="true" draggable="false"><span class="corner" aria-hidden="true"><span>${rank}</span><span class="suit">${suit}</span></span></${active ? 'button' : 'div'}>`;
  }

  function countdownHTML() {
    const seconds = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 20;
    return `<span class="countdown ${seconds <= 5 ? 'urgent' : ''}" data-countdown aria-label="剩余${seconds}秒">${seconds}</span>`;
  }

  function button(label, action, primary = false, disabled = false, attributes = '') {
    return `<button class="button ${primary ? 'primary' : ''}" data-action="${action}" ${disabled ? 'disabled' : ''} ${attributes}>${label}</button>`;
  }

  function renderHeader() {
    const effective = game.dealer === null ? '—' : game.actual - game.penalty;
    const target = game.highest || '—';
    return `<header class="table-header"><button class="brand" style="background:none;padding:0" data-action="menu" aria-label="彭泽三打一，验证场景">彭泽三打一</button><button class="score-summary" data-action="score">第${game.round}局 目标 <b>${target}</b> 主 <b>${Rules.SUIT_SYMBOLS[game.trump] || '—'}</b> 有效 <b>${effective}</b></button><div class="header-actions">${game.managed ? '<span class="managed-badge">托管中</span>' : ''}<button class="text-button" data-action="rules">规则</button><span class="capsule" aria-label="微信胶囊预留区域">···</span></div></header>`;
  }

  function renderSeat(player) {
    const active = game.actor === player && ['bidding', 'trump', 'bury', 'playing'].includes(game.phase);
    let status = '';
    if (game.phase === 'bidding') status = game.bids[player] === 'pass' ? '不叫' : game.bids[player] === null ? '' : `${game.bids[player]}分`;
    else if (game.phase === 'pickup' && player === game.dealer) status = '收底 · 33张';
    else if (game.phase === 'trump' && player === game.dealer) status = '定主中';
    else if (['bury', 'burying'].includes(game.phase) && player === game.dealer) status = '扣底中';
    else if (active) status = player === 0 && game.managed ? '托管中' : game.trick.length ? '跟牌中' : '首攻';
    return `<div class="seat seat-${player} ${active ? 'active' : ''}" data-seat="${player}"><div class="avatar">${initials[player]}${game.dealer === player ? '<span class="dealer-badge">庄</span>' : ''}</div><div><div class="seat-name">${names[player]}</div><div class="seat-count">手牌 ${game.hands[player].length}</div></div>${status ? `<div class="seat-action">${status}</div>` : ''}</div>`;
  }

  function renderBottom() {
    const count = game.phase === 'burying' ? 0 : game.bottom.length;
    if (!count) return '';
    return `<div class="bottom-pile" aria-label="底牌${count}张，牌面保密">${Array.from({ length: count }, () => '<span class="card-back"></span>').join('')}<span class="pile-count">${count}张</span></div>`;
  }

  function handCards() {
    return game.hands ? Rules.sort(game.hands[0], game.trump) : [];
  }

  function canSelect() {
    return game.actor === 0 && !game.managed && ['bury', 'playing'].includes(game.phase);
  }

  function renderHand() {
    if (game.phase === 'dealing' || !game.hands[0].length) return '';
    const cards = handCards();
    const step = Math.min(25.5, (644 - 52.5) / Math.max(1, cards.length - 1));
    const width = (cards.length - 1) * step + 52.5;
    const html = cards.map((card, index) => cardHTML(card, { interactive: true, selected: selected.has(card.id), style: `left:${index * step}px;z-index:${index}` })).join('');
    return `<div class="hand-zone"><div class="hand-fan" style="width:${width}px;--hand-exposed:${step}px" aria-label="我的手牌，共${cards.length}张">${html}</div></div><div class="hand-tools"><button data-action="expand">展开手牌</button></div>`;
  }

  function renderTrick() {
    if (!game.trick.length) return '';
    const winner = game.winner();
    return game.trick.map(entry => `<div class="play-zone play-zone-${entry.player} ${entry.player === winner ? 'winning' : ''}" data-played-seat="${entry.player}">${entry.player === winner && game.trick.length > 1 ? '<span class="trick-caption">当前最大</span>' : ''}${entry.cards.map(card => cardHTML(card, { small: true })).join('')}</div>`).join('');
  }

  function selectedCards() {
    return handCards().filter(card => selected.has(card.id));
  }

  function renderControls() {
    const phase = game.phase;
    if (phase === 'result') return '';
    if (['dealing', 'pickup', 'burying', 'collecting'].includes(phase)) {
      const message = phase === 'collecting' ? `${names[game.winner()]}收墩` : { dealing: '洗牌发牌中', pickup: `${names[game.dealer]}收取底牌`, burying: '扣底中' }[phase];
      return `<div class="center-status">${message}</div>`;
    }
    if (game.actor !== 0 || game.managed) {
      const action = { bidding: '叫分', trump: '定主', bury: '扣底', playing: '出牌' }[phase];
      return `<div class="controls"><div class="auto-strip"><span class="mini-spinner"></span><strong>${game.actor === 0 ? '托管中 · 自动' : `${names[game.actor]}`}${action}</strong></div>${countdownHTML()}</div>`;
    }
    if (phase === 'bidding') {
      bidValue = Math.max(bidValue, game.highest + 5, 80);
      return `<div class="controls bidding-controls"><div class="control-info"><small>轮到你叫分 · 不设上限</small><div class="bid-stepper"><button data-action="bid-down" aria-label="减5分">−</button><input id="bid-value" aria-label="叫分分数" type="number" min="${Math.max(80, game.highest + 5)}" step="5" value="${bidValue}"><span>分</span><button data-action="bid-up" aria-label="加5分">＋</button></div></div>${button('不叫', 'pass')}${button(`叫${bidValue}分`, 'bid', true)}${countdownHTML()}</div>`;
    }
    if (phase === 'trump') {
      return `<div class="controls"><div class="control-info" style="min-width:45px"><small>选择主花色</small></div>${Rules.SUITS.map(suit => `<button class="button suit-button ${['H', 'D'].includes(suit) ? 'red' : ''} ${chosenTrump === suit ? 'chosen' : ''}" data-action="trump-option" data-suit="${suit}" aria-label="${Rules.SUIT_NAMES[suit]}" aria-pressed="${chosenTrump === suit}">${Rules.SUIT_SYMBOLS[suit]}</button>`).join('')}${button('确认定主', 'trump', true)}${countdownHTML()}</div>`;
    }
    if (phase === 'bury') {
      return `<div class="controls"><div class="control-info"><small>选择扣底牌</small><strong>已选 ${selected.size}/8</strong></div>${button('确认扣底', 'bury', true, selected.size !== 8)}${countdownHTML()}</div>`;
    }
    const shape = Rules.analyze(selectedCards(), game.trump);
    const leading = !game.trick.length;
    const required = leading ? '' : ` · 跟${game.trick[0].cards.length}张`;
    return `<div class="controls"><div class="control-info"><small>${leading ? game.leader === game.dealer && game.captured.flat().length === 0 ? '庄家首攻' : '轮到你首攻' : '轮到你跟牌'}${required}</small><strong>已选 ${selected.size} 张${selected.size ? ` · ${shape.label}` : ''}</strong></div>${button('提示', 'hint')}${button('取消', 'clear')}${button('出牌', 'play', true, selected.size === 0)}${countdownHTML()}</div>`;
  }

  function renderHome() {
    return `<div class="home-rings"></div><div class="home-content"><div class="home-kicker">九江彭泽 · 传统扑克玩法</div><div class="home-name">彭泽</div><div class="home-title">三打一</div><div class="home-subtitle">一 人 坐 庄 · 三 家 联 手</div><button class="home-start" data-action="start">▱ 开始游戏</button><div class="home-links"><button data-action="rules">玩法规则</button> · <button data-action="allpass">全员不叫演示</button> · <button data-action="menu">验证场景</button></div></div>`;
  }

  function render() {
    board.classList.toggle('home-board', game.phase === 'home');
    if (game.phase === 'home') surface.innerHTML = renderHome();
    else surface.innerHTML = `<div class="table-line"></div>${renderHeader()}<div class="table-emblem"><b>彭</b><span>三打一</span></div>${[0, 1, 2, 3].map(renderSeat).join('')}${renderBottom()}${renderHand()}${renderTrick()}${game.phase === 'dealing' ? '<div class="deal-stock"></div>' : ''}${renderControls()}`;
    renderOverlay();
  }

  const ruleSections = [
    { title: '叫分与底牌', detail: '<p>双副108张，每人25张、底牌8张。先看牌再叫分，80起叫、以5分递增、可跳叫、不设上限，不叫后退出本轮。</p><p>庄家收底到33张后定主，再任选8张扣回，恢复25张才首攻。底牌分数不归任何一方，不设抠底。</p>' },
    { title: '主牌与分牌', detail: '<p>大小王和选定花色为主牌，无跨花色固定主牌，无“无主”。</p><p>大王＞小王＞主A＞主K＞主Q＞主J＞主10……＞主2。副牌A最大、2最小。</p><p>5计5分，10和K各计10分，两副合计200分。</p>' },
    { title: '出牌与跟牌', detail: '<p>沿用升级：同花色必须先跟，有对子须跟对子，有同长度拖拉机须跟拖拉机。花色不足先出完该花色，再补其他牌。</p><p>完全缺门可垫牌或用对应结构全主牌杀牌。部分原花色加主牌不算完整杀牌。同级先出者大。每墩赢家获得下一墩首攻权。</p><p>小王对＋主A对、大王对＋小王对＋主A对都是拖拉机。</p>' },
    { title: '甩牌与结算', detail: '<p>甩错只强制打出失败的最小牌型，其他牌留手。庄家甩错每张扣10游戏分；闲家每张向庄家支付15元。</p><p>庄家有效分＝实际赢墩抓分−甩错扣分。有效分达到叫分即赢，允许负分。</p><p>刚好达标每家赢10元。超/差5或10分对应10元，15或20分对应15元，依次递增。当前金额档位为文档暂定V1。闲家甩错转账另记。</p><p>全员不叫：首叫位−30元，另外三人各+10元。</p>' },
    { title: '超时托管', detail: '<p>当前验证稿四个操作阶段均20秒。叫分、定主20秒沿用文档暂定V1，扣底、出牌20秒已确认。</p><p>超时进入托管，由AI接管并持续自动出牌，不在下一轮自动恢复手动。取消托管和跨局保持的最终规则仍待确认。</p>' }
  ];

  function modal(contents, className, attributes = '') {
    return `<div class="modal-layer"><section class="panel ${className}" role="dialog" aria-modal="true" ${attributes}>${contents}</section></div>`;
  }

  function renderOverlay() {
    if (panel === 'rules') {
      overlay.innerHTML = modal(`<button class="modal-close" data-action="close" aria-label="关闭规则">×</button><div class="eyebrow">玩法说明</div><h2>彭泽三打一</h2><div class="rules-banner">1 庄家　对战　3 闲家</div><div class="rules-grid">${ruleSections.map((section, index) => `<button class="rule-tile" data-action="rule-detail" data-index="${index}"><span>0${index + 1}</span>${section.title}<p>点击查看玩法规则</p></button>`).join('')}</div><div class="panel-bottom">${button('知道了', 'close', true)}</div>`, 'rules-panel', 'aria-label="玩法说明"');
    } else if (panel === 'ruleDetail') {
      const section = ruleSections[ruleSection];
      overlay.innerHTML = modal(`<button class="modal-close" data-action="rules" aria-label="返回规则目录">×</button><div class="eyebrow">玩法说明</div><h2>${section.title}</h2>${section.detail}${button('返回目录', 'rules', true)}`, 'rule-detail-panel', `aria-label="${section.title}"`);
    } else if (panel === 'expanded') {
      overlay.innerHTML = modal(`<div class="expanded-top"><h2>我的手牌 · ${game.hands[0].length}张</h2>${canSelect() ? countdownHTML() : ''}<button class="text-button" data-action="close">收起 ×</button></div><div class="expanded-grid">${handCards().map(card => cardHTML(card, { interactive: true, selected: selected.has(card.id) })).join('')}</div><div class="expanded-footer"><span>已选 ${selected.size}${game.phase === 'bury' ? '/8' : ' 张'}</span>${canSelect() ? `${button('取消选择', 'clear')}${button(game.phase === 'bury' ? '确认扣底' : '出牌', game.phase === 'bury' ? 'bury' : 'play', true, game.phase === 'bury' ? selected.size !== 8 : selected.size === 0)}` : ''}</div>`, 'expanded-panel', 'aria-label="展开手牌"');
    } else if (panel === 'menu') renderMenu();
    else if (panel === 'score') {
      overlay.innerHTML = modal(`<button class="modal-close" data-action="close" aria-label="关闭分数明细">×</button><div class="eyebrow">庄家抓分</div><h2>${game.dealer === null ? '尚未确定庄家' : `${names[game.dealer]} · 目标${game.highest}`}</h2><div class="score-equation"><div>实际<b>${game.actual || 0}</b></div><i>−</i><div>扣分<b>${game.penalty || 0}</b></div><i>＝</i><div>有效<b>${(game.actual || 0) - (game.penalty || 0)}</b></div></div><p>只计算庄家赢得牌墩中的分牌。扣底不计分。</p>${button('知道了', 'close', true)}`, 'score-panel', 'aria-label="抓分明细"');
    } else if (panel === 'history') {
      overlay.innerHTML = modal(`<button class="modal-close" data-action="close" aria-label="关闭累计输赢">×</button><div class="eyebrow">累计输赢</div><h2>已完成 ${game.history.length} 局</h2><table class="result-table"><thead><tr><th>局数</th>${names.map(name => `<th>${name}</th>`).join('')}</tr></thead><tbody>${game.history.map(entry => `<tr><td>第${entry.round}局</td>${entry.net.map(value => `<td>${amount(value)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td>累计</td>${game.totals.map(value => `<td>${amount(value)}</td>`).join('')}</tr></tfoot></table>`, 'history-panel', 'aria-label="累计输赢"');
    } else if (game.phase === 'result') renderResult();
    else overlay.innerHTML = '';
  }

  function renderResult() {
    const result = game.result;
    const allPass = result.type === 'allPass';
    const title = allPass ? '全员不叫' : `${result.won ? result.effective === result.target ? '刚好达标' : `超${result.effective - result.target}分` : `差${result.target - result.effective}分`} · ${result.won ? '庄家胜' : '未能达标'}`;
    const equation = allPass ? `<p class="allpass-note">首叫位：${names[result.first]} · 赔付30元，其余各得10元</p>` : `<div class="score-equation"><div>目标<b>${result.target}</b></div><i>│</i><div>实际<b>${result.actual}</b></div><i>−</i><div>扣分<b>${result.penalty}</b></div><i>＝</i><div>有效<b>${result.effective}</b></div></div>`;
    overlay.innerHTML = modal(`<div class="result-badge ${!allPass && result.won ? 'win' : ''}">${allPass ? '和' : result.won ? '胜' : '负'}</div><div class="eyebrow">本局结算</div><h2>${title}</h2>${equation}<table class="result-table"><thead><tr><th>玩家</th><th class="result-detail" ${showDetails ? '' : 'hidden'}>正常</th><th class="result-detail" ${showDetails ? '' : 'hidden'}>甩错转账</th><th>本局</th><th>累计</th></tr></thead><tbody>${names.map((name, player) => `<tr><td>${name}${game.dealer === player && !allPass ? ' · 庄' : ''}</td><td class="result-detail" ${showDetails ? '' : 'hidden'}>${amount(result.normal[player])}</td><td class="result-detail" ${showDetails ? '' : 'hidden'}>${amount(result.transfers[player])}</td><td>${amount(result.net[player])}元</td><td>${amount(game.totals[player])}元</td></tr>`).join('')}</tbody></table>${allPass ? '' : `<div class="result-bottom"><span>扣底 · 不计抓分</span><div class="mini-bottom-cards">${game.bottom.map(card => cardHTML(card)).join('')}</div></div>`}<div class="result-actions"><button class="text-button" data-action="result-details">${showDetails ? '收起明细' : '结算明细'}</button>${button('下一局 ›', 'next', true)}<button class="text-button" data-action="history">累计</button><button class="text-button" data-action="rules">规则</button></div>`, 'result-panel', 'aria-label="本局结算"');
  }

  function renderMenu() {
    const labels = [['bid', '看牌叫分'], ['pickup', '庄家收底33张'], ['trump', '定主'], ['bury', '扣底选3张'], ['bury8', '扣底选8张'], ['play', '庄家首攻'], ['ai', 'AI当庄'], ['throwSingle', '甩错单张'], ['throwPair', '甩错对子'], ['timeout', '超时托管'], ['result', '结算示例'], ['exact', '刚好达标'], ['allpass', '全员不叫']];
    overlay.innerHTML = modal(`<button class="modal-close" data-action="close" aria-label="关闭验证面板">×</button><div class="eyebrow">原型校验 · MD V1.1</div><h2>独立验证场景${demoName ? `<span class="scene-badge">${escape(demoName)}</span>` : ''}</h2><p>下列入口会开启独立示例牌局。正常游戏请从首页“开始游戏”进入。</p><div class="dev-grid">${labels.map(([id, label]) => button(label, 'scenario', false, false, `data-scenario="${id}"`)).join('')}${button(fast ? '恢复正常速度' : '加速AI演示', 'speed')}${button('导出过程记录', 'export')}${button('返回首页', 'home')}</div><div class="rule-status">已实现：真实108张、无上限叫分、33→25扣底、单张/对子/明确的拖拉机跟牌、单张/对子甩错、抓分与结算、持续托管。<br>未推定：复杂拖拉机拆分、成功混合甩牌的跟牌和牌权、多类失败结构、缺门影响甩牌检查的分歧牌例。此类选择会在出牌前提示，牌和金额均不变。<br>正常结算金额使用MD暂定V1。托管取消及跨局保持尚未定案，本稿不自动解除托管。</div><p>Figma节点：<code>2:7486</code> · HTML为本地验证稿，最终平台仍为微信小游戏。</p><div class="state-proof">${game.phase === 'home' ? '尚未开局' : escape(`当前阶段 ${game.phase} · 第${game.round}局\n手牌 ${game.hands.map(hand => hand.length).join('/')} · 底牌${game.bottom.length} · 牌组200分\n已结算${game.history.length}局 · 当前${game.managed ? '托管中' : '手动'}`)}</div>`, 'dev-panel', 'aria-label="原型验证场景"');
  }

  function clearActionTimer() {
    clearInterval(actionTimer);
    actionTimer = null;
    deadline = 0;
  }

  function clock() {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    for (const element of board.querySelectorAll('[data-countdown]')) {
      element.textContent = seconds;
      element.classList.toggle('urgent', seconds <= 5);
      element.setAttribute('aria-label', `剩余${seconds}秒`);
    }
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function duration(milliseconds) {
    return fast || reducedMotion ? Math.min(milliseconds, 25) : milliseconds;
  }

  async function animateElement(element, keyframes, options) {
    if (!element.animate) return;
    const animation = element.animate(keyframes, options);
    try { await animation.finished; } catch (error) { if (error.name !== 'AbortError') throw error; }
  }

  async function fly(from, to, card = null, delay = 0) {
    const element = document.createElement('div');
    element.className = `flying-card ${card ? '' : 'card-back'}`;
    if (card) element.innerHTML = cardHTML(card, { small: true });
    motion.append(element);
    await animateElement(element, [
      { transform: `translate(${from.x}px,${from.y}px) rotate(-8deg)`, opacity: 1 },
      { transform: `translate(${to.x}px,${to.y}px) rotate(0deg)`, opacity: 1 }
    ], { duration: duration(340), delay: duration(delay), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
    element.remove();
  }

  function cardPosition(id) {
    const element = surface.querySelector(`[data-card="${id}"]`);
    if (!element) return { x: 400, y: 330 };
    const rect = element.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    return { x: (rect.left - boardRect.left) / scale, y: (rect.top - boardRect.top) / scale };
  }

  async function animateBury(cards, positions, human) {
    await Promise.all(cards.map(async (card, index) => {
      if (!human) return fly({ x: centers[game.dealer].x, y: centers[game.dealer].y }, { x: 632 + index * 9, y: 109 }, null, index * 65);
      const element = document.createElement('div');
      element.className = 'bury-card';
      const from = positions[index];
      element.style.left = `${from.x}px`;
      element.style.top = `${from.y}px`;
      element.innerHTML = `${cardHTML(card)}<div class="bury-back"></div>`;
      motion.append(element);
      await animateElement(element, [
        { transform: 'perspective(700px) translate(0,0) rotateY(0deg) scale(1)', offset: 0 },
        { transform: 'perspective(700px) translate(0,-12px) rotateY(180deg) scale(1)', offset: .48 },
        { transform: `perspective(700px) translate(${632 + index * 9 - from.x}px,${109 - from.y}px) rotateY(180deg) scale(.52)`, offset: 1 }
      ], { duration: duration(650), delay: duration(index * 65), easing: 'cubic-bezier(.25,.65,.3,1)', fill: 'both' });
      element.remove();
    }));
  }

  function sync() {
    clearActionTimer();
    if (game.phase === 'result') clearToast();
    generation += 1;
    selected.clear();
    if (panel === 'expanded') panel = null;
    if (game.actor === 0 && game.phase === 'bidding') bidValue = Math.max(80, game.highest + 5);
    const currentGeneration = generation;
    render();
    if (frozen) return;
    if (game.phase === 'dealing') runDeal(currentGeneration).catch(handleError);
    else if (game.phase === 'pickup') runPickup(currentGeneration).catch(handleError);
    else if (game.phase === 'collecting') runCollect(currentGeneration).catch(handleError);
    else if (['bidding', 'trump', 'bury', 'playing'].includes(game.phase)) startClock(currentGeneration);
  }

  async function runDeal(currentGeneration) {
    for (let count = 0; count < 100; count += 1) {
      if (generation !== currentGeneration) return;
      const player = game.dealOne();
      fly({ x: 404, y: 154 }, { x: centers[player].x - 18, y: centers[player].y - 26 }).catch(handleError);
      if (count % 4 === 3) render();
      await sleep(fast ? 0 : 25);
    }
    if (generation !== currentGeneration) return;
    game.dealOne();
    game.assertIntegrity();
    record('发牌完成', { counts: game.hands.map(hand => hand.length), bottom: game.bottom.length });
    await sleep(duration(350));
    if (generation === currentGeneration) sync();
  }

  async function runPickup(currentGeneration) {
    const player = game.dealer;
    await Promise.all(Array.from({ length: 8 }, (_, index) => fly({ x: 632 + index * 9, y: 109 }, { x: centers[player].x - 18, y: centers[player].y - 26 }, null, index * 55)));
    if (generation !== currentGeneration) return;
    record('庄家收底完成', { dealer: player, count: game.hands[player].length });
    game.finishPickup();
    sync();
  }

  async function runCollect(currentGeneration) {
    const winner = game.winner();
    await sleep(duration(700));
    if (generation !== currentGeneration) return;
    const rect = board.getBoundingClientRect();
    const cards = Array.from(surface.querySelectorAll('.play-zone .poker-card'));
    await Promise.all(cards.map((element, index) => {
      const position = element.getBoundingClientRect();
      element.style.visibility = 'hidden';
      return fly({ x: (position.left - rect.left) / scale, y: (position.top - rect.top) / scale }, { x: centers[winner].x - 18, y: centers[winner].y - 26 }, null, index * 12);
    }));
    if (generation !== currentGeneration) return;
    const result = game.finishTrick();
    record('牌墩结算', { winner, points: result.points, actual: game.actual });
    if (winner === game.dealer && result.points) toast(`${names[winner]}抓分 +${result.points}`);
    sync();
  }

  function startClock(currentGeneration) {
    const expectedVersion = game.version;
    const automatic = game.actor !== 0 || game.managed;
    deadline = Date.now() + 20000;
    const autoAt = automatic ? Date.now() + (fast ? 8 : 700) : Infinity;
    clock();
    actionTimer = setInterval(() => {
      if (generation !== currentGeneration || game.version !== expectedVersion) return clearActionTimer();
      clock();
      if (Date.now() >= deadline) {
        game.expire(expectedVersion);
        record('超时进入托管');
        toast('已进入托管');
        clearActionTimer();
        autoAction().catch(handleError);
      } else if (Date.now() >= autoAt) {
        clearActionTimer();
        autoAction().catch(handleError);
      }
    }, fast ? 10 : 100);
  }

  async function autoAction() {
    const player = game.actor;
    if (game.phase === 'bidding') {
      const value = game.aiBid(player);
      game.bid(player, value);
      record('AI叫分', { player, amount: value });
      sync();
    } else if (game.phase === 'trump') {
      const suit = game.aiTrump(player);
      game.chooseTrump(player, suit);
      record('AI定主', { player, suit });
      sync();
    } else if (game.phase === 'bury') await submitBury(game.aiBury(player));
    else if (game.phase === 'playing') await submitPlay(game.aiPlay(player));
  }

  async function submitBury(ids) {
    const player = game.actor;
    const positions = ids.map(cardPosition);
    const cards = game.bury(player, ids);
    clearToast();
    clearActionTimer();
    selected.clear();
    panel = null;
    const currentGeneration = ++generation;
    render();
    await animateBury(cards, positions, player === 0);
    if (generation !== currentGeneration) return;
    game.finishBury();
    record('扣底完成', { dealer: player, bottomCount: game.bottom.length, count: game.hands[player].length });
    sync();
  }

  async function submitPlay(ids) {
    const player = game.actor;
    const positions = new Map(ids.map(id => [id, cardPosition(id)]));
    const result = game.play(player, ids);
    clearToast();
    clearActionTimer();
    panel = null;
    selected.clear();
    const currentGeneration = ++generation;
    render();
    if (result.failedCount) {
      const punishment = player === game.dealer ? `扣${result.failedCount * 10}分` : `赔付${result.failedCount * 15}元`;
      toast(`甩牌失败，${punishment}`);
      record('甩牌失败', { player, count: result.failedCount, punishment });
    }
    const zone = surface.querySelector(`[data-played-seat="${player}"]`);
    const rect = zone.getBoundingClientRect();
    const tableRect = board.getBoundingClientRect();
    zone.style.visibility = 'hidden';
    await Promise.all(result.cards.map((card, index) => fly(player === 0 ? positions.get(card.id) : { x: centers[player].x - 18, y: centers[player].y - 26 }, { x: (rect.left - tableRect.left) / scale + index * 23, y: (rect.top - tableRect.top) / scale }, card, index * 30)));
    if (generation !== currentGeneration) return;
    record('出牌', { player, cards: result.cards.map(card => card.id), handCount: game.hands[player].length });
    sync();
  }

  function handleError(error) {
    toast(error.message || '操作未完成');
    record('操作未提交', { message: error.message, code: error.code || 'ERROR' });
  }

  function fixtureDeal(preferences = [[], [], [], []]) {
    const fixture = new Rules.Game({ seed: 20261108, first: 0 });
    fixture.start();
    fixture.finishDeal();
    let pool = Rules.deck();
    const hands = preferences.map(ids => ids.map(id => {
      const index = pool.findIndex(card => card.id === id);
      if (index < 0) throw new Error('演示牌组存在重复牌');
      return pool.splice(index, 1)[0];
    }));
    pool = Rules.shuffle(pool, Rules.random(1440));
    for (const hand of hands) while (hand.length < 25) hand.push(pool.shift());
    fixture.hands = hands;
    fixture.bottom = pool;
    fixture.assertIntegrity();
    return fixture;
  }

  function fixtureDealer(fixture, dealer = 0) {
    for (let count = 0; count < 4; count += 1) fixture.bid(fixture.actor, fixture.actor === dealer ? 80 : null);
    return fixture;
  }

  function fixturePlay(fixture) {
    fixtureDealer(fixture);
    fixture.finishPickup();
    fixture.chooseTrump(0, 'S');
    const protectedIds = new Set(fixture.hands[0].filter(card => ['D', 'J'].includes(card.suit)).map(card => card.id));
    let bury = fixture.hands[0].filter(card => !protectedIds.has(card.id)).slice(0, 8);
    if (bury.length < 8) bury = fixture.hands[0].slice(-8);
    fixture.bury(0, bury.map(card => card.id));
    fixture.finishBury();
    return fixture;
  }

  function fixtureResult(exact = false) {
    const fixture = fixturePlay(fixtureDeal());
    let pool = Rules.deck();
    function takePoints(target) {
      const chosen = [];
      let total = 0;
      for (const card of pool) {
        const value = Rules.points([card]);
        if (value && total + value <= target) {
          chosen.push(card);
          total += value;
        }
        if (total === target) break;
      }
      const used = new Set(chosen.map(card => card.id));
      pool = pool.filter(card => !used.has(card.id));
      return chosen;
    }
    const bottomPoints = takePoints(20);
    const zeroCards = pool.filter(card => Rules.points([card]) === 0).slice(0, 8 - bottomPoints.length);
    fixture.bottom = [...bottomPoints, ...zeroCards];
    const bottomIds = new Set(fixture.bottom.map(card => card.id));
    pool = pool.filter(card => !bottomIds.has(card.id));
    fixture.captured = [takePoints(exact ? 80 : 90), [], [], []];
    fixture.captured[1] = pool;
    fixture.hands = [[], [], [], []];
    fixture.trick = [];
    fixture.actual = exact ? 80 : 90;
    fixture.penalty = exact ? 0 : 20;
    fixture.transfers = exact ? [0, 0, 0, 0] : [15, -15, 0, 0];
    fixture.settle(Rules.normalSettlement(0, fixture.actual, fixture.penalty, 80, fixture.transfers));
    fixture.assertIntegrity();
    return fixture;
  }

  function loadScenario(id, keepFrozen = false) {
    clearActionTimer();
    clearToast();
    generation += 1;
    motion.replaceChildren();
    frozen = keepFrozen;
    selected.clear();
    panel = null;
    demoName = id;
    if (id === 'home') {
      game = new Rules.Game();
      demoName = '';
    } else if (id === 'result' || id === 'exact') game = fixtureResult(id === 'exact');
    else if (id === 'throwSingle') {
      game = fixturePlay(fixtureDeal([['0-D-2', '0-D-4', '0-D-6'], ['0-D-3'], ['0-D-7'], ['0-D-8']]));
      selected = new Set(['0-D-2', '0-D-4', '0-D-6']);
    } else if (id === 'throwPair') {
      game = fixturePlay(fixtureDeal([['0-D-14', '1-D-14', '0-D-4', '1-D-4'], ['0-D-13', '1-D-13'], ['0-D-7'], ['0-D-8']]));
      selected = new Set(['0-D-14', '1-D-14', '0-D-4', '1-D-4']);
    } else {
      game = fixtureDeal();
      if (id === 'allpass') while (game.phase === 'bidding') game.bid(game.actor, null);
      else if (id !== 'bid') {
        fixtureDealer(game, id === 'ai' ? 1 : 0);
        if (!['pickup', 'ai'].includes(id)) {
          game.finishPickup();
          if (id !== 'trump') {
            game.chooseTrump(0, 'S');
            if (id === 'bury' || id === 'bury8') selected = new Set(Rules.sort(game.hands[0], game.trump).slice(0, id === 'bury' ? 3 : 8).map(card => card.id));
            else {
              game.bury(0, game.aiBury(0));
              game.finishBury();
            }
          }
        }
      }
    }
    const selection = new Set(selected);
    sync();
    selected = selection;
    render();
    record('加载独立演示', { scenario: id });
    if (id === 'timeout' && !frozen) deadline = Date.now() + 5000;
  }

  async function perform(action, element) {
    if (action === 'start' || action === 'next') {
      clearToast();
      frozen = false;
      panel = null;
      demoName = '';
      game.start();
      record('开始新局');
      return sync();
    }
    if (action === 'rules') { panel = 'rules'; return renderOverlay(); }
    if (action === 'rule-detail') { ruleSection = Number(element.dataset.index); panel = 'ruleDetail'; return renderOverlay(); }
    if (action === 'close') { panel = null; return renderOverlay(); }
    if (action === 'menu') { panel = 'menu'; return renderOverlay(); }
    if (action === 'score') { panel = 'score'; return renderOverlay(); }
    if (action === 'history') { panel = 'history'; return renderOverlay(); }
    if (action === 'expand') { panel = 'expanded'; return renderOverlay(); }
    if (action === 'result-details') { showDetails = !showDetails; return renderOverlay(); }
    if (action === 'scenario') return loadScenario(element.dataset.scenario);
    if (action === 'allpass') return loadScenario('allpass');
    if (action === 'home') return loadScenario('home');
    if (action === 'speed') { fast = !fast; renderOverlay(); return toast(fast ? '已加速AI与动画，真人操作仍为20秒' : '已恢复正常速度'); }
    if (action === 'export') {
      const file = new Blob([JSON.stringify({ rulesVersion: 'V1.1', source: 'Figma 2:7486', scenario: demoName, events }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '彭泽三打一_验证记录.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (action === 'card') {
      if (!canSelect()) return;
      const id = element.dataset.card;
      if (selected.has(id)) selected.delete(id);
      else {
        if (game.phase === 'bury' && selected.size >= 8) return toast('最多选8张');
        selected.add(id);
      }
      return render();
    }
    if (action === 'clear') { selected.clear(); return render(); }
    if (action === 'bid-up' || action === 'bid-down') {
      bidValue = Math.max(80, game.highest + 5, bidValue + (action === 'bid-up' ? 5 : -5));
      return render();
    }
    if (action === 'bid' || action === 'pass') {
      game.bid(0, action === 'pass' ? null : bidValue);
      record('真人叫分', { amount: action === 'pass' ? null : bidValue });
      return sync();
    }
    if (action === 'trump-option') { chosenTrump = element.dataset.suit; return render(); }
    if (action === 'trump') {
      game.chooseTrump(0, chosenTrump);
      record('真人定主', { suit: chosenTrump });
      return sync();
    }
    if (action === 'bury') return submitBury(Array.from(selected));
    if (action === 'play') return submitPlay(Array.from(selected));
    if (action === 'hint') {
      selected = new Set(game.aiPlay(0));
      return render();
    }
  }

  board.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    Promise.resolve(perform(target.dataset.action, target)).catch(handleError);
  });

  board.addEventListener('input', event => {
    if (event.target.id !== 'bid-value') return;
    bidValue = Number(event.target.value);
    const submit = board.querySelector('[data-action="bid"]');
    if (submit) submit.textContent = `叫${Number.isFinite(bidValue) ? bidValue : '—'}分`;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel) { panel = null; renderOverlay(); }
  });

  window.PengzeValidation = {
    get game() { return game; },
    get timerCount() { return actionTimer === null ? 0 : 1; },
    get events() { return events.slice(); },
    get deadline() { return deadline; },
    get selected() { return Array.from(selected); },
    get frozen() { return frozen; },
    scenario: loadScenario,
    freeze(value = true) { frozen = value; if (value) clearActionTimer(); else sync(); },
    setFast(value) { fast = value; },
    expireNow() { if (deadline) deadline = Date.now() - 1; },
    refresh: render,
    fixtureDeal,
    fixturePlay,
    fixtureResult
  };

  resize();
  if (params.has('review')) loadScenario(params.get('review'), true);
  else render();
})();
