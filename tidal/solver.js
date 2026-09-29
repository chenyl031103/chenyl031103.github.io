/* =====================================================================
   潮汐秘境 · 残局分析器（界面层）
   棋盘状态：-1 未翻开 / 0-8 已翻开数字 / 'G' 钻石 / 'X' × 标记
   ===================================================================== */
(() => {
  'use strict';

  // 各尺寸的钻石总数由活动固定，不可更改
  const GEM_TOTAL = { 8: 20, 10: 30, 12: 45 };
  const OCR_ENABLED = window.TIDAL_OCR !== false;   // 静态托管版把 window.TIDAL_OCR 设为 false

  /* 静态版：「去用截图识别版」指向的地址（构建时写入）。
     隧道地址会变，所以支持用 ?ocr=新地址 覆盖，存本地，改地址不必重新上传。 */
  const OCR_URL_KEY = 'tidal_ocr_url';

  function resolveOcrService() {
    const clean = (u) => (u ? u.replace(/\/+$/, '') + '/' : '');
    let saved = '';
    try { saved = localStorage.getItem(OCR_URL_KEY) || ''; } catch (e) {}
    try {
      const params = new URLSearchParams(location.search);
      if (params.has('ocr')) {
        const raw = (params.get('ocr') || '').trim();
        if (raw) {
          saved = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
          try { localStorage.setItem(OCR_URL_KEY, saved); } catch (e) {}
        } else {
          saved = '';   // ?ocr= 留空 = 清除覆盖，回到构建时写入的地址
          try { localStorage.removeItem(OCR_URL_KEY); } catch (e) {}
        }
      }
    } catch (e) {}
    const built = typeof window.TIDAL_OCR_URL === 'string' ? window.TIDAL_OCR_URL.trim() : '';
    return clean(saved || built);
  }

  const OCR_SERVICE = resolveOcrService();
  const DOUBLE_MS = 340;   // 两次按下间隔小于此值算「双击翻开」

  // 页脚上方的相关链接：静态版列出「带识别」的网址，服务版列出「静态版」网址
  const STATIC_SITES = [
    'https://chenyl031103.github.io/tidal/',
    'https://www.axxiu.cn/project/t1gBdI7v/',
  ];
  const OCR_FALLBACK = 'http://chenyl.free.idcfengye.com/';
  const GATEWAY_URL = 'https://chenyl031103.github.io';

  function renderSiteLinks() {
    const box = document.getElementById('site-links');
    if (!box) return;
    // 静态版不显示这条：带识别的两个网址改由右上角「截图识别」按钮的弹窗列出
    if (!OCR_ENABLED) { box.hidden = true; return; }
    const short = (u) => u.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    let note, list;
    if (OCR_ENABLED) {
      note = '静态版：不用服务器、不消耗识图额度，可直接发给群友';
      list = STATIC_SITES.map((u) => ({ u, label: short(u) }));
    } else {
      const svc = OCR_SERVICE || OCR_FALLBACK;
      note = '带截图识别的版本：需要那台服务器在线（手动填写不受影响）';
      list = [
        { u: svc, label: short(svc) },
        { u: GATEWAY_URL, label: short(GATEWAY_URL) + '（总入口，自动跳转）' },
      ];
    }
    box.innerHTML =
      '<span class="sl-title">🔗 相关网址</span>' +
      '<span class="sl-note">' + note + '</span>' +
      '<span class="sl-list">' +
      list.map((x) => '<a href="' + x.u + '" target="_blank" rel="noopener">' + x.label + '</a>').join('<span class="sep">·</span>') +
      '</span>';
  }

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
    brush: 'select',      // 默认笔刷 = 选中（单击只选中，不改内容）
    aiCells: new Set(),   // 截图识别填进来的格子，需人工核对
    unsure: new Set(),    // 识图模型自己没把握的格子
    result: null,
    detailHtml: '',       // 明细，供「使用说明」展示
    painting: null,
    awaiting: -1,         // 正在等待选择「翻开值」的格子
    cursor: -1,           // 当前选中的格子（键盘输入的目标）
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

    // 手机上格子太小看不清 —— 宁可让棋盘可滚动，也保证格子里数字够大
    const minCell = cols >= 24 ? 22 : (window.innerWidth <= 640 ? 30 : 20);
    cell = clamp(cell, minCell, 78);
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
    // 游戏模式下不叠加任何分析标记（否则会把上一次分析的结果画到游戏盘上）
    const res = S.game ? null : S.result;
    const hasClue = (() => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (typeof grid[r][c] === 'number' && grid[r][c] >= 0) return true;
      return false;
    })();
    const showProb = hasClue && parseFloat(getComputedStyle(el.board).getPropertyValue('--cell')) >= 26;
    // 只给「紧挨着数字的边界格」画虚线概率框：离线索很远的格子概率就是基准值，
    // 全画上会是一堆若隐若现的虚线，反而看不清重点
    const frontier = new Uint8Array(rows * cols);
    if (showProb) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (typeof grid[r][c] !== 'number' || grid[r][c] < 0) continue;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
              frontier[rr * cols + cc] = 1;
            }
          }
        }
      }
    }
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
        else if (v === 'D') { cls += ' is-open is-diamond'; }   // 潮汐秘境：找到的钻石
        else if (v === 'F') { cls += ' is-flag'; }              // 扫雷：插的旗
        else if (v === 'Q') { cls += ' is-question'; }          // 扫雷：问号
        else if (v === 'B') { cls += ' is-open is-bomb'; }      // 扫雷：地雷
        else if (v === 'H') { cls += ' is-blank'; }             // 扫雷：没翻开的格子 ■
        else if (typeof v === 'number' && v >= 0) {
          cls += ' is-open';
          if (v > 0) { cls += ' n' + v; text = String(v); }
        }
        if (S.aiCells.has(i)) cls += ' is-ai';
        if (S.unsure.has(i)) cls += ' is-unsure';
        if (S.awaiting === i) cls += ' awaiting';

        // 结论用「符号」表达，不再画框：绿 √ = 必定是钻石，黑 × = 必定不是钻石（灰色 × 是工具推导的提示）
        let badge = '';
        let content = null;   // 覆盖格子内容（隐藏格才用）
        if (res) {
          const marked = v === 'X';
          if (marked) {
            // 自己标了 ×（= 已确认没钻石），而且推导也支持 → 就是黑 ×，不再加东西
            if (res.knownGem && res.knownGem[i]) { cls += ' say-conflict'; badge = '!'; }
          } else if (res.knownGem && res.knownGem[i] && v !== 'G') {
            cls += ' say-gem';
            content = '<span class="v-gem">✓</span>';
          } else if (res.knownSafe && res.knownSafe[i]) {
            cls += ' say-safe';
            content = '<span class="v-safe">×</span>';
          } else if (res.probs && res.probs[i] != null && showProb && frontier[i]) {
            cls += ' say-prob';
            const p = res.probs[i];
            badge = p >= 0.995 ? '≈1' : p <= 0.005 ? '≈0' : Math.round(p * 100) + '%';
          }
          if (res.pick && res.pick.i === i) cls += ' pick';
          if (S.cursor === i) cls += ' cursor';
        }

        if (node.className !== cls) node.className = cls;
        const key = content ? 'v:' + content : (text || (typeof v === 'string' ? v : ''));
        if (node.dataset.k !== key) {
          node.dataset.k = key;
          node.innerHTML = content ? content
            : v === 'G' ? '<svg class="ico" aria-hidden="true"><use href="#ico-gem"/></svg>'
            : v === 'X' ? '<svg class="ico" aria-hidden="true"><use href="#ico-x"/></svg>'
            : v === 'D' ? '<svg class="ico" aria-hidden="true"><use href="#ico-gem"/></svg>'
            : v === 'F' ? '<span class="v-flag">🚩</span>'
            : v === 'Q' ? '<span class="v-question">❓</span>'
            : v === 'B' ? '<span class="v-bomb">💣</span>'
            : v === 'H' ? '<span class="v-blank">■</span>'
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
    // 游戏模式下不显示工具结论（不然等于直接给答案）
    if (S.game) { updateGameBar(); return; }
    const base = {
      rows: S.rows,
      cols: S.cols,
      cells: S.grid,
      gemTotal: Number.isFinite(S.gemTotal) ? S.gemTotal : null,
    };
    // 主结论：把玩家的 × 当作「确定没有钻石」一起推理
    const res = window.TidalSolver.solve(Object.assign({}, base, { trustMarks: true }));
    // 再算一遍「不信任 ×」，用来发现标错的 × 和数字证明不了的 ×
    S.resultNoMarks = window.TidalSolver.solve(Object.assign({}, base, { trustMarks: false }));
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
      ? `显示数字 ${x.clue}，但周围已经翻出 ${x.gems} 颗钻石`
      : `显示数字 ${x.clue}，需要 ${x.want} 颗钻石，却只剩 ${x.hidden} 格没翻开`;
  }

  /** 一行建议条（始终显示在棋盘下方） */
  function adviceLine(res) {
    const c = res.counts;
    if (S.filledCount === 0) return { kind: '', text: '先把残局填进来，或点右上角「随机玩一盘」体验一下。' };
    if (c.hiddenCells === 0) return { kind: '', text: '棋盘已填满，没有未翻开的格子了。' };
    const pick = res.pick;
    if (!pick) return { kind: '', text: '还没有数字线索：先把已翻开的格子和钻石填进来。' };
    if (pick.type === 'gem') {
      return { kind: 'gem', text: `先点开 ${coord(pick.r, pick.c)} —— 必定是钻石（${pick.why || '由数字推出'}）` };
    }
    if (pick.type === 'safe') {
      return { kind: 'safe', text: `没有能确定的钻石；先翻开 ${coord(pick.r, pick.c)}（必定不是钻石，可扩开线索）—— ${pick.why || '由数字推出'}` };
    }
    const hi = pick, lo = pick.alt;
    return {
      kind: 'warn',
      text: `推不出确定格子：想赌分翻 ${coord(hi.r, hi.c)}（含钻石 ${Math.round(hi.p * 100)}%），想探线索翻 ${lo ? coord(lo.r, lo.c) + '（' + Math.round(lo.p * 100) + '%）' : '—'}`,
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
    // × 被当成依据后，矛盾多半来自标错的 ×（不信任 × 就没有矛盾）
    const noMarks = S.resultNoMarks;
    const marksAtFault = (res.conflicts.length > 0 || res.impossible) && noMarks && !noMarks.conflicts.length && !noMarks.impossible;
    const errText = marksAtFault
      ? (res.conflicts.length
          ? `${res.conflicts.length} 处矛盾：多半有 × 标错了（详见使用说明）`
          : '钻石总数对不上：多半有 × 标错了（详见使用说明）')
      : (res.impossible
          ? '盘面与钻石总数矛盾'
          : (res.conflicts.length ? `${res.conflicts.length} 处数字对不上（详见使用说明）` : ''));
    el.vbErrWrap.hidden = !errText;
    el.vbErr.textContent = errText || '';

    /* 明细：全部收进「使用说明」 */
    let html = '';
    html += `<ul class="meta-list">
      <li><span>本图钻石总数</span><b>${c.gemTotal == null ? '未填' : c.gemTotal}</b></li>
      <li><span>已确认钻石</span><b>${c.knownGems} 颗</b></li>
      <li><span>还需找出</span><b>${c.remainingGems == null ? '—' : c.remainingGems + ' 颗'}</b></li>
      <li><span>必定是钻石</span><b>${c.certainGems} 处</b></li>
      <li><span>必定不是钻石</span><b>${c.certainSafe} 处</b></li>
      <li><span>无法确定</span><b>${c.undecided} 格</b></li>
      <li><span>未翻开总计</span><b>${c.hiddenCells} 格</b></li>
    </ul>`;

    html += `<div class="block-title">下一步</div><p class="card-desc">${adv.text}</p>`;

    if (c.certainGems) html += `<div class="block-title">必定是钻石（绿 √，去翻这些）</div>${coordChips(res.certainGems, 'c-gem', 20)}`;
    if (c.certainSafe) html += `<div class="block-title">必定不是钻石（可以标 ×）</div>${coordChips(res.certainSafe, 'c-safe', 20)}`;
    if (res.undecided.length) {
      const lo = res.undecided[0], hi = res.undecided[res.undecided.length - 1];
      html += `<div class="advice-why" style="margin-top:10px">待定格含钻石概率区间 ${Math.round(lo.p * 100)}% ~ ${Math.round(hi.p * 100)}%${res.approx ? '（其中有过大的分组，已按估算处理）' : ''}</div>`;
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
      html += `<p class="card-desc">✔ 已填的 <b>${nCells}</b> 个数字格全部符合「<b>数字 = 周围 8 格的钻石数</b>」，这个盘面可以放心用。</p>`;
    }
    if (res.impossible) {
      html += `<p class="advice-why" style="margin-top:9px;color:var(--warn-ink)">当前盘面与「钻石总数 ${c.gemTotal}」无法同时成立：可能某格填错了，或总数不对。</p>`;
    }

    /* × 标记检查 */
    html += `<div class="block-title">你的 × 标记检查</div>`;
    const noM = S.resultNoMarks;
    if (!res.markedX.some((v) => v)) {
      html += `<p class="card-desc">棋盘上还没有 × 标记。按游戏玩法，单击标 × 就是「这格确定没有钻石」，工具会把它当作可靠信息一起推理。</p>`;
    } else {
      let m = '';
      // ① 标错的：信任 × 会出现矛盾，而不信任就没有 → 说明 × 里有错的
      const badByMarks = (res.conflicts.length > 0 || res.impossible) && noM && !noM.conflicts.length && !noM.impossible;
      if (badByMarks) {
        m += `<div class="advice-lead"><span class="tag tag-warn">有 × 标错了</span></div>
              <div class="advice-why" style="margin:6px 0 8px">
              你的 × 已被当成「确定没有钻石」参与推理；但如果因此出现下面这些矛盾，说明<span style="color:var(--warn-ink)">其中至少有一个 × 标错了</span>：
              </div>${coordChips(res.conflicts, 'c-warn', 10)}`;
      }
      // ② 数字证明不了的 ×（不信任时仍是候选）——标错了结论就会偏
      const unsupported = [];
      if (noM) {
        for (let i = 0; i < S.total; i++) {
          if (!res.markedX[i]) continue;
          if (!noM.knownSafe[i] && !noM.knownGem[i]) {
            unsupported.push({ r: (i / S.cols) | 0, c: i % S.cols, i, p: noM.probs ? noM.probs[i] : null });
          }
        }
      }
      if (unsupported.length) {
        m += `<div class="block-title">这些 × 数字证明不了（如果标错了，结论会跟着偏）</div>${coordChips(unsupported, 'c-gem', 12, true)}`;
      }
      if (!badByMarks && !unsupported.length) {
        m += `<p class="card-desc">✔ 所有 × 标记都被数字证实了，可以放心用。</p>`;
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
   * 数字 = 周围 8 格里钻石的总数（含已经翻出来的），所以：
   *   下限 = 周围已经翻出的钻石数（这些一定算数）
   *   上限 = 周围还可能藏钻石的格数 = 周围格数 − 已确定不可能是钻石的格数
   *          （已确定不是钻石的：打了 × 的格、已经翻开是数字的格）
   * 例：8 个邻居里有 2 个标了 ×、1 个已经是钻石 → 只能填 1~6
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
        if (v === 'G') known++;                                        // 已翻出的钻石：一定算进数字
        else if (v === 'X') blocked++;                                  // 标了 ×：确定没有钻石
        else if (typeof v === 'number' && v >= 0) blocked++;            // 已翻开的数字格：不可能是钻石
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
    btns.push('<button class="rb-btn rb-gem" data-val="G" type="button"><svg class="ico"><use href="#ico-gem"/></svg>钻石</button>');
    btns.push('<button class="rb-btn" data-val="X" type="button">× 标记</button>');
    btns.push('<button class="rb-btn rb-zero" data-val="CLEAR" type="button">清除</button>');
    el.rbValues.innerHTML = btns.join('');

    const parts = [];
    if (rng.total < 8) parts.push(`周围只有 ${rng.total} 格`);
    if (rng.known) parts.push(`${rng.known} 颗已是钻石`);
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

      // 游戏模式：单击标 ×，双击（第二下）探索一格
      if (S.game) {
        if (S.game.over) return;
        // 扫雷按大众习惯：单击翻开、右键/长按插旗（和潮汐秘境那套完全分开）
        if (S.game.kind === 'mine') {
          if (e.button === 2) { gameMark(i); return; }                      // 右键循环 🚩→❓→无
          if (S.lastTap.i === i && now - S.lastTap.t < DOUBLE_MS) {          // 双击数字格 = 快速翻开周围
            S.lastTap = { i: -1, t: 0 };
            S.tap = null;
            clearTimeout(S.tapTimer);
            gameChord(i);
            return;
          }
          S.lastTap = { i, t: now };
          S.tap = { i, long: false };
          clearTimeout(S.tapTimer);
          S.tapTimer = setTimeout(() => {
            if (S.tap && S.tap.i === i) { S.tap.long = true; gameMark(i); }   // 长按 = 循环标记
          }, 400);
          return;
        }
        if (e.button === 2) { gameMark(i); return; }
        if (S.lastTap.i === i && now - S.lastTap.t < DOUBLE_MS) {
          S.lastTap = { i: -1, t: 0 };
          // 第一下顺手加上的记号要撤掉：扫雷里插了旗的格子是不能翻开的，
          // 不撤的话双击永远翻不开（潮汐秘境同样需要，保持行为一致）
          if (S.markFromTap === i) {
            const g = S.game;
            if (g && g.marks[i]) {
              if (g.kind !== 'mine' && g.mine && g.mine[i]) g.wrong--;
              delete g.marks[i];
            }
            S.markFromTap = -1;
            renderGame();
          }
          gameReveal(i);
          return;
        }
        S.lastTap = { i, t: now };
        gameMark(i);
        S.markFromTap = i;
        return;
      }

      // 右键 = 快速标记 / 取消钻石
      if (e.button === 2) {
        S.painting = null;
        if (S.awaiting === i) closeRevealBar();
        mark();
        S.grid[r][c] = S.grid[r][c] === 'G' ? -1 : 'G';
        S.aiCells.delete(i);
        S.unsure.delete(i);
        S.cursor = i;
        paint();
        analyze();
        settle();
        return;
      }

      // 双击 = 打开取值栏（鼠标 / 手机的输入方式）
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
      // 单击 = 选中这一格（键盘 0-8 / Enter / X / Delete 都作用在它上面）
      S.cursor = i;
      if (S.brush === 'select') {
        S.painting = null;
        paint();
        return;
      }
      // 选了具体笔刷时：顺带连续涂（方便批量填）
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
    window.addEventListener('pointerup', () => {
      S.painting = null;
      // 扫雷：抬手就是翻开（长按已经插旗了，就不要再翻）
      if (S.game && S.game.kind === 'mine' && S.tap) {
        const tap = S.tap;
        S.tap = null;
        clearTimeout(S.tapTimer);
        if (!tap.long) gameReveal(tap.i);
      }
      settle();
    });
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
      // 「× 标记」「清除」不是数字，要单独处理
      // （否则 Number('X') = NaN，格子会被写成空值，看着就是"点了没反应"）
      let val;
      if (raw === 'G') val = 'G';
      else if (raw === 'X') val = 'X';
      else if (raw === 'CLEAR') val = -1;
      else val = Number(raw);
      if (typeof val === 'number' && !Number.isFinite(val)) return;
      setReveal(val);
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

    // 一键把推导出的「必定不是钻石」格标上 ×
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
      if (S.game) { S.game = null; updateGameBar(); }
      mark();
      clearAll();
      toast(settle() ? '已清空棋盘 · 可撤销' : '棋盘本来就是空的');
    });
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-sample').addEventListener('click', openGameChooser);
    $('#btn-game-restart').addEventListener('click', () => startGame(S.game ? S.game.kind : 'tidal', S.game ? S.game.n : 0));
    $('#btn-game-switch').addEventListener('click', openGameChooser);
    $('#btn-game-quit').addEventListener('click', quitGame);

    el.modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
      const play = e.target.closest('[data-play]');
      if (play) { startGame(play.dataset.play, Number(play.dataset.arg)); return; }
      if (e.target.closest('#btn-game-again')) { closeModal(); startGame(S.game ? S.game.kind : 'tidal', S.game ? S.game.n : 0); }
      if (e.target.closest('#btn-game-other')) { openGameChooser(); }
      if (e.target.closest('#btn-game-quit')) { closeModal(); quitGame(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeRevealBar(); closeModal(); }
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (!el.modal.hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!S.game) undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (S.game) return;                 // 游戏模式下不响应填值快捷键

      const cols = S.cols, rows = S.rows;
      const setCell = (v) => {
        if (S.cursor < 0) { toast('先用鼠标点一个格子选中它', 'warn'); return; }
        const r = (S.cursor / cols) | 0, c = S.cursor % cols;
        mark();
        S.grid[r][c] = v;
        S.aiCells.delete(S.cursor);
        S.unsure.delete(S.cursor);
        paint();
        analyze();
        settle();
      };

      // 方向键：移动选中的格子
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (S.cursor < 0) { S.cursor = Math.floor(rows / 2) * cols + Math.floor(cols / 2); }
        else {
          const r = (S.cursor / cols) | 0, c = S.cursor % cols;
          let nr = r, nc = c;
          if (e.key === 'ArrowUp') nr = r - 1;
          if (e.key === 'ArrowDown') nr = r + 1;
          if (e.key === 'ArrowLeft') nc = c - 1;
          if (e.key === 'ArrowRight') nc = c + 1;
          nr = Math.max(0, Math.min(rows - 1, nr));
          nc = Math.max(0, Math.min(cols - 1, nc));
          S.cursor = nr * cols + nc;
        }
        paint();
        try { S.nodes[S.cursor].focus({ preventScroll: true }); } catch (err) {}
        return;
      }

      const k = e.key;
      if (k >= '0' && k <= '8') { e.preventDefault(); setCell(Number(k)); return; }
      if (k === 'Enter') { e.preventDefault(); setCell('G'); return; }
      if (k === 'x' || k === 'X') { e.preventDefault(); setCell('X'); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); setCell(-1); return; }
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
    if (S.game) { S.game = null; updateGameBar(); }
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
  /* ---------- 游戏模式：潮汐秘境 / 扫雷（两套完全独立的玩法） ----------
     · 潮汐秘境：地图 8×8 / 10×10 / 12×12（固定 20 / 30 / 45 颗钻石，不可改）。
                 不限次数，双击翻开、单击标 ×（× = 这里没有钻石），把钻石 💎 全找出来。
     · 扫雷    ：初级 9×9/10 颗、中级 16×16/40 颗、高级 16×30/99 颗（大众那款）。
                 单击翻开、右键或长按循环标记（🚩 → ❓ → 无）、双击已翻开的数字格 = 快速翻开周围；
                 首次点击保证安全，翻开所有不是雷的格子即通关，踩雷游戏结束。 */
  const TIDAL_SIZES = [8, 10, 12];
  const MINE_LEVELS = {
    1: { name: '初级', rows: 9, cols: 9, mines: 10 },
    2: { name: '中级', rows: 16, cols: 16, mines: 40 },
    3: { name: '高级', rows: 16, cols: 30, mines: 99 },
  };

  function openGameChooser() {
    const tidalBtns = TIDAL_SIZES
      .map((n) => `<button class="ghost-btn sm" data-play="tidal" data-arg="${n}" type="button">${n}×${n} · ${GEM_TOTAL[n]} 颗钻石</button>`)
      .join('');
    const mineBtns = Object.keys(MINE_LEVELS)
      .map((k) => {
        const lv = MINE_LEVELS[k];
        return `<button class="ghost-btn sm" data-play="mine" data-arg="${k}" type="button">${lv.name} ${lv.rows}×${lv.cols} · ${lv.mines} 颗雷</button>`;
      })
      .join('');
    openModal(`
      <div class="modal-head">
        <h3>游戏模式</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>💎 潮汐秘境</h4>
          <p>从空盘开始玩、不限次数。<b>双击</b>翻开格子，<b>单击</b>标 × 做记号（× = "这里没有钻石"）；数字是周围 8 格的钻石数，把钻石全找出来。</p>
          <div class="modal-actions">${tidalBtns}</div>
        </section>
        <section>
          <h4>🚩 扫雷</h4>
          <p><b>单击</b>翻开、<b>右键或长按</b>循环标记（🚩 → ❓ → 无）、<b>双击</b>已翻开的数字格可以快速翻开周围；第一次点击保证安全，翻开所有不是雷的格子就通关。</p>
          <div class="modal-actions">${mineBtns}</div>
        </section>
      </div>`);
  }

  const nbrsRC = (rows, cols, r, c) => {
    const out = [];
    for (let rr = Math.max(0, r - 1); rr <= Math.min(rows - 1, r + 1); rr++)
      for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++)
        if (rr !== r || cc !== c) out.push([rr, cc]);
    return out;
  };

  /** 按行列生成盘面；forbidden 里的格子不放雷（扫雷首次点击保证安全用） */
  function makeBoard(rows, cols, count, forbidden) {
    const total = rows * cols;
    const pool = [];
    for (let i = 0; i < total; i++) if (!forbidden || !forbidden.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) { const k = (Math.random() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[k]; pool[k] = t; }
    const mine = new Uint8Array(total);
    for (let i = 0; i < Math.min(count, pool.length); i++) mine[pool[i]] = 1;
    const nbrs = (i) => nbrsRC(rows, cols, (i / cols) | 0, i % cols).map(([rr, cc]) => rr * cols + cc);
    const adj = new Uint8Array(total);
    for (let i = 0; i < total; i++) if (!mine[i]) adj[i] = nbrs(i).filter((j) => mine[j]).length;
    return { mine, adj, nbrs };
  }

  /** 游戏用的大盘面（扫雷有 9/16/30 三种尺寸，和计算器的 8/10/12 不是一回事） */
  function setBoardSize(rows, cols) {
    S.rows = rows;
    S.cols = cols;
    S.gemTotal = (rows === cols && GEM_TOTAL[rows] != null) ? GEM_TOTAL[rows] : null;
    if (el.gemTotalText) el.gemTotalText.textContent = S.gemTotal == null ? '—' : S.gemTotal;
    el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === rows && rows === cols));
    resetHistory();
    S.grid = newGrid(rows, cols);
    S.aiCells.clear();
    S.unsure.clear();
    S.result = null;
    closeRevealBar();
    buildBoard();
  }

  function startGame(kind, arg) {
    if (!kind) kind = 'tidal';
    closeModal();
    if (!S.game) S.preGameSize = S.rows;       // 记住进游戏前的尺寸，退出时恢复
    const common = { opened: new Set(), marks: {}, over: false, revealAll: false, t0: 0 };
    if (kind === 'mine') {
      const lv = MINE_LEVELS[Number(arg)] || MINE_LEVELS[1];
      setBoardSize(lv.rows, lv.cols);
      S.game = Object.assign(common, { kind: 'mine', name: lv.name, rows: lv.rows, cols: lv.cols, count: lv.mines, mine: null, adj: null, nbrs: null });
      document.body.classList.add('is-mine-game');
    } else {
      const n = TIDAL_SIZES.indexOf(Number(arg)) >= 0 ? Number(arg) : (TIDAL_SIZES.indexOf(S.rows) >= 0 ? S.rows : 8);
      setBoardSize(n, n);
      const gems = GEM_TOTAL[n];
      const b = makeBoard(n, n, gems);
      S.game = Object.assign(common, { kind: 'tidal', rows: n, cols: n, gems, mine: b.mine, adj: b.adj, nbrs: b.nbrs, found: new Set(), wrong: 0 });
      document.body.classList.remove('is-mine-game');
    }
    S.cursor = -1;
    clearPick();
    stopGameClock();
    renderGame();
    toast(kind === 'mine'
      ? `扫雷 · ${S.game.name}（${S.game.rows}×${S.game.cols}，${S.game.count} 颗雷）：单击翻开、右键或长按插旗`
      : `潮汐秘境 ${S.game.rows}×${S.game.cols}：${S.game.gems} 颗钻石 · 不限次数`, 'gold');
  }

  const fmtClock = (sec) => {
    const m = Math.floor(sec / 60), s2 = Math.floor(sec % 60);
    return m + ':' + String(s2).padStart(2, '0');
  };
  function startGameClock() {
    stopGameClock();
    S.gameTimer = setInterval(() => {
      const node = $('#gb-time');
      if (node && S.game && S.game.t0) node.textContent = fmtClock((Date.now() - S.game.t0) / 1000);
    }, 1000);
  }
  function stopGameClock() { clearInterval(S.gameTimer); S.gameTimer = null; }

  function floodOpen(g, i) {
    const stack = [i];
    while (stack.length) {
      const v = stack.pop();
      if (g.opened.has(v) || g.mine[v]) continue;
      g.opened.add(v);
      delete g.marks[v];
      if (g.adj[v] === 0) for (const j of g.nbrs(v)) if (!g.opened.has(j)) stack.push(j);
    }
  }

  function setAdvice(text) {
    const node = $('#advice-text');
    if (node) node.textContent = text;
  }

  function renderGame() {
    const g = S.game;
    if (!g) return;
    const isMineMode = g.kind === 'mine';
    const gemChar = isMineMode ? 'B' : 'D';       // 扫雷露出的是雷 💣，潮汐秘境是钻石 💎
    const grid = newGrid(g.rows, g.cols);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (g.opened.has(i)) grid[r][c] = (g.mine && g.mine[i]) ? gemChar : (g.adj ? g.adj[i] : -1);
        else if (g.revealAll && g.mine && g.mine[i]) grid[r][c] = gemChar;
        else if (g.marks[i] === 'flag') grid[r][c] = 'F';
        else if (g.marks[i] === 'question') grid[r][c] = 'Q';
        else if (isMineMode) grid[r][c] = 'H';    // 扫雷：没翻开的格子显示 ■
      }
    }
    S.grid = grid;
    S.aiCells.clear();
    S.unsure.clear();
    document.body.classList.toggle('is-mine-game', isMineMode);
    paint();
    updateGameBar();
    setAdvice(isMineMode
      ? '单击翻开 · 右键或长按循环标记（🚩 → ❓ → 无）· 双击数字格快速翻开周围 · 数字 = 周围 8 格的雷数'
      : '双击翻开（不限次数）· 单击标 × 做记号 · 数字 = 周围 8 格的钻石数');
  }

  const gameFlagCount = (g) => Object.keys(g.marks).filter((k) => g.marks[k] === 'flag').length;

  /** 状态栏：玩法标题 + 剩余雷数（或已找到钻石）+ 已翻开 + 计时 */
  function updateGameBar() {
    const bar = $('#game-bar');
    if (bar) bar.hidden = !S.game;
    document.body.classList.toggle('is-game', !!S.game);
    const g = S.game;
    if (!g) { stopGameClock(); return; }
    const isMine = g.kind === 'mine';
    const show = (id, on) => { const node = $(id); if (node) node.hidden = !on; };
    const title = $('#gb-title');
    if (title) {
      title.textContent = isMine
        ? `扫雷 · ${g.name} ${g.rows}×${g.cols} · 共 ${g.count} 颗雷`
        : `潮汐秘境 · ${g.rows}×${g.cols} · 共 ${g.gems} 颗钻石（不限次数）`;
    }
    const hint = $('#gb-hint');
    if (hint) hint.textContent = isMine
      ? '单击翻开 · 右键或长按循环标记 🚩/❓ · 双击数字格快速翻开周围 · 第一次点击保证安全'
      : '双击翻开（不限次数）· 单击标 × 做记号 · 数字 = 周围 8 格的钻石数';
    show('#gb-left-wrap', isMine);
    show('#gb-gem-wrap', !isMine);
    show('#gb-open-wrap', true);
    show('#gb-time-wrap', isMine);
    show('#gb-marks-wrap', !isMine);
    show('#gb-wrong-wrap', !isMine && g.wrong > 0);
    $('#gb-open').textContent = g.opened.size;
    $('#gb-open-total').textContent = isMine ? g.rows * g.cols - g.count : g.rows * g.cols;
    if (isMine) {
      // 剩余雷数 = 总雷数 − 已插旗数（问号不算）
      $('#gb-left').textContent = g.count - gameFlagCount(g);
      $('#gb-time').textContent = fmtClock(g.t0 ? (Date.now() - g.t0) / 1000 : 0);
    } else {
      $('#gb-found').textContent = g.found.size;
      $('#gb-total').textContent = g.gems;
      $('#gb-marks').textContent = Object.keys(g.marks).length;
      $('#gb-wrong').textContent = g.wrong || 0;
    }
  }

  /** 标记：扫雷循环 🚩 → ❓ → 无；潮汐秘境是 × 的开关 */
  function gameMark(i) {
    const g = S.game;
    if (!g || g.over || g.opened.has(i)) return;
    if (g.kind === 'mine') {
      const cur = g.marks[i];
      if (!cur) g.marks[i] = 'flag';
      else if (cur === 'flag') g.marks[i] = 'question';
      else delete g.marks[i];
    } else {
      if (g.marks[i]) { if (g.mine && g.mine[i]) g.wrong--; delete g.marks[i]; }
      else { g.marks[i] = 'flag'; if (g.mine && g.mine[i]) g.wrong++; }
    }
    renderGame();
  }

  const isMineWin = (g) => g.opened.size >= g.rows * g.cols - g.count;

  /** 双击：数字格周围旗数正好等于数字时，翻开周围没标记的格子（碰到雷就输） */
  function gameChord(i) {
    const g = S.game;
    if (!g || g.over || g.kind !== 'mine' || !g.opened.has(i)) return;
    const r = (i / g.cols) | 0, c = i % g.cols;
    const num = g.adj[i];
    if (!num) return;
    const nb = nbrsRC(g.rows, g.cols, r, c);
    const flags = nb.filter(([rr, cc]) => g.marks[rr * g.cols + cc] === 'flag').length;
    if (flags !== num) { toast(`双击无效：周围插了 ${flags} 面旗，但这一格是 ${num}`, 'warn'); return; }
    const targets = nb.filter(([rr, cc]) => !g.opened.has(rr * g.cols + cc) && !g.marks[rr * g.cols + cc]);
    let boom = false;
    for (const [rr, cc] of targets) {
      const j = rr * g.cols + cc;
      if (g.mine[j]) { g.opened.add(j); boom = true; break; }
      floodOpen(g, j);
    }
    if (boom) { g.revealAll = true; g.over = 'shown'; stopGameClock(); renderGame(); return endGame(false); }
    renderGame();
    if (isMineWin(g)) { g.over = 'shown'; stopGameClock(); return endGame(true); }
  }

  function gameReveal(i) {
    const g = S.game;
    if (!g || g.over || g.opened.has(i)) return;
    if (g.kind === 'mine') {
      if (g.marks[i] === 'flag') return;              // 插了旗的格子先取消旗子（经典习惯）
      if (!g.mine) {                                   // 第一次点击：这一格和周围 8 格不放雷
        const forbid = new Set([i, ...nbrsRC(g.rows, g.cols, (i / g.cols) | 0, i % g.cols).map(([rr, cc]) => rr * g.cols + cc)]);
        const b = makeBoard(g.rows, g.cols, g.count, forbid);
        g.mine = b.mine; g.adj = b.adj; g.nbrs = b.nbrs;
        g.t0 = Date.now();
        startGameClock();
      }
      if (g.mine[i]) {
        g.opened.add(i);
        g.revealAll = true;
        g.over = 'shown';
        stopGameClock();
        renderGame();
        return endGame(false);
      }
      floodOpen(g, i);
      renderGame();
      if (isMineWin(g)) { g.over = 'shown'; stopGameClock(); return endGame(true); }
      return;
    }
    // 潮汐秘境：翻开就是探索，翻到钻石算找到
    if (g.marks[i]) { if (g.mine[i]) g.wrong--; delete g.marks[i]; }
    if (g.mine[i]) {
      g.found.add(i);
      g.opened.add(i);
      toast(`找到 1 颗钻石！已找到 ${g.found.size}/${g.gems}`, 'gold');
    } else {
      floodOpen(g, i);
    }
    renderGame();
    if (g.found.size >= g.gems) { g.over = 'shown'; return endGame(true); }
  }

  function endGame(win) {
    const g = S.game;
    if (!g) return;
    const isMine = g.kind === 'mine';
    const secs = g.t0 ? Math.round((Date.now() - g.t0) / 1000) : 0;
    const title = isMine ? (win ? '通关了！' : '踩到雷了') : '钻石全找出来了！';
    const lines = isMine
      ? [`${g.name} ${g.rows}×${g.cols}，${g.count} 颗雷。用时 <b>${fmtClock(secs)}</b>，翻开 <b>${g.opened.size}</b> 格，插旗 <b>${gameFlagCount(g)}</b> 个。`,
         win ? '全部安全格都翻开了，漂亮。' : '踩到的那颗雷已经露出来了，其他雷也一并显示，可以对照看看哪里判断错了。']
      : [`${g.rows}×${g.cols}，共 ${g.gems} 颗钻石。一共翻开 <b>${g.opened.size}</b> 格，钻石全找齐了。`,
         g.wrong ? `中间有 ${g.wrong} 个 × 标在了钻石上（标错了）。` : '而且一个 × 都没标错。'];
    openModal(`
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <p>${lines[0]}</p>
          <p>${lines[1]}</p>
        </section>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="btn-game-again" type="button">再来一局</button>
        <button class="ghost-btn sm" id="btn-game-other" type="button">换玩法</button>
        <button class="ghost-btn sm" id="btn-game-quit" type="button">退出游戏</button>
      </div>`);
  }

  function quitGame() {
    if (!S.game) return;
    const kind = S.game.kind;
    const back = (S.preGameSize && TIDAL_SIZES.indexOf(S.preGameSize) >= 0) ? S.preGameSize : 8;
    S.game = null;
    S.preGameSize = null;
    stopGameClock();
    document.body.classList.remove('is-mine-game');
    updateGameBar();
    mark();
    setSize(back);                 // 回到计算器的地图尺寸（顺带清盘、重算，扫雷的大棋盘不会留在分析模式里）
    toast(kind === 'mine' ? '已退出扫雷' : '已退出游戏模式', 'gold');
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
    const ocrNote = OCR_ENABLED
      ? ''
      : '<section><h4>这个版本没有截图识别</h4><p>静态托管版没有后端，所以不提供截图识别；手动填写可以用全部功能。想用截图识别，点右上角的<b>「截图识别」</b>按钮，里面有两个带识别功能的网址。</p></section>';
    openModal(`
      <div class="modal-head">
        <h3>使用说明</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>0 · 先玩一局试试（可选）</h4>
          <p>点右上角<b>「游戏模式」</b>可以随便玩一局，两种玩法、每种都能选三个地图：</p>
          <ul>
            <li><b>潮汐秘境</b>（双击翻开、单击标 ×）：从空盘开始、不限次数，数字 = 周围 8 格的钻石数，把钻石 💎 全找出来。</li>
            <li><b>扫雷</b>（单击翻开、右键或长按插旗 🚩）：大众那款，第一次点击保证安全，翻开所有不是雷的格子就通关。</li>
          </ul>
        </section>
        <section>
          <h4>1 · 把游戏里的盘面抄进来</h4>
          <ul>
            <li><b>电脑</b>：先点一下格子选中它，然后 —— <b>0~8</b> 填数字 · <b>Enter</b> 填钻石 · <b>X</b> 填 × · <b>Delete</b> 清除 · <b>方向键</b>换格子</li>
            <li><b>手机</b>：双击格子，在下面弹出的按钮里点（数字 / 钻石 / × / 清除）</li>
            <li><b>想快速标钻石</b>：右键格子（手机长按）；填错了按 <b>Ctrl+Z</b> 撤销</li>
            <li>一整盘抄不完也没关系，先把<b>已经翻开的数字</b>和<b>已经翻出的钻石</b>填上就够用了</li>
          </ul>
        </section>
        <section>
          <h4>2 · 看棋盘上的符号</h4>
          <ul>
            <li><span class="lg-dot lg-dot-gem">√</span><b>绿色 √ ＝ 这格是钻石</b>，直接去翻它</li>
            <li><span class="lg-dot lg-dot-safe">×</span><b>灰色 × ＝ 这格不是钻石</b>，可以放心</li>
            <li><b>右上角百分比</b>＝推不出来时的概率，仅供参考</li>
          </ul>
        </section>
        <section>
          <h4>3 · 照着棋盘下面那行字做</h4>
          <p>它会直接告诉你下一步点哪一格，例如：<b>「先点开 5行4列 —— 必定是钻石」</b>，照着点就行。</p>
        </section>
        <section>
          <h4>填错了怎么办</h4>
          <p>工具会自动检查。哪个数字和周围对不上，上方会提示「N 处数字对不上」，下面「当前盘面」里会列出具体是哪一格，改掉它就好。</p>
        </section>
        ${ocrNote}
        <section>
          <h4>当前盘面</h4>
          <div class="detail">${S.detailHtml || '<p class="card-desc">棋盘还是空的。</p>'}</div>
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
    S.ocrStage = '';      // 服务端报告的当前进度（例如"正在改用备选模型…"）
    const line = (s) => `识别中… 已用 ${s}s`
      + (S.ocrStage ? ` · ${S.ocrStage}` : `（按 ${sizeLabel} 识别，通常十几秒，忙的时候要一分钟）`);
    setImportStatus(line(0), 'busy');
    S.importTimer = setInterval(() => {
      setImportStatus(line(Math.round((Date.now() - t0) / 1000)), 'busy');
    }, 1000);
  }
  function stopImportClock() { clearInterval(S.importTimer); S.importTimer = null; }

  /**
   * 图片压缩：按【宽度】上限缩放。
   * 实测（12×12 截图，1200×2670 原图 1.4MB）：直接传原图时快时慢（6~46 秒），
   * 压到 1000px 宽（约 340KB）后稳定在 10~11 秒，读数完全一致 —— 所以按宽度压。
   * 已经是窄图（例如只截了棋盘的 900×900）就原样上传，不再缩。
   */
  function shrinkImage(file, maxWidth) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            if (img.width <= maxWidth) { resolve({ blob: file, url, note: `${img.width}×${img.height}` }); return; }
            const k = maxWidth / img.width;
            const w = maxWidth, h = Math.round(img.height * k);
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
            }, 'image/jpeg', 0.85);
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
      const svc = OCR_SERVICE || OCR_FALLBACK;
      openModal(`
        <div class="modal-head"><h3>截图识别</h3>
          <button class="modal-close" data-close type="button">✕</button></div>
        <div class="rules">
          <section>
            <p>当前打开的是<b>静态版</b>（放在静态空间里，没有后端），所以这一版不带截图识别。</p>
            <p>想用截图识别，点下面任一地址过去 —— 那边是<b>服务器版</b>，功能完全一样，还多一个截图识别：</p>
            <p style="margin-top:12px"><a class="btn" href="${svc}" target="_blank" rel="noopener">${svc}</a></p>
            <p style="margin-top:8px"><a class="btn" href="${GATEWAY_URL}" target="_blank" rel="noopener">${GATEWAY_URL}（总入口，自动跳转）</a></p>
            <p class="card-foot">这两个地址需要那台服务器开着；服务器关了也能用当前这个静态版手动填写。</p>
          </section>
        </div>`);
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
    const shrunk = await shrinkImage(file, 1000);   // 宽度上限：实测 1000px 最稳（见函数注释）
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
        if (j.status === 'running') {
          if (j.stage && j.stage !== S.ocrStage) S.ocrStage = j.stage;   // 让用户看到服务端在做什么
          continue;
        }
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
      S.gemTotal = GEM_TOTAL[rows];      // 钻石总数由尺寸固定
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
      // 几乎没读出东西：弱模型会把整张盘面都当成空格，这种"成功"必须拦住
      let filledN = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (S.grid[r][c] !== -1) filledN++;
      const cov = (typeof data.coverage === 'number') ? data.coverage : null;
      const weak = filledN === 0 || data.thin === true || filledN < Math.max(6, Math.round(rows * rows * 0.05)) || (cov != null && cov < 0.6);
      if (weak) {
        setImportStatus('识别完成，但几乎没有读出内容，请重试或手工填写。', 'err');
        openModal(`
          <div class="modal-head">
            <h3>这次没读出内容</h3>
            <button class="modal-close" data-close type="button">✕</button>
          </div>
          <div class="rules">
            <section>
              <p>${rows}×${rows} 一共 ${rows * cols} 格，这次只读出 <b>${filledN}</b> 个已翻开的格子${cov != null ? `（模型逐格只报回 ${data.reported}/${data.total} 格）` : ''}。</p>
              <p>说明识图服务没看清盘面，把大部分格子当成空的了。常见原因是图片太小太糊，或者换了不擅长看密集小字的识图模型。</p>
              <p>建议：<b>用清晰的整屏截图重试</b>；还是不行就对照截图手工填写 —— 手工填的盘面分析结果一样准确。</p>
            </section>
          </div>`);
      } else if (bad) {
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
      } else if (data.badRows > 0) {
        // 个别行读不准：那几行已留空并整行标红，提示用户手动补，别让他以为是空的
        setImportStatus(`识别完成，但有 ${data.badRows} 行没读准 —— 已留空并标红，请对照截图把那几行补上。`, 'err');
        toast(`识别完成：${data.badRows} 行没读准，红框那一行请手动补`, 'warn');
      } else {
        if (data.note) setImportStatus(data.note, '');
        toast(unsureN ? `识别完成，${unsureN} 处红框请重点核对` : '识别完成，请核对带红框的格子', 'gold');
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
    // 静态托管版：隐藏截图识别入口；两种版本都在页脚上方列出对应网址
    renderSiteLinks();
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
