/* =====================================================================
   潮汐秘境 · 残局分析器（界面层）
   棋盘状态：-1 未翻开 / 0-8 已翻开数字 / 'G' 宝钻 / 'X' × 标记
   ===================================================================== */
(() => {
  'use strict';

  // 各尺寸的宝钻总数由活动固定，不可更改
  const GEM_TOTAL = { 8: 20, 10: 30, 12: 45 };
  const OCR_ENABLED = window.TIDAL_OCR !== false;   // 静态托管版把 window.TIDAL_OCR 设为 false
  const DOUBLE_MS = 340;   // 两次按下间隔小于此值算「双击翻开」

  const $ = (s) => document.querySelector(s);
  const el = {
    board: $('#board'),
    boardScroll: $('#board-scroll'),
    sizeSeg: $('#size-seg'),
    gemTotalText: $('#gem-total-text'),
    filled: $('#filled-count'),
    cellTotal: $('#cell-total'),
    palette: $('#palette'),
    advice: $('#advice'),
    adviceText: $('#advice-text'),
    revealBar: $('#reveal-bar'),
    rbTarget: $('#rb-target'),
    rbValues: $('#rb-values'),
    rbHint: $('#rb-hint'),
    btnMarkSafe: $('#btn-mark-safe'),
    vbGem: $('#vb-gem'),
    vbSafe: $('#vb-safe'),
    vbUnknown: $('#vb-unknown'),
    vbErrWrap: $('#vb-err-wrap'),
    vbErr: $('#vb-err'),
    modal: $('#modal'),
    modalBox: $('#modal-box'),
    toasts: $('#toasts'),
  };

  const S = {
    rows: 8,
    cols: 8,
    gemTotal: GEM_TOTAL[8],
    grid: [],
    nodes: [],
    brush: 'X',           // 默认笔刷 = × 标记，单击即标 ×（与游戏一致）
    aiCells: new Set(),   // 截图识别填进来的格子，需人工核对
    unsure: new Set(),    // 识图模型自己没把握的格子
    result: null,
    detailHtml: '',       // 明细，供「使用说明」展示
    painting: null,
    awaiting: -1,         // 正在等待选择「翻开值」的格子
    lastTap: { i: -1, t: 0 },
    pressBackup: null,    // 记录按下前的值，供双击时回滚
    history: [],          // 撤销栈：每项是「那一步之前」的盘面快照
    histBase: null,       // 本次操作开始前的快照，抬手时才入栈（拖动连涂算一步）
    importTimer: null,
    importPreviewUrl: null,
    ocrBlob: null,        // 待识别的图片
    shotSize: 8,          // 识别时确认的地图尺寸
    ocrCanceled: false,
    pasteBound: false,
  };

  /* ---------- 工具 ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const coord = (r, c) => `${r + 1}行${c + 1}列`;

  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' is-' + kind : '');
    t.textContent = msg;
    el.toasts.appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 320); }, 2600);
  }

  /* ---------- 棋盘尺寸自适应 ---------- */
  function fitBoard() {
    const cols = S.cols, rows = S.rows;
    const gap = cols > 10 ? 5 : 6;
    const cs = getComputedStyle(el.boardScroll);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    const availW = Math.max(180, el.boardScroll.clientWidth - padX - 2);
    let cell = Math.floor((availW - gap * (cols - 1)) / cols);

    const rect = el.boardScroll.getBoundingClientRect();
    // 下方留给建议条 + 结论条，再给底部浮着的取值条留位置
    const below = (el.advice ? el.advice.offsetHeight : 30) +
                  (document.querySelector('.verdict-bar') ? document.querySelector('.verdict-bar').offsetHeight : 48) + 96;
    const availH = Math.max(160, window.innerHeight - rect.top - below - padY);
    const byH = Math.floor((availH - gap * (rows - 1)) / rows);
    if (byH > 0) cell = Math.min(cell, byH);

    cell = clamp(cell, 18, 78);
    el.board.style.setProperty('--gap', gap + 'px');
    el.board.style.setProperty('--cell', cell + 'px');
    el.board.style.setProperty('--font', Math.round(cell * 0.54) + 'px');
    return cell;
  }

  /* ---------- 棋盘构建 / 绘制 ---------- */
  function buildBoard() {
    const { rows, cols } = S;
    el.board.style.setProperty('--cols', cols);
    const frag = document.createDocumentFragment();
    const nodes = new Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.dataset.i = i;
        b.dataset.r = r;
        b.dataset.c = c;
        nodes[i] = b;
        frag.appendChild(b);
      }
    }
    el.board.innerHTML = '';
    el.board.appendChild(frag);
    S.nodes = nodes;
    el.cellTotal.textContent = rows * cols;
    fitBoard();
    paint();
  }

  function newGrid(rows, cols) {
    return Array.from({ length: rows }, () => new Array(cols).fill(-1));
  }

  function paint() {
    const { rows, cols, grid } = S;
    const res = S.result;
    const hasClue = (() => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (typeof grid[r][c] === 'number' && grid[r][c] >= 0) return true;
      return false;
    })();
    const showProb = hasClue && parseFloat(getComputedStyle(el.board).getPropertyValue('--cell')) >= 26;
    let filled = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const node = S.nodes[i];
        if (!node) continue;
        const v = grid[r][c];
        if (v !== -1) filled++;

        let cls = 'cell';
        let text = '';
        if (v === 'G') { cls += ' is-open is-gem'; }
        else if (v === 'X') { cls += ' is-x'; }
        else if (typeof v === 'number' && v >= 0) {
          cls += ' is-open';
          if (v > 0) { cls += ' n' + v; text = String(v); }
        }
        if (S.aiCells.has(i)) cls += ' is-ai';
        if (S.unsure.has(i)) cls += ' is-unsure';
        if (S.awaiting === i) cls += ' awaiting';

        let badge = '';
        if (res) {
          const marked = v === 'X';
          if (marked) {
            // 打了 ×（= 已确认这格没有宝钻）就不再重复显示 ✓；只有标错了才报警
            if (res.knownGem && res.knownGem[i]) { cls += ' say-conflict'; badge = '!'; }
          } else if (res.knownGem && res.knownGem[i] && v !== 'G') {
            cls += ' say-gem'; badge = '◆';
          } else if (res.knownSafe && res.knownSafe[i]) {
            cls += ' say-safe'; badge = '✓';
          } else if (res.probs && res.probs[i] != null && showProb) {
            cls += ' say-prob';
            const p = res.probs[i];
            badge = p >= 0.995 ? '≈1' : p <= 0.005 ? '≈0' : Math.round(p * 100) + '%';
          }
          if (res.pick && res.pick.i === i) cls += ' pick';
        }

        if (node.className !== cls) node.className = cls;
        const key = text || (v === 'G' ? 'G' : v === 'X' ? 'X' : '');
        if (node.dataset.k !== key) {
          node.dataset.k = key;
          node.innerHTML = v === 'G' ? '<svg class="ico" aria-hidden="true"><use href="#ico-gem"/></svg>'
            : v === 'X' ? '<svg class="ico" aria-hidden="true"><use href="#ico-x"/></svg>'
            : text;
        }
        if (badge) { if (node.dataset.badge !== badge) node.dataset.badge = badge; }
        else if (node.dataset.badge) { node.removeAttribute('data-badge'); }
      }
    }
    el.filled.textContent = filled;
    S.filledCount = filled;
  }

  /* ---------- 分析 ---------- */
  function analyze() {
    const res = window.TidalSolver.solve({
      rows: S.rows,
      cols: S.cols,
      cells: S.grid,
      gemTotal: Number.isFinite(S.gemTotal) ? S.gemTotal : null,
    });
    S.result = res;
    paint();
    renderPanels(res);
    updateUndoBtn();
  }

  function coordChips(list, cls, limit, withProb) {
    const shown = list.slice(0, limit);
    const html = shown.map((x) => {
      const p = withProb && x.p != null ? `<small>${Math.round(x.p * 100)}%</small>` : '';
      const why = x.why ? ` title="${String(x.why).replace(/"/g, '')}"` : '';
      return `<span class="coord ${cls}"${why}>${coord(x.r, x.c)}${p}</span>`;
    }).join('');
    const more = list.length > limit ? `<span class="coord-more">…还有 ${list.length - limit} 处</span>` : '';
    return `<div class="coord-list">${html || '<span class="coord-more">无</span>'}${more}</div>`;
  }

  function describeConflict(x) {
    return x.tooMany
      ? `显示数字 ${x.clue}，但周围已经翻出 ${x.gems} 颗宝钻`
      : `显示数字 ${x.clue}，需要 ${x.want} 颗宝钻，却只剩 ${x.hidden} 格没翻开`;
  }

  /** 一行建议条（始终显示在棋盘下方） */
  function adviceLine(res) {
    const c = res.counts;
    if (S.filledCount === 0) return { kind: '', text: '先把残局填进来，或点右上角「载入示例」看效果。' };
    if (c.hiddenCells === 0) return { kind: '', text: '棋盘已填满，没有未翻开的格子了。' };
    const pick = res.pick;
    if (!pick) return { kind: '', text: '还没有数字线索：先把已翻开的格子和宝钻填进来。' };
    if (pick.type === 'gem') {
      return { kind: 'gem', text: `先点开 ${coord(pick.r, pick.c)} —— 必定是宝钻（${pick.why || '由数字推出'}）` };
    }
    if (pick.type === 'safe') {
      return { kind: 'safe', text: `没有能确定的宝钻；先翻开 ${coord(pick.r, pick.c)}（必定安全，可扩开线索）—— ${pick.why || '由数字推出'}` };
    }
    const hi = pick, lo = pick.alt;
    return {
      kind: 'warn',
      text: `推不出确定格子：想赌分翻 ${coord(hi.r, hi.c)}（含宝钻 ${Math.round(hi.p * 100)}%），想探线索翻 ${lo ? coord(lo.r, lo.c) + '（' + Math.round(lo.p * 100) + '%）' : '—'}`,
    };
  }

  function renderPanels(res) {
    const c = res.counts;
    el.vbGem.textContent = c.certainGems;
    el.vbSafe.textContent = c.certainSafe;
    el.vbUnknown.textContent = c.undecided;
    el.btnMarkSafe.disabled = c.certainSafe === 0;

    /* 建议条 */
    const adv = adviceLine(res);
    el.adviceText.textContent = adv.text;
    el.advice.className = 'advice' + (adv.kind ? ' is-' + adv.kind : '');

    /* 错误提示 */
    const errText = res.impossible
      ? '盘面与宝钻总数矛盾'
      : (res.conflicts.length ? `${res.conflicts.length} 处数字对不上（详见使用说明）` : '');
    el.vbErrWrap.hidden = !errText;
    el.vbErr.textContent = errText || '';

    /* 明细：全部收进「使用说明」 */
    let html = '';
    html += `<ul class="meta-list">
      <li><span>本图宝钻总数</span><b>${c.gemTotal == null ? '未填' : c.gemTotal}</b></li>
      <li><span>已确认宝钻</span><b>${c.knownGems} 颗</b></li>
      <li><span>还需找出</span><b>${c.remainingGems == null ? '—' : c.remainingGems + ' 颗'}</b></li>
      <li><span>必定是宝钻</span><b>${c.certainGems} 处</b></li>
      <li><span>必定安全</span><b>${c.certainSafe} 处</b></li>
      <li><span>无法确定</span><b>${c.undecided} 格</b></li>
      <li><span>未翻开总计</span><b>${c.hiddenCells} 格</b></li>
    </ul>`;

    html += `<div class="block-title">下一步</div><p class="card-desc">${adv.text}</p>`;

    if (c.certainGems) html += `<div class="block-title">必定是宝钻（去翻这些）</div>${coordChips(res.certainGems, 'c-gem', 20)}`;
    if (c.certainSafe) html += `<div class="block-title">必定安全（可以标 ×）</div>${coordChips(res.certainSafe, 'c-safe', 20)}`;
    if (res.undecided.length) {
      const lo = res.undecided[0], hi = res.undecided[res.undecided.length - 1];
      html += `<div class="advice-why" style="margin-top:10px">待定格含宝钻概率区间 ${Math.round(lo.p * 100)}% ~ ${Math.round(hi.p * 100)}%${res.approx ? '（其中有过大的分组，已按估算处理）' : ''}</div>`;
    }

    /* 盘面自检 */
    html += `<div class="block-title">盘面自检</div>`;
    const nCells = res.numberCells || 0;
    if (!nCells) {
      html += `<p class="card-desc">还没有填任何数字格。填上已翻开格子显示的数字，才能开始推理。</p>`;
    } else if (res.conflicts.length) {
      html += `<p class="card-desc" style="color:var(--warn-ink)">下面这些格子的数字与周围情况对不上，多半是<b>数字填错</b>（或截图识别读错了）。先核对这几格，否则后面结论都会偏：</p>
        <div style="margin-top:9px">${coordChips(res.conflicts, 'c-warn', 12)}</div>
        <div class="advice-why" style="margin-top:9px">${res.conflicts.slice(0, 5).map((x) => '· ' + coord(x.r, x.c) + ' ' + describeConflict(x)).join('<br>')}</div>`;
    } else {
      html += `<p class="card-desc">✔ 已填的 <b>${nCells}</b> 个数字格全部符合「<b>数字 = 周围 8 格的宝钻数</b>」，这个盘面可以放心用。</p>`;
    }
    if (res.impossible) {
      html += `<p class="advice-why" style="margin-top:9px;color:var(--warn-ink)">当前盘面与「宝钻总数 ${c.gemTotal}」无法同时成立：可能某格填错了，或总数不对。</p>`;
    }

    /* × 标记检查 */
    html += `<div class="block-title">你的 × 标记检查</div>`;
    if (!res.markedX.some((v) => v)) {
      html += `<p class="card-desc">棋盘上还没有 × 标记。标 × 是记录「这格没宝钻」，它不参与推理，只用来核对。</p>`;
    } else {
      let m = '';
      if (res.markWrong.length) {
        m += `<div class="advice-lead"><span class="tag tag-warn">有 ${res.markWrong.length} 处标错了</span></div>
              <div class="advice-why" style="margin:6px 0 8px">这些格子按推导必定是宝钻，却被标成了 ×：</div>
              ${coordChips(res.markWrong, 'c-warn', 12)}`;
      }
      if (res.markRisky.length) {
        m += `<div class="block-title">这些 × 没有依据支持（含宝钻概率不低）</div>${coordChips(res.markRisky, 'c-gem', 12, true)}`;
      }
      if (!res.markWrong.length && !res.markRisky.length) {
        m += `<p class="card-desc">✔ 所有 × 标记都与推导一致，没有发现问题。</p>`;
      }
      html += m;
    }

    S.detailHtml = html;
  }

  /* ---------- 交互：涂格子 ---------- */
  function applyBrush(node, mode) {
    const r = +node.dataset.r, c = +node.dataset.c;
    const i = r * S.cols + c;
    let v;
    if (mode === 'erase') v = -1;                                     // 右键 / 清除笔刷
    else if (S.brush === 'X') v = S.grid[r][c] === 'X' ? -1 : 'X';    // 单击 = 切换 ×（与游戏一致）
    else v = S.brush === 'G' ? 'G' : Number(S.brush);
    if (S.grid[r][c] === v && !S.aiCells.has(i)) return;
    S.grid[r][c] = v;
    S.aiCells.delete(i);
    S.unsure.delete(i);
    analyze();
  }

  /* ---------- 双击翻开：选择这一格翻出来是什么 ---------- */
  /**
   * 这一格周围可能出现的数字范围。
   * 数字 = 周围 8 格里宝钻的总数（含已经翻出来的），所以：
   *   下限 = 周围已经翻出的宝钻数（这些一定算数）
   *   上限 = 周围还可能藏宝钻的格数 = 周围格数 − 已确定不可能是宝钻的格数
   *          （已确定不是宝钻的：打了 × 的格、已经翻开是数字的格）
   * 例：8 个邻居里有 2 个标了 ×、1 个已经是宝钻 → 只能填 1~6
   */
  function revealRange(r, c) {
    let known = 0, blocked = 0, total = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= S.rows || cc >= S.cols) continue;
        total++;
        const v = S.grid[rr][cc];
        if (v === 'G') known++;                                        // 已翻出的宝钻：一定算进数字
        else if (v === 'X') blocked++;                                  // 标了 ×：确定没有宝钻
        else if (typeof v === 'number' && v >= 0) blocked++;            // 已翻开的数字格：不可能是宝钻
      }
    }
    return { min: known, max: Math.max(known, total - blocked), total, known, blocked };
  }

  function openRevealBar(i) {
    const r = (i / S.cols) | 0, c = i % S.cols;
    const rng = revealRange(r, c);
    S.awaiting = i;
    el.rbTarget.textContent = coord(r, c);
    const btns = [];
    for (let v = rng.min; v <= rng.max; v++) {
      btns.push('<button class="rb-btn' + (v === 0 ? ' rb-zero' : '') + '" data-val="' + v + '" type="button">' + (v === 0 ? '空白 0' : v) + '</button>');
    }
    btns.push('<button class="rb-btn rb-gem" data-val="G" type="button"><svg class="ico"><use href="#ico-gem"/></svg>宝钻</button>');
    el.rbValues.innerHTML = btns.join('');

    const parts = [];
    if (rng.total < 8) parts.push(`周围只有 ${rng.total} 格`);
    if (rng.known) parts.push(`${rng.known} 颗已是宝钻`);
    if (rng.blocked) parts.push(`${rng.blocked} 格已排除`);
    el.rbHint.textContent = parts.length
      ? `（${parts.join(' · ')}）只能填 ${rng.min}~${rng.max}`
      : '';
    el.revealBar.hidden = false;
    paint();
    try { S.nodes[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }

  function closeRevealBar() {
    if (S.awaiting < 0) return;
    S.awaiting = -1;
    el.revealBar.hidden = true;
    paint();
  }

  function setReveal(v) {
    const i = S.awaiting;
    if (i < 0) return;
    const r = (i / S.cols) | 0, c = i % S.cols;
    mark();                       // 双击翻开这整段算一步（起点＝第一次按下之前）
    S.grid[r][c] = v;
    S.aiCells.delete(i);
    S.unsure.delete(i);
    closeRevealBar();
    analyze();
    settle();
  }

  /* ---------- 撤销：记录「每一步之前」的盘面 ----------
     一次操作 = 一次按下到抬手（拖动连涂整体算一步）；
     双击翻开则从第一次按下算到选完取值，中间那次 × 的反复不留撤销位。 */
  const HIST_MAX = 200;   // 一局残局也就几十步，够用

  function snap() {
    return {
      rows: S.rows,
      cols: S.cols,
      gemTotal: S.gemTotal,
      grid: S.grid.map((row) => row.slice()),
      ai: Array.from(S.aiCells),
      unsure: Array.from(S.unsure),
    };
  }

  function sameSnap(a, b) {
    if (!a || !b) return false;
    if (a.rows !== b.rows || a.cols !== b.cols) return false;
    for (let r = 0; r < a.grid.length; r++) {
      if (a.grid[r].length !== b.grid[r].length) return false;
      for (let c = 0; c < a.grid[r].length; c++) if (a.grid[r][c] !== b.grid[r][c]) return false;
    }
    return a.ai.length === b.ai.length && a.unsure.length === b.unsure.length;
  }

  // 操作开始前调用；同一次操作里重复调用只记第一张快照
  function mark() { if (!S.histBase) S.histBase = snap(); }

  // 操作结束时调用。真改动了盘面才占一个撤销位；返回是否入栈
  function settle() {
    if (!S.histBase) return false;
    const base = S.histBase;
    S.histBase = null;
    if (sameSnap(base, snap())) return false;                 // 这一步没改动
    const top = S.history[S.history.length - 1];
    if (top && sameSnap(top, base)) return false;             // 与上一步起点相同，去重
    S.history.push(base);
    if (S.history.length > HIST_MAX) S.history.shift();
    updateUndoBtn();
    return true;
  }

  // 双击把第一次按下的改动抵消掉之后调用：那一步已经不存在了，别留撤销位
  function dropNoopTop() {
    const top = S.history[S.history.length - 1];
    if (top && sameSnap(top, snap())) { S.history.pop(); updateUndoBtn(); }
  }

  function resetHistory() { S.history.length = 0; S.histBase = null; updateUndoBtn(); }

  function updateUndoBtn() {
    const b = $('#btn-undo');
    if (b) b.disabled = !S.history.length;
  }

  function undo() {
    // 取值栏开着：这一步还没定下来，先当「取消这次翻开」
    if (S.awaiting >= 0) { closeRevealBar(); return true; }
    settle();
    if (!S.history.length) { toast('没有可撤销的操作'); updateUndoBtn(); return false; }
    const s = S.history.pop();
    S.rows = s.rows; S.cols = s.cols;
    S.gemTotal = s.gemTotal;
    if (el.gemTotalText) el.gemTotalText.textContent = S.gemTotal;
    if (el.sizeSeg) el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.rows));
    S.grid = s.grid.map((row) => row.slice());
    S.aiCells = new Set(s.ai);
    S.unsure = new Set(s.unsure);
    buildBoard();
    analyze();
    toast('已撤销上一步');
    return true;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    el.board.addEventListener('pointerdown', (e) => {
      const node = e.target.closest('.cell');
      if (!node) return;
      const i = +node.dataset.i;
      const r = +node.dataset.r;
      const c = +node.dataset.c;
      const now = Date.now();

      // 右键 = 清除
      if (e.button === 2) {
        S.painting = 'erase';
        mark();
        applyBrush(node, 'erase');
        if (S.awaiting === i) closeRevealBar();
        return;
      }

      // 取值栏正等着这一格：后续按下（双击序列的第二次）忽略，
      // 否则会把刚撤销掉的 × 又补回来
      if (S.awaiting === i) return;
      if (S.awaiting >= 0) closeRevealBar();   // 点了别的格子，收起取值栏

      // 双击 = 翻开。不用原生 dblclick：pointerdown 里若调 preventDefault，
      // 浏览器会连带取消合成的 dblclick，双击就永远收不到。
      if (S.lastTap.i === i && now - S.lastTap.t < DOUBLE_MS) {
        S.lastTap = { i: -1, t: 0 };
        S.painting = null;
        if (S.pressBackup && S.pressBackup.i === i) {
          S.grid[r][c] = S.pressBackup.prev;   // 撤销第一次按下的改动
          S.pressBackup = null;
          dropNoopTop();                       // 那一步随之作废，不留撤销位
        }
        openRevealBar(i);
        return;
      }

      S.lastTap = { i, t: now };
      S.pressBackup = { i, prev: S.grid[r][c] };
      S.painting = 'paint';
      mark();
      applyBrush(node, 'paint');
    });

    el.board.addEventListener('pointerover', (e) => {
      if (!S.painting) return;
      const node = e.target.closest('.cell');
      if (node) applyBrush(node, S.painting);
    });
    window.addEventListener('pointerup', () => { S.painting = null; settle(); });
    window.addEventListener('blur', () => { S.painting = null; settle(); });
    el.board.addEventListener('contextmenu', (e) => e.preventDefault());

    // 键盘操作（按钮 Enter/Space 触发 click，detail === 0）
    el.board.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      const node = e.target.closest('.cell');
      if (node) { mark(); applyBrush(node, 'paint'); settle(); }
    });

    // 取值条
    el.rbValues.addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b) return;
      const raw = b.dataset.val;
      setReveal(raw === 'G' ? 'G' : Number(raw));
    });
    el.revealBar.addEventListener('click', (e) => {
      if (e.target.closest('[data-rb="cancel"]')) closeRevealBar();
    });

    // 笔刷
    el.palette.addEventListener('click', (e) => {
      const b = e.target.closest('.brush');
      if (!b) return;
      S.brush = b.dataset.brush;
      el.palette.querySelectorAll('.brush').forEach((x) => x.classList.toggle('is-on', x === b));
    });

    // 尺寸
    el.sizeSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      setSize(Number(b.dataset.size));
    });

    // 一键把推导出的必定安全格标上 ×
    el.btnMarkSafe.addEventListener('click', () => {
      const res = S.result;
      if (!res || !res.certainSafe.length) return;
      mark();
      let n = 0;
      for (const cd of res.certainSafe) {
        if (S.grid[cd.r][cd.c] !== 'X') { S.grid[cd.r][cd.c] = 'X'; n++; }
        S.unsure.delete(cd.i);
        S.aiCells.delete(cd.i);
      }
      analyze();
      settle();
      toast(`已标上 ${n} 个 ×`, 'gold');
    });

    // 顶栏
    $('#btn-help').addEventListener('click', openHelp);
    $('#btn-shot-open').addEventListener('click', openShotModal);
    $('#btn-clear').addEventListener('click', () => {
      mark();
      clearAll();
      toast(settle() ? '已清空棋盘 · 可撤销' : '棋盘本来就是空的');
    });
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-sample').addEventListener('click', loadSample);

    el.modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeRevealBar(); closeModal(); }
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!el.modal.hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      const k = e.key.toLowerCase();
      if (k >= '0' && k <= '8') selectBrush(k);
      else if (k === 'g') selectBrush('G');
      else if (k === 'x') selectBrush('X');
      else if (k === 'e' || k === 'delete' || k === 'backspace') selectBrush('hide');
    });

    let rz = null;
    window.addEventListener('resize', () => {
      if (rz) clearTimeout(rz);
      rz = setTimeout(() => { fitBoard(); paint(); }, 120);
    });
  }

  function selectBrush(name) {
    const b = el.palette.querySelector(`.brush[data-brush="${name}"]`);
    if (!b) return;
    S.brush = name;
    el.palette.querySelectorAll('.brush').forEach((x) => x.classList.toggle('is-on', x === b));
  }

  /* ---------- 尺寸 / 清空 / 示例 ---------- */
  function setSize(n) {
    if (![8, 10, 12].includes(n)) return;
    S.rows = n;
    S.cols = n;
    S.gemTotal = GEM_TOTAL[n];
    el.gemTotalText.textContent = S.gemTotal;
    el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === n));
    resetHistory();   // 换了尺寸，旧盘面的撤销记录对不上行列，直接丢掉
    clearAll();
  }

  function clearAll() {
    S.grid = newGrid(S.rows, S.cols);
    S.aiCells.clear();
    S.unsure.clear();
    S.result = null;
    closeRevealBar();
    buildBoard();
    analyze();
  }

  /* ---------- 示例残局（真实摆法，结论可直接对照） ---------- */
  function loadSample() {
    const n = S.rows;
    const total = n * n;
    const gems = S.gemTotal == null ? GEM_TOTAL[n] : S.gemTotal;
    const idx = [];
    for (let i = 0; i < total; i++) idx.push(i);
    for (let i = total - 1; i > 0; i--) { const k = (Math.random() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[k]; idx[k] = t; }
    const mine = new Uint8Array(total);
    for (let i = 0; i < Math.min(gems, total); i++) mine[idx[i]] = 1;

    const nbrs = (i) => {
      const r = (i / n) | 0, c = i % n, out = [];
      for (let rr = Math.max(0, r - 1); rr <= Math.min(n - 1, r + 1); rr++)
        for (let cc = Math.max(0, c - 1); cc <= Math.min(n - 1, c + 1); cc++) {
          const j = rr * n + cc; if (j !== i) out.push(j);
        }
      return out;
    };
    const adj = new Uint8Array(total);
    for (let i = 0; i < total; i++) if (!mine[i]) adj[i] = nbrs(i).filter((j) => mine[j]).length;

    // 找几个 0 格展开（模拟开局），再铺两轮让残局更有内容
    const open = new Set();
    let seeds = 0;
    for (let i = 0; i < total && seeds < 3; i++) {
      if (mine[i] || adj[i] !== 0) continue;
      seeds++;
      const stack = [i];
      while (stack.length) {
        const v = stack.pop();
        if (open.has(v)) continue;
        open.add(v);
        if (adj[v] === 0) for (const j of nbrs(v)) if (!mine[j] && !open.has(j)) stack.push(j);
      }
    }
    for (let round = 0; round < 2; round++) {
      const add = [];
      for (const i of [...open]) for (const j of nbrs(i)) if (!mine[j] && !open.has(j)) add.push(j);
      for (const j of add) open.add(j);
    }
    // 模拟「已经翻出来几颗宝钻」：挑几颗紧挨着已开区域的宝钻
    const gemAdj = new Set();
    for (const i of [...open]) for (const j of nbrs(i)) if (mine[j] && !open.has(j)) gemAdj.add(j);
    for (const j of [...gemAdj].slice(0, 3)) open.add(j);
    if (!open.size) open.add(0);

    const grid = newGrid(n, n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (open.has(i)) grid[r][c] = mine[i] ? 'G' : adj[i];
      }
    }
    // × 标在推导出来的「必定安全」格上，让示例本身自洽
    const probe = window.TidalSolver.solve({ rows: n, cols: n, cells: grid, gemTotal: gems });
    for (const p of probe.certainSafe.slice(0, 3)) grid[p.r][p.c] = 'X';

    mark();
    S.grid = grid;
    S.aiCells.clear();
    analyze();
    settle();
    toast('已载入示例残局，可对照右侧结论', 'gold');
  }

  /* ---------- 主题：与统计中心共用 localStorage 的 theme 键 ---------- */
  function updateThemeIcon(t) {
    const btn = $('#theme-toggle');
    if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
  }

  function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
    const btn = $('#theme-toggle');
    if (btn) {
      btn.onclick = () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (e) {}
        updateThemeIcon(next);
      };
    }
  }

  /* ---------- 弹窗 ---------- */
  function openModal(html) { el.modalBox.innerHTML = html; el.modal.hidden = false; }
  function closeModal() { el.modal.hidden = true; }

  function openHelp() {
    openModal(`
      <div class="modal-head">
        <h3>使用说明 · 残局分析器</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>当前分析</h4>
          <div class="detail">${S.detailHtml || '<p class="card-desc">棋盘还是空的。</p>'}</div>
        </section>
        <section>
          <h4>它做什么</h4>
          <p>把游戏里当前棋盘的样子<b>照原样填进来</b>，它会用扫雷的逻辑算出现在
             <b>哪些格子必定是宝钻</b>、<b>哪些格子必定没有宝钻</b>、<b>下一步先点哪里</b>，
             结果直接标在棋盘上。</p>
        </section>
        <section>
          <h4>怎么填</h4>
          <ul>
            <li><b>单击格子</b>＝标上 / 取消 <b>×</b> 标记（和游戏里单击一样，不消耗探索券）。</li>
            <li><b>双击格子</b>＝相当于「翻开」：底部弹出取值栏，选这格翻出来是 <b>空白 0 / 数字 / 宝钻</b>。
              可选数字按<b>当前位置实际可能的值</b>给：角上周围只有 3 格就只给 0~3；如果周围已经有 × 标记或已翻出的宝钻，
              范围会跟着收窄（例：8 个邻居里有 2 格标了 ×、1 颗已经是宝钻 → 只能填 <b>1~6</b>：
              下限是那颗已翻出的宝钻，上限是「剩下 5 格全是宝钻」）。填不出不可能的值，也就不会触发自检报错。</li>
            <li><b>右键格子</b>＝清除，恢复成「未翻开」；按住左键拖动可连续涂。</li>
            <li>笔刷那排用于连续涂：想批量填数字就先点「3」，再逐个点格子；默认笔刷是 <b>× 标记</b>。
              数字笔刷是 <b>0~8</b>（数字最多就是 8，因为一格最多只有 8 个邻居）。</li>
            <li>填错了就点棋盘下方的<b>「撤销上一步」</b>（或按 <b>Ctrl+Z</b>）退回上一处改动。
              一次拖动连涂、一次双击翻开、一次「把可确认的格标上 ×」都各算一步。</li>
            <li><b>「清空棋盘」</b>也在棋盘下方，清空后同样可以撤销，不怕点错。</li>
            <li>键盘：<b>0~8</b> 选数字笔刷，<b>G</b> 宝钻，<b>X</b> 标记，<b>E</b> 清除，<b>Ctrl+Z</b> 撤销。</li>
            <li>顶部「本图固定宝钻」按尺寸固定（8×8 为 20、10×10 为 30、12×12 为 45），不可更改。</li>
          </ul>
        </section>
        <section>
          <h4>推理是怎么做的</h4>
          <ul>
            <li>格子上的数字＝<b>周围 8 格里有几颗宝钻</b>。点开是 <b>3</b>，就是它周围那 9 格里一共藏着 3 颗宝钻。</li>
            <li>于是：<b>把这 3 颗都翻出来之后</b>，那一圈里剩下没翻的格子就<b>确定没有宝钻</b>，可以单击标上 ×。</li>
            <li>反过来，如果某个数字周围剩下的格数<b>正好等于</b>还缺的宝钻数，那些格子就<b>全是宝钻</b>，可以直接去翻。</li>
            <li>此外还会做两格数字叠加推算；都推不出来时，才按所有合法摆法给出概率。</li>
          </ul>
        </section>
        <section>
          <h4>棋盘上的标记怎么读</h4>
          <ul>
            <li><b>金框 ◆</b>＝必定是宝钻，放心去翻，直接得分。</li>
            <li><b>绿框 ✓</b>＝必定安全，可以单点标上 ×；也可以点「把可确认的格标上 ×」一键标完。</li>
            <li><b>虚框 %</b>＝解不唯一时按所有合法摆法统计出的含宝钻概率，只是参考。</li>
            <li><b>橙色脉冲框</b>＝推荐先点的格子。</li>
            <li>标了 <b>×</b> 的格子＝你已确认它没有宝钻，就不再重复显示 ✓；<b>只有标错时</b>才会亮红框 <b>!</b> 提醒。</li>
            <li>推理只使用<b>数字</b>和<b>宝钻总数</b>；你标的 × 不参与推理，但会用来自动检查标错的地方。</li>
          </ul>
        </section>
        <section>
          <h4>盘面自检</h4>
          <ul>
            <li>工具会用你填的盘面反过来验算：有没有哪个数字和它周围的情况对不上（见上方「当前分析」）。</li>
            <li>如果列出来了，说明那几格的<b>数字多半填错了</b>（或截图识别读错了），先核对再往下看结论。</li>
            <li>没有列出任何格子时，说明当前盘面完全自洽，结论可以放心用。</li>
          </ul>
        </section>
        <section>
          <h4>截图识别</h4>
          ${OCR_ENABLED ? '' : '<p>当前是<b>静态托管版</b>，没有后端，不提供截图识别；手动填写可以用全部求解功能。</p>'}
          <ul>
            <li>点顶部<b>「截图识别」</b>上传游戏截图，识别后自动填进棋盘，识别出来的格子会打<b>金色虚框</b>。</li>
            <li><b>要等 1~2 分钟</b>（识图模型逐格辨认比较慢），弹窗里会显示已用秒数。</li>
            <li><b>务必逐格核对</b>：识别错一格，结论就会跟着错；模型没把握的格子会打红虚框。</li>
            <li>该功能需要页面通过服务器访问（<b>/tidal/</b>）；直接双击本地 html 打开时无法调用。</li>
          </ul>
        </section>
      </div>`);
  }

  /* ---------- 截图识别 ---------- */
  function setImportStatus(text, kind) {
    const el2 = $('#import-status');
    if (!el2) return;
    el2.textContent = text;
    el2.className = 'import-status' + (kind ? ' is-' + kind : '');
  }

  function startImportClock(sizeLabel) {
    const t0 = Date.now();
    clearInterval(S.importTimer);
    setImportStatus(`识别中… 已用 0s（按 ${sizeLabel} 识别，通常 1~2 分钟，可以先去忙别的）`, 'busy');
    S.importTimer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      setImportStatus(`识别中… 已用 ${s}s（按 ${sizeLabel} 识别，通常 1~2 分钟）`, 'busy');
    }, 1000);
  }
  function stopImportClock() { clearInterval(S.importTimer); S.importTimer = null; }

  /** 图片压缩：只在超大时才缩（实测压到 1400 会让识别明显变差，所以门槛放很高） */
  function shrinkImage(file, maxSide) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const long = Math.max(img.width, img.height);
            if (long <= maxSide) { resolve({ blob: file, url, note: `${img.width}×${img.height}` }); return; }
            const k = maxSide / long;
            const w = Math.round(img.width * k), h = Math.round(img.height * k);
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const cx = cv.getContext('2d');
            cx.imageSmoothingEnabled = true;
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img, 0, 0, w, h);
            cv.toBlob((blob) => {
              if (!blob) { resolve({ blob: file, url, note: `${img.width}×${img.height}` }); return; }
              URL.revokeObjectURL(url);
              resolve({ blob, url: URL.createObjectURL(blob), note: `${img.width}×${img.height} → ${w}×${h}` });
            }, 'image/jpeg', 0.92);
          } catch (e) { resolve({ blob: file, url, note: '' }); }
        };
        img.onerror = () => resolve({ blob: file, url, note: '' });
        img.src = url;
      } catch (e) { resolve({ blob: file, url: '', note: '' }); }
    });
  }

  function fileSizeText(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function openShotModal() {
    if (!OCR_ENABLED) {
      openModal(`
        <div class="modal-head"><h3>截图识别</h3>
          <button class="modal-close" data-close type="button">✕</button></div>
        <div class="rules"><section>
          <p>这是<b>静态托管版</b>：没有后端，所以不提供截图识别。<br>
             手动填写同样可以用全部求解功能（单击标 ×、双击选数字、下方直接给结论）。</p>
        </section></div>`);
      return;
    }
    openModal(`
      <div class="modal-head">
        <h3>截图识别 · 自动填入棋盘</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>1. 把截图拖进来 / 粘贴 / 选文件</h4>
          <div class="dropzone" id="dropzone">
            <svg class="ico"><use href="#ico-image"/></svg>
            <span>拖到这里，或 <b>Ctrl+V 粘贴</b>，或</span>
            <button class="btn sm" id="btn-shot" type="button">选择文件</button>
            <input type="file" id="shot-file" accept="image/*" hidden>
          </div>
          <div class="pick-row" id="pick-row" hidden>
            <img class="pick-thumb" id="pick-thumb" alt="">
            <span class="pick-meta"><b id="pick-name"></b><i id="pick-info"></i></span>
            <button class="btn sm" id="btn-ocr-clear" type="button">换一张</button>
          </div>
        </section>
        <section>
          <h4>2. 确认这张图是哪一档地图</h4>
          <div class="seg seg-sm" id="shot-size-seg">
            <button class="seg-btn" data-size="8" type="button">8×8</button>
            <button class="seg-btn" data-size="10" type="button">10×10</button>
            <button class="seg-btn" data-size="12" type="button">12×12</button>
          </div>
          <p class="card-foot">选错会白等 1~2 分钟，所以必须先确认。默认跟着当前棋盘走。</p>
        </section>
        <section>
          <h4>3. 开始识别</h4>
          <div class="go-row">
            <button class="btn" id="btn-ocr-go" type="button" disabled>开始识别</button>
            <button class="btn" id="btn-ocr-cancel" type="button" hidden>取消识别</button>
            <span class="import-status" id="import-status">先把截图拖进来或粘贴</span>
          </div>
        </section>
        <section>
          <h4>识别完成后</h4>
          <ul>
            <li>结果直接填进棋盘：识别到的格子打<b>金色虚框</b>，模型没把握的打<b>红虚框</b>。</li>
            <li><b>请逐格核对</b>（尤其红框那几格）：错一格，后面结论就会跟着错。</li>
          </ul>
        </section>
      </div>`);

    S.shotSize = S.rows;
    S.ocrBlob = null;
    const seg = $('#shot-size-seg');
    const markSize = () => {
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.shotSize));
      const go = $('#btn-ocr-go');
      if (go && S.ocrBlob) go.textContent = `开始识别（${S.shotSize}×${S.shotSize}）`;
    };
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      S.shotSize = Number(b.dataset.size);
      markSize();
    });
    markSize();

    const input = $('#shot-file');
    $('#btn-shot').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (f) acceptShot(f);
      input.value = '';
    });

    $('#btn-ocr-clear').addEventListener('click', () => { clearPick(); });
    $('#btn-ocr-go').addEventListener('click', () => { if (S.ocrBlob) recognize(S.ocrBlob); });
    $('#btn-ocr-cancel').addEventListener('click', () => {
      S.ocrCanceled = true;
      stopImportClock();
      setGoState(false);
      setImportStatus('已取消。可以重新点「开始识别」。', '');
    });

    // 拖拽
    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) acceptShot(f);
    });
  }

  /** 识别中：切换按钮状态 */
  function setGoState(running) {
    const go = $('#btn-ocr-go'), cancel = $('#btn-ocr-cancel'), clear = $('#btn-ocr-clear');
    if (go) { go.hidden = !!running; go.disabled = !S.ocrBlob || !!running; }
    if (cancel) cancel.hidden = !running;
    if (clear) clear.hidden = !!running;
  }

  /** 全局粘贴：任何位置 Ctrl+V 都能开始（弹窗没开就自动开） */
  function bindPasteOnce() {
    if (S.pasteBound) return;
    S.pasteBound = true;
    document.addEventListener('paste', (e) => {
      if (!OCR_ENABLED) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      let f = null;
      for (const it of items) {
        if (it.kind === 'file' && it.type && it.type.startsWith('image/')) { f = it.getAsFile(); break; }
      }
      if (!f) return;
      e.preventDefault();
      if (el.modal.hidden || !$('#dropzone')) openShotModal();
      acceptShot(f);
    });
    // 拖到页面任意位置也能接（避免浏览器直接打开图片）
    document.addEventListener('dragover', (e) => { if (OCR_ENABLED && !el.modal.hidden) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (OCR_ENABLED && !el.modal.hidden) e.preventDefault(); });
  }

  function clearPick() {
    const row = $('#pick-row');
    if (row) row.hidden = true;
    S.ocrBlob = null;
    if (S.importPreviewUrl) { try { URL.revokeObjectURL(S.importPreviewUrl); } catch (e) {} S.importPreviewUrl = null; }
    setGoState(false);
    const go = $('#btn-ocr-go');
    if (go) go.textContent = '开始识别';
    setImportStatus('先把截图拖进来或粘贴', '');
  }

  /** 接住一张图片：只显示文件名/大小，等用户确认尺寸后手动开始 */
  async function acceptShot(file) {
    if (!file) return;
    if (S.importTimer) { toast('正在识别中，等它完成或点「取消识别」', 'warn'); return; }
    if (!/^image\//.test(file.type || '')) { setImportStatus('这个文件不是图片', 'err'); return; }
    S.ocrCanceled = false;
    const shrunk = await shrinkImage(file, 2600);
    S.ocrBlob = shrunk.blob;

    const row = $('#pick-row');
    if (row) {
      row.hidden = false;
      const thumb = $('#pick-thumb');
      if (S.importPreviewUrl) { try { URL.revokeObjectURL(S.importPreviewUrl); } catch (e) {} }
      S.importPreviewUrl = shrunk.url;
      thumb.src = shrunk.url;
      $('#pick-name').textContent = (file.name && file.name !== 'image.png') ? file.name : '粘贴的截图';
      $('#pick-info').textContent = `${fileSizeText(shrunk.blob.size)}${shrunk.note ? ' · ' + shrunk.note : ''}`;
    }
    const go = $('#btn-ocr-go');
    if (go) { go.disabled = false; go.textContent = `开始识别（${S.shotSize}×${S.shotSize}）`; }
    setGoState(false);
    setImportStatus('图片已就绪 —— 确认上面是几×几，再点「开始识别」', '');
  }

  async function recognize(blob) {
    const size = S.shotSize || S.rows;
    startImportClock(`${size}×${size}`);
    setGoState(true);

    try {
      const fd = new FormData();
      fd.append('image', blob, 'shot.jpg');
      fd.append('rows', String(size));
      fd.append('cols', String(size));

      // 识图要 1~2 分钟：POST 只负责拿任务号，再轮询取结果（长请求会被公网网关掐断）
      const resp = await fetch('api/parse-board', { method: 'POST', body: fd });
      const posted = await resp.json().catch(() => null);
      if (!resp.ok || !posted) throw new Error((posted && posted.error) || `服务返回 ${resp.status}`);
      if (!posted.ok) throw new Error(posted.error || '上传失败');
      const jobId = posted.jobId;
      if (!jobId) throw new Error('服务没有返回任务号');

      let data = null;
      for (let i = 0; i < 150; i++) {          // 最长约 5 分钟
        await new Promise((r) => setTimeout(r, 2000));
        if (S.ocrCanceled) return;
        const r2 = await fetch('api/parse-board/' + encodeURIComponent(jobId));
        if (r2.status === 404) throw new Error('识别任务已失效（服务可能重启过），请重新识别');
        const j = await r2.json().catch(() => null);
        if (!j) continue;
        if (j.status === 'running') continue;
        if (!j.ok || j.status === 'error') throw new Error(j.error || '识别失败');
        data = j.data;
        break;
      }
      if (S.ocrCanceled) return;
      if (!data) throw new Error('识别超时（超过 5 分钟没有结果）');

      const { rows, cols, cells } = data;
      if (!rows || !cols || !Array.isArray(cells) || cells.length !== rows) throw new Error('识别结果格式不正确');
      if (rows !== size) {
        throw new Error(`识别出来是 ${rows}×${cols}，和你选的 ${size}×${size} 不一致 —— 请核对后重选尺寸再识别`);
      }

      mark();   // 整次识别算一步：识别错了可以一键退回识别前的盘面
      S.rows = rows; S.cols = cols;
      el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === rows));
      S.gemTotal = GEM_TOTAL[rows];      // 宝钻总数由尺寸固定
      el.gemTotalText.textContent = S.gemTotal;

      S.grid = newGrid(rows, cols);
      S.aiCells.clear();
      S.unsure.clear();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let v = cells[r][c];
          if (v === 9 || v === 'G') v = 'G';
          else if (v === 10 || v === 'X') v = 'X';
          else if (typeof v === 'number' && v >= 0 && v <= 8) v = v;
          else v = -1;
          S.grid[r][c] = v;
          if (v !== -1) S.aiCells.add(r * cols + c);
        }
      }
      for (const pair of (data.unsure || [])) {
        const r = Number(pair[0]), c = Number(pair[1]);
        if (r >= 0 && r < rows && c >= 0 && c < cols) { S.aiCells.add(r * cols + c); S.unsure.add(r * cols + c); }
      }
      buildBoard();
      analyze();
      settle();
      stopImportClock();
      clearPick();
      closeModal();
      const unsureN = S.unsure.size;
      // 尺寸选错时，模型会照着错尺寸硬编，结果通常自相矛盾 —— 这里直接提醒
      const bad = (S.result && S.result.conflicts) ? S.result.conflicts.length : 0;
      if (bad) {
        const sizeLabel = rows + '×' + rows;
        setImportStatus(`识别完成，但有 ${bad} 处数字自相矛盾 —— 多半是地图尺寸选错了，请核对后重新识别。`, 'err');
        openModal(`
          <div class="modal-head">
            <h3>识别结果可能不对</h3>
            <button class="modal-close" data-close type="button">✕</button>
          </div>
          <div class="rules">
            <section>
              <p>棋盘已经填好了，但<b>有 ${bad} 处数字和周围情况对不上</b>。</p>
              <p>最常见的原因是<b>地图尺寸选错了</b>（你选的是 ${sizeLabel}，截图可能不是这一档）；也可能是识图读错了个别数字。</p>
              <p>建议：<b>确认截图是哪一档地图后重新识别</b>；或者对照截图手工改掉不一致的格子 ——
                 具体位置在「使用说明 → 当前分析 → 盘面自检」里列着。</p>
            </section>
          </div>`);
      } else {
        toast(unsureN ? `识别完成，${unsureN} 处红框请重点核对` : '识别完成，请核对金框格子', 'gold');
      }
    } catch (err) {
      stopImportClock();
      const msg = String((err && err.message) || err);
      const isNetErr = (err && err.name === 'TypeError') || /Failed to fetch|NetworkError|load failed/i.test(msg);
      setImportStatus(
        isNetErr
          ? '连不上识别服务：当前页面可能是静态托管打开的（识别需要服务器）。手动填写不受影响。'
          : msg.slice(0, 90),
        'err'
      );
      toast(isNetErr ? '连不上识别服务（识别需要服务器版）' : '识别失败，看看弹窗里的提示', 'warn');
    } finally {
      setGoState(false);
      const go = $('#btn-ocr-go');
      if (go) go.textContent = `开始识别（${S.shotSize}×${S.shotSize}）`;
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    initTheme();
    // 静态托管版：隐藏截图识别入口
    if (!OCR_ENABLED) {
      const b0 = $('#btn-shot-open');
      if (b0) b0.hidden = true;
    }
    S.grid = newGrid(S.rows, S.cols);
    el.gemTotalText.textContent = S.gemTotal;
    el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.rows));
    el.palette.querySelectorAll('.brush').forEach((b) => b.classList.toggle('is-on', b.dataset.brush === S.brush));
    buildBoard();
    bind();
    bindPasteOnce();   // 任何位置按 Ctrl+V 都能直接开始识别
    analyze();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
