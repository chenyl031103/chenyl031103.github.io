/* =====================================================================
   潮汐秘境 · 本地截图识别（纯浏览器 JS，零依赖、不联网）
   设计文档：docs/ocr-local-dev.md（参数与算法依据均来自该文档）
   输出契约与 parse-board.js 完全一致：cells 编码 -1 空 / 0-8 数字 / 9 宝钻 / 10 ×

   用法：
     TidalVision.configure({ createCanvas })        // Node 测试时可注入 canvas 工厂
     TidalVision.recognize(imageData, { forceN })   // → 契约对象（见 recognize 返回值）
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TidalVision = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 参数总表（对应文档 §7，集中放便于标定） ---------- */
  const CFG = {
    MAX_PIXELS: 5000000,        // 安全缩放上限（iOS canvas 面积限制）
    SAMPLE_INSET: 0.08,         // 采样窗每侧内缩比例（最小 2px）
    PITCH_MIN_RATIO: 0.035,     // 格宽搜索范围（相对图像短边）
    PITCH_MAX_RATIO: 0.25,
    N_CANDIDATES: [8, 10, 12],
    GRIDLINE_TH_RATIO: 0.10,    // 网格线判定阈值（相对最大值）
    GRIDLINE_COV: 0.70,         // 线覆盖率下限
    LONGEST_RUN_THS: [1.30, 1.20, 1.10, 1.00, 0.90, 0.80],
    OTSUSPLIT_SEP_MIN: 15,      // 亮/暗两组可分离的最小均值差
    OPEN_LUM_FALLBACK: 92,      // 不可分时的"已翻开"亮度上限（暗=已翻开）
    SEAM_DARK: 62,              // 格缝（暗线）亮度上限
    SEAM_BRIGHT: 92,            // 格缝两侧"未翻开格"的最低亮度
    SEAM_MAXW: 0.35,            // 格缝最大宽度（相对格宽）
    ORANGE: { r: 165, g: 105, b: 125, rb: 65 },   // 宝钻橙色判据
    ORANGE_FRAC_MIN: 0.075,
    DIGIT_GATE: 0.55,           // 数字门限（可分离）
    DIGIT_GATE_HARD: 0.62,      // 数字门限（不可分离）
    GLYPH_MARGIN: 0.05,         // 字形提取边缘内缩
    GLYPH_CONTRAST_MIN: 55,     // 最小对比度
    GLYPH_BBOX_MAXFRAC: 0.97,   // 主通道 bbox 占比上限
    GLYPH_BBOX_MAXFRAC_FB: 0.80,// 降级通道上限（挡 X/纹样）
    GLYPH_REL_TH_ADD: 0.55,     // 相对阈值 mn+0.55span
    GLYPH_FALLBACK_TH_ADD: 0.80,// 降级通道 mn+0.80span
    GLYPH_TH_MIN_ADD: 0.30,     // Otsu 阈值必须落在 [mn+0.30span, mn+0.85span]
    GLYPH_TH_MAX_ADD: 0.85,
    GLYPH_MIN_PX: 12,
    GLYPH_MIN_BW: 4,
    GLYPH_MIN_BH: 7,
    GLYPH_ASPECT_MAX: 1.35,
    GLYPH_ASPECT_MIN: 1 / 3.2,
    GW: 12, GH: 16,             // 匹配网格
    FW: 20, FH: 28,             // 孔洞网格
    TPL_FONTS: [
      'bold 46px Arial', 'bold 38px Arial', '46px Arial',
      'bold 46px Verdana', 'bold 46px Tahoma', 'bold 46px "Trebuchet MS"',
      'bold 46px "Segoe UI"', 'bold 46px "PingFang SC","Microsoft YaHei"',
      'bold 46px "DejaVu Sans"',
    ],
    X_LUM: 188, X_RGB_MIN: 158,
    X_FRAC_MIN: 0.025, X_FRAC_MAX: 0.42,
    X_SPAN_MIN: 0.50,
    X_MINCOV: 0.62,             // 未翻开分支
    X_MINCOV_OPEN: 0.75,        // 已翻开分支（误判代价大）
    RETRY_R: 3, RETRY_R_SMALL: 2,
    RETRY_R_UNOPENED: 1,        // 未翻开格只需查 X 标记（纹样不参与数字投票），半径可小
    RETRY_R_SMALL_FRAC: 0.5,
    RETRY_VOTE_MIN: 4, RETRY_VOTE_FRAC: 0.10, RETRY_VOTE_RATIO: 1.6,
    RETRY_HIT_MIN: 4,
    RETRY_MIN_POS: 6,
    THIN_MIN: 6, THIN_RATIO: 0.05,
    SIZE_BAND: [-0.078, -0.016],
    BOARD_MIN_LUM: 85,          // 棋盘格最低平均亮度（低于视为页面边框/背景，选点时罚分）
    GEM_TOTAL: { 8: 20, 10: 30, 12: 45 },
  };

  let canvasFactory = null;
  function configure(opts) {
    if (opts && typeof opts.createCanvas === 'function') canvasFactory = opts.createCanvas;
  }

  /* ---------- 小工具 ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function makeCanvas(w, h) {
    if (canvasFactory) return canvasFactory(w, h);
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    throw new Error('无可用 canvas（Node 环境请先 TidalVision.configure({createCanvas})）');
  }

  function toImageData(img) {
    if (img && img.data) return img;                       // 已是 ImageData
    if (img && typeof img.getContext === 'function') {
      const ctx = img.getContext('2d', { willReadFrequently: true });
      return ctx.getImageData(0, 0, img.width, img.height);
    }
    throw new Error('需传入 ImageData 或 canvas');
  }

  // 亮度图（0.299R+0.587G+0.114B）
  function lumMap(id) {
    const { data, width, height } = id;
    const L = new Float32Array(width * height);
    for (let i = 0, p = 0; i < L.length; i++, p += 4) {
      L[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return L;
  }

  // 安全缩放（超过像素上限按面积缩小）
  function safeScale(id) {
    const { width: w, height: h } = id;
    if (w * h <= CFG.MAX_PIXELS) return id;
    const s = Math.sqrt(CFG.MAX_PIXELS / (w * h));
    const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    const src = makeCanvas(w, h);
    src.getContext('2d').putImageData(id, 0, 0);
    const dst = makeCanvas(nw, nh);
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, nw, nh);
    return ctx.getImageData(0, 0, nw, nh);
  }

  /* ---------- 频谱/梯度定位（文档 §6.2） ---------- */
  // 每列与前一列的绝对差求和 → 网格线处形成尖峰
  function colGrad(L, W, H) {
    const g = new Float32Array(W);
    for (let x = 1; x < W; x++) {
      let s = 0;
      for (let y = 0; y < H; y++) s += Math.abs(L[y * W + x] - L[y * W + x - 1]);
      g[x] = s;
    }
    return g;
  }
  function rowGradRange(L, W, H, xa, xb) {
    const g = new Float32Array(H);
    for (let y = 1; y < H; y++) {
      let s = 0;
      for (let x = xa; x < xb; x++) s += Math.abs(L[y * W + x] - L[(y - 1) * W + x]);
      g[y] = s;
    }
    return g;
  }

  // 3 抽头局部最大（±1px 容差）
  function peak(g) {
    const out = new Float32Array(g.length);
    for (let i = 1; i < g.length - 1; i++) {
      out[i] = (g[i] >= g[i - 1] && g[i] >= g[i + 1]) ? g[i] : 0;
    }
    return out;
  }

  // 在 [minP,maxP] 内按 0.25px 精度扫周期，取 DFT 幅值最大者（必须保留小数周期）
  function dominant(g, minP, maxP) {
    let bestP = 0, bestMag = -1;
    for (let p = minP; p <= maxP; p += 0.25) {
      const w = 2 * Math.PI / p;
      let re = 0, im = 0;
      for (let x = 1; x < g.length; x++) {
        re += g[x] * Math.cos(w * x);
        im += g[x] * Math.sin(w * x);
      }
      const mag = Math.sqrt(re * re + im * im);
      if (mag > bestMag) { bestMag = mag; bestP = p; }
    }
    return bestP;
  }

  // 固定周期后精修相位 → 网格线位置（返回相位 0..period 的小数值）
  function refinePhase(g, period) {
    let bestPh = 0, bestS = -1;
    for (let ph = 0; ph < period; ph += 0.25) {
      let s = 0;
      for (let k = 0; ; k++) {
        const x = Math.round(ph + k * period);
        if (x >= g.length) break;
        s += g[x];
      }
      if (s > bestS) { bestS = s; bestPh = ph; }
    }
    return bestPh;
  }

  // 按阈值序列找最长连续网格线段，返回线位置数组
  function longestRun(g, phase, period, th) {
    let best = [];
    for (const t of CFG.LONGEST_RUN_THS) {
      const cur = [];
      for (let k = 0; ; k++) {
        const x = Math.round(phase + k * period);
        if (x >= g.length) break;
        if (g[x] >= th) cur.push(x);
        else if (cur.length > best.length) best = cur.slice(), cur.length = 0;
        else cur.length = 0;
      }
      if (cur.length > best.length) best = cur.slice();
      if (best.length >= 7) break;
    }
    return best;
  }

  // 理想线位上取局部最大，从后往前找覆盖率 ≥cov 的线数
  function countGridLines(g, phase, period, maxN) {
    const lines = [];
    for (let k = 0; k <= maxN + 1; k++) {
      const x = Math.round(phase + k * period);
      if (x < 1 || x >= g.length) break;
      let v = g[x];
      for (let d = -1; d <= 1; d++) v = Math.max(v, g[x + d] || 0);
      lines.push({ x, v });
    }
    if (!lines.length) return 0;
    const th = CFG.GRIDLINE_TH_RATIO * Math.max(...lines.map(l => l.v));
    let last = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].v >= th) last = i;
    // 检查最后一个线位起向前 覆盖率达标的线数（末线必须真是线）
    let n = 0;
    for (let i = 1; i <= last; i++) {
      let hit = 0;
      for (let k = 0; k <= i; k++) if (lines[k].v >= th) hit++;
      if (hit / (i + 1) >= CFG.GRIDLINE_COV) n = i;
    }
    return n;
  }

  // 亮蓝像素的边界：返回棋盘大致的左/上边界行（用于把网格吸附到棋盘上）
  function blueBounds(id, cellY, cellX) {
    const { width: W, height: H, data: d } = id;
    const rows = new Float64Array(H), cols = new Float64Array(W);
    const isBlue = (x, y) => {
      const p = (y * W + x) * 4;
      const r = d[p], g = d[p + 1], b = d[p + 2];
      return r < 60 && g > 100 && b > 160 && b - r > 120;
    };
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (isBlue(x, y)) { rows[y] += 2; cols[x] += 2; }
      }
    }
    const smooth = (arr, win) => {
      const L = arr.length, out = new Float64Array(L);
      for (let i = 0; i < L; i++) {
        const a = Math.max(0, i - win), b = Math.min(L - 1, i + win);
        let sum = 0;
        for (let j = a; j <= b; j++) sum += arr[j];
        out[i] = sum / (b - a + 1);
      }
      return out;
    };
    // 第一遍：行方向（棋盘是长条高密度蓝，场景的蓝行是孤立尖峰，用高阈值挡掉）
    const sr = smooth(rows, Math.max(6, Math.round(cellY * 0.5)));
    let maxR = 0;
    for (let i = 0; i < H; i++) if (sr[i] > maxR) maxR = sr[i];
    const thrR = Math.max(60, maxR * 0.45);
    let rowStart = -1, rowEnd = -1;
    for (let y = 0; y < H; y++) if (sr[y] >= thrR) { if (rowStart < 0) rowStart = y; rowEnd = y; }
    // 第二遍：列方向只在棋盘行范围内统计（排除场景/底部 UI 的蓝干扰）
    const yA = rowStart >= 0 ? rowStart : 0, yB = rowEnd >= 0 ? rowEnd : H - 1;
    const colCnt = new Float64Array(W);
    for (let y = yA; y <= yB; y += 2) {
      for (let x = 0; x < W; x += 2) if (isBlue(x, y)) colCnt[x] += 2;
    }
    const sc = smooth(colCnt, Math.max(6, Math.round(cellX * 0.5)));
    let maxC = 0;
    for (let i = 0; i < W; i++) if (sc[i] > maxC) maxC = sc[i];
    const thrC = Math.max(40, maxC * 0.30);
    let colStart = -1, colEnd = -1;
    for (let x = 0; x < W; x++) if (sc[x] >= thrC) { if (colStart < 0) colStart = x; colEnd = x; }
    return { rowStart, rowEnd, colStart, colEnd };
  }

  // 伪起点过滤：真棋盘格边缘是纯色（方差小）；UI 文字图标方差大。
  // 采样每格的"边缘环带"（避开中间的字形区域），首/末/中三行取均值。
  // 额外：未翻开格是标志性的亮蓝（r<60,g>100,b>160），命中大力加分——把棋盘和上方场景/UI 区分开
  function boardContentScore(id, L, W, H, x0, y0, cell, n) {
    const rows = [0, (n / 2) | 0, n - 1];
    const offs = [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36], [-0.40, 0], [0.40, 0], [0, -0.40], [0, 0.40]];
    const pw = Math.max(1, Math.round(cell * 0.06));
    const d = id.data;
    let sum = 0, cnt = 0;
    for (const r of rows) {
      for (let c = 0; c < n; c++) {
        const cx = x0 + (c + 0.5) * cell, cy = y0 + (r + 0.5) * cell;
        for (const [fx, fy] of offs) {
          const bx = Math.round(cx + fx * cell), by = Math.round(cy + fy * cell);
          let mean = 0, m2 = 0, k = 0;
          for (let dy = -pw; dy <= pw; dy++) {
            for (let dx = -pw; dx <= pw; dx++) {
              const x = bx + dx, y = by + dy;
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const p = (y * W + x) * 4;
              const rr = d[p], gg = d[p + 1], bb = d[p + 2];
              const v = 0.299 * rr + 0.587 * gg + 0.114 * bb;
              mean += v; m2 += v * v; k++;
            }
          }
          if (k < 3) { sum += 1e6; cnt++; continue; }
          mean /= k;
          const varr = Math.max(0, m2 / k - mean * mean);   // 方差：格内越纯色越低
          const dark = Math.max(0, CFG.BOARD_MIN_LUM - mean);   // 过暗（页面边框/背景）罚分
          sum += varr + dark * dark * 2;
          cnt++;
        }
      }
    }
    return cnt ? sum / cnt : 1e9;
  }

  // 亚像素精修：起点/周期允许小数，最小化线上的梯度峰值偏差
  function refineAxis(g, phase, period) {
    let best = { ph: phase, p: period, s: -1 };
    for (let dp = -0.5; dp <= 0.5; dp += 0.25) {
      const p = period + dp;
      for (let dph = -0.5; dph <= 0.5; dph += 0.25) {
        const ph = phase + dph;
        let s = 0, k = 0;
        for (; ; k++) {
          const x = Math.round(ph + k * p);
          if (x >= g.length) break;
          s += g[x];
        }
        const norm = k > 0 ? s / k : -1;
        if (norm > best.s) best = { ph, p, s: norm };
      }
    }
    return best;
  }

  // ---- 棋盘外框定位（面板亮边）----
  // 棋盘四周各有一条贯穿整个棋盘的青色亮线（面板凸起高光）。比单格高光长得多
  // （单格高光被格缝切断，run ≈ 1 格），也不受上方场景/UI 的伪周期干扰，
  // 而且不依赖"上排是否已翻开"——比频谱法稳得多。
  function frameBands(id, W, H, n, cellX0, cellY0) {
    const d = id.data;
    const isEdge = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      return r < 150 && g > 145 && b > 175 && g - r > 60;
    };
    const STEP = 4;   // 隔点采样（亮边连续几十像素，4px 步长足够，速度 ×4）
    const longestRun = (fixed, horizontal, from, to) => {
      let best = 0, cur = 0, gap = 0;
      for (let i = from; i < to; i += STEP) {
        const v = horizontal ? isEdge(i, fixed) : isEdge(fixed, i);
        if (v) { cur += gap + 1; gap = 0; if (cur > best) best = cur; }
        else { gap++; if (gap > 2) { cur = 0; gap = 0; } }
      }
      return best * STEP;
    };
    const rowRun = new Float64Array(H), colRun = new Float64Array(W);
    let maxR = 0, maxC = 0;
    for (let y = 0; y < H; y++) { rowRun[y] = longestRun(y, true, 0, W); if (rowRun[y] > maxR) maxR = rowRun[y]; }
    const minLen = Math.max(40, Math.round(Math.min(n * cellX0, n * cellY0) * 0.35));
    const bands = (runs, maxRun) => {
      const thr = Math.max(minLen, maxRun * 0.62);
      const out = [];
      let s = -1;
      for (let i = 0; i < runs.length; i++) {
        if (runs[i] >= thr) { if (s < 0) s = i; }
        else if (s >= 0) { if (i - 1 - s <= 8) out.push({ start: s, end: i - 1 }); s = -1; }
      }
      if (s >= 0) out.push({ start: s, end: runs.length - 1 });
      for (const b of out) b.mid = (b.start + b.end) / 2;
      return out;
    };
    const rowBands = bands(rowRun, maxR);
    // 列扫描只在"棋盘行范围"内做（框住棋盘的上下亮边之间），省一大半
    let yA = 0, yB = H;
    if (rowBands.length >= 2) {
      const sorted = rowBands.slice().sort((a, b) => a.mid - b.mid);
      yA = Math.max(0, Math.round(sorted[0].mid));
      yB = Math.min(H, Math.round(sorted[sorted.length - 1].mid) + 1);
    }
    for (let x = 0; x < W; x++) { colRun[x] = longestRun(x, false, yA, yB); if (colRun[x] > maxC) maxC = colRun[x]; }
    return { rows: rowBands, cols: bands(colRun, maxC) };
  }

  // 用外框亮边 + 亮蓝区域定出棋盘矩形（取亮带内缘 = 网格边界，扫描窗内缩后落在格内）
  function frameGrid(fb, bb, n) {
    const pick = (arr, lo, hi, needInside) => {
      if (!arr.length) return null;
      if (needInside && lo >= 0 && hi >= 0) {
        let a = null, b = null;
        for (const bd of arr) {
          if (bd.mid < lo && (!a || bd.mid > a.mid)) a = bd;
          if (bd.mid > hi && (!b || bd.mid < b.mid)) b = bd;
        }
        if (a && b) return [a, b];
      }
      // 无蓝带参考：取 run 最长（用长度近似：带越厚越长）且相距最远的一对
      const s = arr.slice().sort((p, q) => p.mid - q.mid);
      if (s.length < 2) return null;
      let best = null, bd2 = -1;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        const gap = s[j].mid - s[i].mid;
        if (gap > bd2) { bd2 = gap; best = [s[i], s[j]]; }
      }
      return best;
    };
    const hasB = bb && bb.rowStart >= 0 && bb.colStart >= 0;
    const rp = pick(fb.rows, hasB ? bb.rowStart : -1, hasB ? bb.rowEnd : -1, hasB);
    const cp = pick(fb.cols, hasB ? bb.colStart : -1, hasB ? bb.colEnd : -1, hasB);
    if (!rp || !cp) return null;
    const y0 = rp[0].end + 0.5, y1 = rp[1].start - 0.5;
    const x0 = cp[0].end + 0.5, x1 = cp[1].start - 0.5;
    if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return null;
    return { x0, y0, x1, y1, cellX: (x1 - x0) / n, cellY: (y1 - y0) / n };
  }

  // 棋盘定位主函数
  function detectBoard(id, opts) {
    // 手动微调：调用方直接给网格（平移/缩放后重跑），跳过自动定位
    if (opts && opts.grid) {
      const g = opts.grid;
      return { x0: g.x0, y0: g.y0, cellX: g.cellX, cellY: g.cellY, n: g.n, src: 'manual', note: '' };
    }
    const { width: W, height: H } = id;
    const L = lumMap(id);
    const minWH = Math.min(W, H);
    const Pmin = Math.max(16, CFG.PITCH_MIN_RATIO * minWH);
    const Pmax = CFG.PITCH_MAX_RATIO * minWH;

    // ---- 快路：外框亮边定矩形 + 暗缝间距定格宽/档位（不跑频谱，省 200ms+）----
    let grid = null;
    try {
      const rough = minWH * 0.075;    // 先验格宽：8~12 格棋盘约占短边的 60%~90%
      const fb0 = frameBands(id, W, H, 12, rough, rough);
      // 上下/左右各只有一条贯穿亮线时无需再扫亮蓝（省一大圈像素扫描）
      let rect = (fb0.rows.length === 2 && fb0.cols.length === 2) ? frameGrid(fb0, null, 12) : null;
      if (!rect) rect = frameGrid(fb0, blueBounds(id, rough, rough), 12);
      if (rect && blueFracIn(id, rect) >= 0.25) {
        const py = pitchFromSeams(L, W, H, rect.x0, rect.x1, rect.y0, rect.y1, false, rough);
        const px = pitchFromSeams(L, W, H, rect.x0, rect.x1, rect.y0, rect.y1, true, rough);
        const nX = px ? Math.round((rect.x1 - rect.x0) / px) : 0;
        const nY = py ? Math.round((rect.y1 - rect.y0) / py) : 0;
        let n = nX && nY ? (nX === nY ? nX : 0) : (nX || nY);
        if (n) {
          let bestN = CFG.N_CANDIDATES[0], bd = 1e9;
          for (const c of CFG.N_CANDIDATES) {
            const d = Math.abs(c - n);
            if (d < bd - 0.01) { bd = d; bestN = c; }
            else if (Math.abs(d - bd) <= 0.01 && c > bestN) bestN = c;
          }
          n = bestN;
        }
        if (n) {
          const rectN = opts && opts.forceN ? opts.forceN : n;
          const g = { x0: rect.x0, y0: rect.y0, cellX: (rect.x1 - rect.x0) / rectN, cellY: (rect.y1 - rect.y0) / rectN, n: rectN, src: 'frame', note: '' };
          // 交叉校验：格子应是正方形，格宽要落在合理范围（否则退回频谱法）
          const cxm = Math.max(g.cellX, g.cellY);
          if (g.cellX > Pmin && g.cellX < Pmax && g.cellY > Pmin && g.cellY < Pmax &&
              Math.abs(g.cellX - g.cellY) <= 0.12 * cxm) {
            grid = g;
            if (opts && opts.forceN) grid.src = 'force';
          }
        }
      }
    } catch (e) { grid = null; }

    if (!grid) return detectBoardSpectral(id, opts, L, W, H, Pmin, Pmax);
    // 边界修正：让网格完整落在图内
    if (grid.x0 < 0) grid.x0 = 0;
    if (grid.y0 < 0) grid.y0 = 0;
    if (grid.x0 + grid.n * grid.cellX > W) grid.x0 = Math.max(0, W - grid.n * grid.cellX);
    if (grid.y0 + grid.n * grid.cellY > H) grid.y0 = Math.max(0, H - grid.n * grid.cellY);
    return grid;
  }

  // 矩形内亮蓝像素占比（粗采样，用来确认"框住的真是棋盘"）
  function blueFracIn(id, r) {
    const { width: W, data: d } = id;
    let hit = 0, tot = 0;
    const nx = 12, ny = 12;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = Math.round(r.x0 + (ix + 0.5) * (r.x1 - r.x0) / nx);
        const y = Math.round(r.y0 + (iy + 0.5) * (r.y1 - r.y0) / ny);
        for (let dy = -4; dy <= 4; dy += 4) {
          for (let dx = -4; dx <= 4; dx += 4) {
            const p = ((y + dy) * W + (x + dx)) * 4;
            if (p < 0 || p >= d.length) continue;
            const rr = d[p], gg = d[p + 1], bb = d[p + 2];
            tot++;
            if (rr < 60 && gg > 100 && bb > 160 && bb - rr > 120) hit++;
          }
        }
      }
    }
    return tot ? hit / tot : 0;
  }

  // 扫描线上找暗缝中心（要求缝两侧是亮区：只取夹在未翻开格之间的格线）
  function seamCentersIn(get, from, to, maxw) {
    const out = [];
    let s = -1;
    for (let i = from; i <= to; i++) {
      const v = get(i);
      if (v < CFG.SEAM_DARK) { if (s < 0) s = i; }
      else if (s >= 0) {
        const w = i - s, mid = s + (w - 1) / 2;
        const pad = Math.max(3, Math.round(w * 0.8));
        const li = Math.max(from, s - pad), ri = Math.min(to, i + pad);
        if (w >= 2 && w <= maxw && get(li) > CFG.SEAM_BRIGHT && get(ri) > CFG.SEAM_BRIGHT) out.push(mid);
        s = -1;
      }
    }
    return out;
  }

  // 暗缝间距的中位数 = 格宽（只在棋盘矩形内统计，快且准；样本不足返回 0）
  function pitchFromSeams(L, W, H, x0, x1, y0, y1, vertical, guess) {
    const maxw = Math.max(2, Math.round(guess * CFG.SEAM_MAXW));
    const lo = guess * 0.5, hi = guess * 1.6;
    const sLo = Math.round(vertical ? y0 + guess * 0.2 : x0 + guess * 0.2);
    const sHi = Math.round(vertical ? y1 - guess * 0.2 : x1 - guess * 0.2);
    const from = Math.max(0, Math.round(vertical ? x0 : y0));
    const toV = vertical ? Math.min(W - 1, Math.round(x1)) : Math.min(H - 1, Math.round(y1));
    const diffs = [];
    for (const s of samplePositions(sLo, sHi, 12)) {
      const get = vertical ? (i) => L[s * W + i] : (i) => L[i * W + s];
      const cs = seamCentersIn(get, from, toV, maxw);
      for (let i = 1; i < cs.length; i++) {
        const d = cs[i] - cs[i - 1];
        if (d >= lo && d <= hi) diffs.push(d);
      }
    }
    if (diffs.length < 3) return 0;
    diffs.sort((a, b) => a - b);
    return diffs[(diffs.length / 2) | 0];
  }

  // 频谱法（外框不可用时的完整定位流程）
  function detectBoardSpectral(id, opts, L, W, H, Pmin, Pmax) {
    const gx = peak(colGrad(L, W, H));
    let cellX = dominant(gx, Pmin, Pmax);
    if (!cellX) return null;
    let phX = refinePhase(gx, cellX);
    ({ ph: phX, p: cellX } = refineAxis(gx, phX, cellX));

    // 起始线：沿相位格点滑窗，用"格子边缘纯色度"选最佳起点（避开上方 UI 的伪起点）
    let x0 = phX;
    while (x0 - cellX > 0) x0 -= cellX;
    if (x0 < 0) x0 = phX;

    // Y 轴：行梯度取图像中间 60% 宽度（避开两侧 UI），先求周期/相位
    const xa = Math.round(W * 0.2), xb = Math.round(W * 0.8);
    const gy = peak(rowGradRange(L, W, H, xa, xb));
    let cellY = dominant(gy, Pmin, Pmax);
    if (!cellY) cellY = cellX;
    let phY = refinePhase(gy, cellY);
    ({ ph: phY, p: cellY } = refineAxis(gy, phY, cellY));
    let y0 = phY;
    while (y0 - cellY > 0) y0 -= cellY;
    if (y0 < 0) y0 = phY;

    // N 判定
    let n = 0;
    const nLines = countGridLines(gx, x0, cellX, 14);
    if (nLines >= 7) n = nLines;
    if (!n) {
      const run = longestRun(gx, x0, cellX, CFG.GRIDLINE_TH_RATIO * Math.max(...gx));
      if (run.length >= 8) n = run.length - 1;
    }
    if (!n) n = Math.round((W - 2 * x0) / cellX);
    // 映射到候选（平局取大）
    let bestN = CFG.N_CANDIDATES[0], bd = 1e9;
    for (const c of CFG.N_CANDIDATES) {
      const d = Math.abs(c - n);
      if (d < bd - 0.01) { bd = d; bestN = c; }
      else if (Math.abs(d - bd) <= 0.01 && c > bestN) bestN = c;
    }
    n = bestN;
    if (opts && opts.forceN) n = opts.forceN;

    // 定位优先级：① 棋盘外框亮边（最稳）② 亮蓝边界吸附到频谱格点 ③ 内容评分滑窗
    const bb = blueBounds(id, cellY, cellX);
    let grid = null;

    // ① 外框亮边：棋盘四周各有一条贯穿棋盘的青色亮线，四条线直接框出棋盘
    try {
      const fb = frameBands(id, W, H, n, cellX, cellY);
      const fg = frameGrid(fb, bb, n);
      if (fg && fg.cellX > cellX * 0.75 && fg.cellX < cellX * 1.3 &&
          fg.cellY > cellY * 0.75 && fg.cellY < cellY * 1.3) {
        grid = { x0: fg.x0, y0: fg.y0, cellX: fg.cellX, cellY: fg.cellY, n, src: 'frame', note: '' };
      }
    } catch (e) { grid = null; }

    // ② 亮蓝像素的行/列边界吸附到最近的网格格点（棋盘格几乎全是亮蓝；
    //    场景/按钮的蓝密度低，被阈值挡掉）
    if (!grid) {
      const snap = (target, phase, period) => {
        if (target < 0) return null;
        const k = Math.round((target - phase) / period);
        return phase + k * period;
      };
      const snapX = snap(bb.colStart, phX, cellX);
      const snapY = snap(bb.rowStart, phY, cellY);
      // 吸附点 ±2 格内用"格内纯色度"微调（吸附点可能有半格偏差）
      const bestStart = (target, period, otherFirst, otherVal) => {
        let best = target, bestS = Infinity;
        for (let k = -2; k <= 2; k++) {
          const v = target + k * period;
          if (v < 0) continue;
          const sc = otherFirst
            ? boardContentScore(id, L, W, H, v, otherVal, (cellX + cellY) / 2, n)
            : boardContentScore(id, L, W, H, otherVal, v, (cellX + cellY) / 2, n);
          if (sc < bestS) { bestS = sc; best = v; }
        }
        return best;
      };
      if (snapX !== null && snapY !== null) {
        if (snapY + n * cellY <= H) x0 = bestStart(snapX, cellX, true, snapY);
        if (x0 + n * cellX <= W && snapY + n * cellY <= H) y0 = bestStart(snapY, cellY, false, x0);
        grid = { x0, y0, cellX, cellY, n, src: 'blue', note: '' };
      }
    }

    // ③ 内容评分滑窗兜底（无亮蓝可依时）
    if (!grid) {
      x0 = phX;
      while (x0 - cellX > 0) x0 -= cellX;
      if (x0 < 0) x0 = phX;
      y0 = phY;
      while (y0 - cellY > 0) y0 -= cellY;
      if (y0 < 0) y0 = phY;
      {
        let bestX = x0, bestS = Infinity;
        const maxK = Math.ceil(W / cellX) + 2;
        for (let k = -2; k <= maxK; k++) {
          const xx = phX + k * cellX;
          if (xx < 0 || xx + n * cellX > W || y0 + n * cellY > H) continue;
          const sc = boardContentScore(id, L, W, H, xx, y0, cellX, n);
          if (sc < bestS) { bestS = sc; bestX = xx; }
        }
        x0 = bestX;
      }
      {
        let bestY = y0, bestS = Infinity;
        const maxK = Math.ceil(H / cellY) + 2;
        for (let k = -2; k <= maxK; k++) {
          const yy = phY + k * cellY;
          if (yy < 0 || yy + n * cellY > H) continue;
          const sc = boardContentScore(id, L, W, H, x0, yy, (cellX + cellY) / 2, n);
          if (sc < bestS) { bestS = sc; bestY = yy; }
        }
        y0 = bestY;
      }
      grid = { x0, y0, cellX, cellY, n, src: 'cycle', note: '' };
    }
    if (opts && opts.forceN) grid.src = 'force';

    // 边界修正：让网格完整落在图内
    if (grid.x0 < 0) grid.x0 = 0;
    if (grid.y0 < 0) grid.y0 = 0;
    if (grid.x0 + grid.n * grid.cellX > W) grid.x0 = Math.max(0, W - grid.n * grid.cellX);
    if (grid.y0 + grid.n * grid.cellY > H) grid.y0 = Math.max(0, H - grid.n * grid.cellY);
    return grid;
  }

  // 尺寸文字交叉验证（"地图：38（12×12）"）——只作辅助线索
  function detectMapSizeText(L, W, H, grid) {
    try {
      const [b0, b1] = CFG.SIZE_BAND;
      const top = Math.max(0, Math.round(grid.y0 + b0 * H));
      const bot = Math.max(0, Math.round(grid.y0 + b1 * H));
      if (bot - top < 6) return 0;
      let mn = 255, mx = 0;
      const hist = new Int32Array(256);
      for (let y = top; y < bot; y++) for (let x = 0; x < W; x++) {
        const v = L[y * W + x] | 0;
        hist[v]++; if (v < mn) mn = v; if (v > mx) mx = v;
      }
      // Otsu
      let total = 0, sum = 0;
      for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
      let wB = 0, sumB = 0, best = -1, thr = 128;
      for (let i = 0; i < 256; i++) {
        wB += hist[i]; if (!wB) continue;
        const wF = total - wB; if (!wF) break;
        sumB += i * hist[i];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const v = wB * wF * (mB - mF) * (mB - mF);
        if (v > best) { best = v; thr = i; }
      }
      thr = Math.max(150, thr);
      // 连通域计数（8 邻域）
      const bw = new Uint8Array(W * (bot - top));
      let fg = 0;
      for (let y = top; y < bot; y++) for (let x = 0; x < W; x++) {
        if (L[y * W + x] > thr) { bw[(y - top) * W + x] = 1; fg++; }
      }
      if (fg < 40 || fg > (bot - top) * W * 0.5) return 0;
      const seen = new Uint8Array(bw.length);
      const comps = [];
      const HH = bot - top;
      for (let i = 0; i < bw.length; i++) {
        if (!bw[i] || seen[i]) continue;
        let n = 0; const st = [i]; seen[i] = 1;
        let minX = 1e9, maxX = -1;
        while (st.length) {
          const p = st.pop(); n++;
          const x = p % W, y = (p / W) | 0;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= HH) continue;
            const q = ny * W + nx;
            if (bw[q] && !seen[q]) { seen[q] = 1; st.push(q); }
          }
        }
        if (n >= 12) comps.push({ minX, maxX, n, x: minX });
      }
      if (comps.length < 2) return 0;
      comps.sort((a, b) => a.x - b.x);
      const chars = comps.filter(c => c.n >= 12);
      if (chars.length === 3) return 8;
      if (chars.length === 5) return 12;   // 粗略：5 字符多为 10×10/12×12
      if (chars.length >= 4 && chars.length <= 6) return 10;
      return 0;
    } catch (e) { return 0; }
  }

  /* ---------- 逐格采样与分类（§6.4） ---------- */
  function cellStats(id, L, cx, cy, cw, ch) {
    const inset = Math.max(2, Math.round(Math.min(cw, ch) * CFG.SAMPLE_INSET));
    const x0 = Math.round(cx + inset), y0 = Math.round(cy + inset);
    const x1 = Math.round(cx + cw - inset), y1 = Math.round(cy + ch - inset);
    const { data, width: W, height: H } = id;
    let sum = 0, n = 0, orange = 0, total = 0;
    let mn = 255, mx = 0;
    for (let y = y0; y < y1; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = x0; x < x1; x++) {
        if (x < 0 || x >= W) continue;
        const p = (y * W + x) * 4;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += l; n++;
        if (l < mn) mn = l; if (l > mx) mx = l;
        if (r > CFG.ORANGE.r && g > CFG.ORANGE.g && b < CFG.ORANGE.b && r - b > CFG.ORANGE.rb) orange++;
        total++;
      }
    }
    return { meanLum: n ? sum / n : 0, orangeFrac: total ? orange / total : 0, mn, mx, n };
  }

  // 全盘亮度 Otsu 分成亮/暗两组（取方差最大平台中点）
  function otsuSplit(values) {
    const hist = new Int32Array(256);
    for (const v of values) hist[clamp(Math.round(v), 0, 255)]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = -1;
    const vars = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      vars[i] = wB * wF * (mB - mF) * (mB - mF);
      if (vars[i] > best) best = vars[i];
    }
    let lo = 0, hi = 255;
    if (best > 0) {
      let a = 0, b = 255;
      for (let i = 0; i < 256; i++) if (vars[i] >= best * 0.9995) { a = i; break; }
      for (let i = 255; i >= 0; i--) if (vars[i] >= best * 0.9995) { b = i; break; }
      lo = a; hi = b;
    }
    const thr = (lo + hi) / 2;
    let sB = 0, nB = 0, sD = 0, nD = 0, mnB = 255, mxD = 0;
    for (const v of values) {
      if (v >= thr) { sB += v; nB++; if (v < mnB) mnB = v; }
      else { sD += v; nD++; if (v > mxD) mxD = v; }
    }
    const sep = (nB && nD) ? Math.abs(sB / nB - sD / nD) : 0;
    return { thr, sep, brightMean: nB ? sB / nB : 0, darkMean: nD ? sD / nD : 0, nB, nD };
  }

  /* ---------- 数字识别（§6.5） ---------- */
  let templates = null;   // { g16: Float32Array[], holes: number[] }
  function buildTemplates() {
    if (templates) return templates;
    const g16 = [], holes = [];
    for (const font of CFG.TPL_FONTS) {
      for (let d = 0; d <= 8; d++) {
        const c = makeCanvas(64, 78);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 78);
        ctx.fillStyle = '#fff'; ctx.font = font;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(d), 32, 39);
        const img = ctx.getImageData(0, 0, 64, 78);
        const gg = glyphOf(img, 0, 0, 64, 78, 170);
        if (!gg) continue;
        g16.push(normGrid(gg, CFG.GW, CFG.GH));
        holes.push(holesOf(gg, CFG.FW, CFG.FH));
      }
    }
    templates = { g16, holes };
    return templates;
  }

  // 在给定区域抽出字形（bbox 归一化到 12×16 之前的“原始二值矩形”）
  function glyphOf(id, x0, y0, w, h, thr) {
    // 返回 {bw,bh,bin(Uint8Array)} bbox 裁紧
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = ((y0 + y) * id.width + (x0 + x)) * 4;
        const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
        if (l > thr) {
          bin[y * w + x] = 1;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const out = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[y * bw + x] = bin[(y + minY) * w + (x + minX)];
    return { bw, bh, bin: out };
  }

  // 归一化到 GW×GH 灰度网格（阈 lum>170 的二值后的 0/1）
  function normGrid(gl, GW, GH) {
    const g = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const sx0 = Math.floor(gx * gl.bw / GW), sx1 = Math.max(sx0 + 1, Math.floor((gx + 1) * gl.bw / GW));
        const sy0 = Math.floor(gy * gl.bh / GH), sy1 = Math.max(sy0 + 1, Math.floor((gy + 1) * gl.bh / GH));
        let s = 0, n = 0;
        for (let y = sy0; y < sy1 && y < gl.bh; y++) for (let x = sx0; x < sx1 && x < gl.bw; x++) { s += gl.bin[y * gl.bw + x]; n++; }
        g[gy * GW + gx] = n ? s / n : 0;
      }
    }
    return g;
  }

  // 孔洞数：从边界洪泛背景，剩余封闭区即孔洞
  function holesOf(gl, FW, FH) {
    const g = normGrid(gl, FW, FH);
    const bw = new Uint8Array(FW * FH);
    for (let i = 0; i < g.length; i++) bw[i] = g[i] > 0.45 ? 1 : 0;
    const seen = new Uint8Array(FW * FH);
    const st = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= FW || y >= FH) return;
      const i = y * FW + x;
      if (!seen[i] && !bw[i]) { seen[i] = 1; st.push(i); }
    };
    for (let x = 0; x < FW; x++) { push(x, 0); push(x, FH - 1); }
    for (let y = 0; y < FH; y++) { push(0, y); push(FW - 1, y); }
    while (st.length) {
      const i = st.pop(), x = i % FW, y = (i / FW) | 0;
      push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
    }
    let holes = 0;
    for (let i = 0; i < bw.length; i++) {
      if (bw[i] || seen[i]) continue;
      holes++;
      const s2 = [i]; seen[i] = 1;
      while (s2.length) {
        const j = s2.pop(), x = j % FW, y = (j / FW) | 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= FW || ny >= FH) continue;
          const q = ny * FW + nx;
          if (!bw[q] && !seen[q]) { seen[q] = 1; s2.push(q); }
        }
      }
    }
    return holes;
  }

  // 从格子采样数据抽字形（对照 §6.5：裁 5% 边缘、对比度闸、双通道）
  function extractGlyph(id, x0, y0, w, h) {
    const m = CFG.GLYPH_MARGIN;
    const cw = w - 2 * Math.floor(w * m), chh = h - 2 * Math.floor(h * m);
    const cx = x0 + Math.floor(w * m), cy = y0 + Math.floor(h * m);
    if (cw < 6 || chh < 6) return null;

    // 统计区间
    let mn = 255, mx = 0;
    for (let y = cy; y < cy + chh; y++) {
      for (let x = cx; x < cx + cw; x++) {
        const p = (y * id.width + x) * 4;
        const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
        if (l < mn) mn = l; if (l > mx) mx = l;
      }
    }
    const span = mx - mn;
    if (span < CFG.GLYPH_CONTRAST_MIN) return null;

    // 主通道：Otsu 阈值必须落在 [mn+0.30span, mn+0.85span]，否则回退相对阈值
    let thr = mn + CFG.GLYPH_REL_TH_ADD * span;
    const otsu = otsuSplitOf(id, cx, cy, cw, chh);
    if (otsu >= mn + CFG.GLYPH_TH_MIN_ADD * span && otsu <= mn + CFG.GLYPH_TH_MAX_ADD * span) thr = otsu;

    const main = buildGlyph(id, cx, cy, cw, chh, thr, false, CFG.GLYPH_BBOX_MAXFRAC);
    if (main) return { ...main, channel: 'main' };
    // 降级通道：浅灰笔画数字
    const fb = buildGlyph(id, cx, cy, cw, chh, mn + CFG.GLYPH_FALLBACK_TH_ADD * span, false, CFG.GLYPH_BBOX_MAXFRAC_FB);
    if (fb) return { ...fb, channel: 'fallback' };
    return null;
  }

  function otsuSplitOf(id, cx, cy, cw, chh) {
    const hist = new Int32Array(256);
    let n = 0;
    for (let y = cy; y < cy + chh; y++) {
      for (let x = cx; x < cx + cw; x++) {
        const p = (y * id.width + x) * 4;
        const l = (0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2]) | 0;
        hist[l]++; n++;
      }
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = -1, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }

  // 阈值化 + bbox 质量门槛
  function buildGlyph(id, cx, cy, cw, chh, thr, dark, maxFrac) {
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, cnt = 0;
    const bin = new Uint8Array(cw * chh);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const p = ((cy + y) * id.width + (cx + x)) * 4;
        const l = 0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2];
        const hit = dark ? l < thr : l > thr;
        if (hit) {
          bin[y * cw + x] = 1; cnt++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (cnt < CFG.GLYPH_MIN_PX) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < CFG.GLYPH_MIN_BW || bh < CFG.GLYPH_MIN_BH) return null;
    if (bw / cw > maxFrac || bh / chh > maxFrac) return null;
    const ar = bw / bh;
    if (ar > CFG.GLYPH_ASPECT_MAX || ar < CFG.GLYPH_ASPECT_MIN) return null;
    const out = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[y * bw + x] = bin[(y + minY) * cw + (x + minX)];
    return { bw, bh, bin: out };
  }

  // 匹配打分：9 组字体全部取最小误差（孔洞先筛，必要时去掉重来）
  function ocrDigit(gl) {
    const T = buildTemplates();
    const g16 = normGrid(gl, CFG.GW, CFG.GH);
    const obsHoles = holesOf(gl, CFG.FW, CFG.FH);
    const errs = [];
    const N = g16.length;
    const errOf = (t) => { let e = 0; for (let i = 0; i < g16.length; i++) { const d = g16[i] - t[i]; e += d * d; } return e; };
    for (let i = 0; i < T.g16.length; i++) {
      if (T.holes[i] !== obsHoles) continue;
      errs.push({ d: i % 9, e: errOf(T.g16[i]) });
    }
    let holesOk = errs.length > 0;
    if (!holesOk) {
      for (let i = 0; i < T.g16.length; i++) errs.push({ d: i % 9, e: errOf(T.g16[i]) });
    }
    errs.sort((a, b) => a.e - b.e);
    const best = errs[0];
    let second = 1e9;
    for (const e of errs) if (e.d !== best.d) { second = e.e; break; }
    let conf = 1 - best.e / N;
    conf *= Math.min(1, (second - best.e) / N * 4 + 0.5);
    if (!holesOk) conf *= 0.85;
    return { d: best.d, conf };
  }

  /* ---------- × 标记（§6.6） ---------- */
  function detectXMark(id, x0, y0, w, h, minCov) {
    const m = 0.06;
    const cw = w - 2 * Math.round(w * m), chh = h - 2 * Math.round(h * m);
    const cx = x0 + Math.round(w * m), cy = y0 + Math.round(h * m);
    if (cw < 6 || chh < 6) return false;
    const bin = new Uint8Array(cw * chh);
    let cnt = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const p = ((cy + y) * id.width + (cx + x)) * 4;
        const r = id.data[p], g = id.data[p + 1], b = id.data[p + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (l > CFG.X_LUM && r > CFG.X_RGB_MIN && g > CFG.X_RGB_MIN && b > CFG.X_RGB_MIN) {
          bin[y * cw + x] = 1; cnt++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const frac = cnt / (cw * chh);
    if (frac < CFG.X_FRAC_MIN || frac > CFG.X_FRAC_MAX) return false;
    const spanX = maxX >= 0 ? (maxX - minX + 1) / cw : 0;
    const spanY = maxY >= 0 ? (maxY - minY + 1) / chh : 0;
    if (spanX < CFG.X_SPAN_MIN || spanY < CFG.X_SPAN_MIN) return false;
    // 两条对角线命中率
    const diagHit = (dir) => {
      let hit = 0, tot = 0;
      const steps = Math.max(cw, chh);
      for (let t = 0; t < steps; t++) {
        const x = dir > 0 ? Math.round(t * (cw - 1) / (steps - 1)) : Math.round((cw - 1) - t * (cw - 1) / (steps - 1));
        const y = Math.round(t * (chh - 1) / (steps - 1));
        let ok = false;
        for (let dy = -3; dy <= 3 && !ok; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= chh) continue;
            if (bin[ny * cw + nx]) { ok = true; break; }
          }
        }
        tot++;
        if (ok) hit++;
      }
      return tot ? hit / tot : 0;
    };
    const cov1 = diagHit(1), cov2 = diagHit(-1);
    return Math.min(cov1, cov2) >= minCov;
  }

  /* ---------- 全盘识别流程 ---------- */
  function recognize(input, opts) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    opts = opts || {};
    let id = toImageData(input);
    id = safeScale(id);

    const grid = detectBoard(id, opts);
    if (!grid) {
      const e = new Error('未能自动识别棋盘，请手动调整或改用服务器识别');
      e.code = 'NO_BOARD';
      throw e;
    }
    const { n } = grid;
    // 尺寸文字交叉验证（只记入 note）
    const textN = detectMapSizeText(lumMap(id), id.width, id.height, grid);
    if (textN && textN !== n) grid.note = `另有线索指向 ${textN}×${textN}，已按格子周期取 ${n}×${n}`;

    const cells = resample(id, grid);
    const unsure = [];
    const total = n * n;
    const outCells = Array.from({ length: n }, () => new Array(n).fill(-1));

    // 全盘亮度 Otsu 分「未翻开/已翻开」
    const lums = cells.map(c => c.meanLum);
    const sp = otsuSplit(lums);
    const separable = sp.sep > CFG.OTSUSPLIT_SEP_MIN && sp.nB > 0 && sp.nD > 0;

    let filled = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = cells[r * n + c];
        const px = Math.round(grid.x0 + c * grid.cellX);
        const py = Math.round(grid.y0 + r * grid.cellY);

        // 宝钻
        if (cell.orangeFrac > CFG.ORANGE_FRAC_MIN) { outCells[r][c] = 9; filled++; continue; }
        // 未翻开 = 亮蓝底（亮），已翻开 = 深色底（暗）；不满足可分条件时用绝对亮度兜底
        const isOpen = separable ? cell.meanLum < sp.thr : cell.meanLum < CFG.OPEN_LUM_FALLBACK;
        if (isOpen) {
          const gl = extractGlyph(id, px, py, Math.round(grid.cellX), Math.round(grid.cellY));
          if (gl) {
            const { d, conf } = ocrDigit(gl);
            const gate = separable ? CFG.DIGIT_GATE : CFG.DIGIT_GATE_HARD;
            if (conf >= gate) {
              outCells[r][c] = d; filled++;
              if (conf < 0.70) unsure.push([r, c]);
              continue;
            }
          }
          // 已翻开但数字没认出来 → 补一次更严格的 X 判定
          if (detectXMark(id, px, py, Math.round(grid.cellX), Math.round(grid.cellY), CFG.X_MINCOV_OPEN)) {
            outCells[r][c] = 10; filled++;
            continue;
          }
          // 已翻开但无内容：留空（"绝不误判"），明显有笔画的记入待核对
          if (gl) unsure.push([r, c]);
        } else {
          if (detectXMark(id, px, py, Math.round(grid.cellX), Math.round(grid.cellY), CFG.X_MINCOV)) {
            outCells[r][c] = 10; filled++;
          }
        }
      }
    }

    // 二次补空（只补空、不覆盖）
    const hitsFirst = filled;
    if (hitsFirst >= CFG.RETRY_HIT_MIN) {
      retryBlank(id, grid, outCells, unsure, cells, separable ? sp.thr : CFG.OPEN_LUM_FALLBACK);
      filled = outCells.flat().filter(v => v !== -1).length;
    }

    const thin = filled < Math.max(CFG.THIN_MIN, Math.round(total * CFG.THIN_RATIO)) || hitsFirst < 4;
    const done = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return {
      ok: true,
      rows: n, cols: n,
      cells: outCells,
      unsure,
      gemTotal: CFG.GEM_TOTAL[n] || 0,
      coverage: filled / total,
      reported: filled,
      total,
      note: `识别出 ${filled} 个已填格${unsure.length ? '，' + unsure.length + ' 处待核对' : ''}${grid.note ? '；' + grid.note : ''}`,
      badRows: 0,
      thin,
      model: 'local',
      usedBackup: false,
      elapsedMs: Math.round(done - t0),
      // 调试信息（不入契约，前端忽略）
      debug: { grid },
    };
  }

  function resample(id, grid) {
    const { n, cellX, cellY, x0, y0 } = grid;
    const L = lumMap(id);
    const out = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const px = Math.round(x0 + c * cellX), py = Math.round(y0 + r * cellY);
        out.push(cellStats(id, L, px, py, Math.round(cellX), Math.round(cellY)));
      }
    }
    return out;
  }

  // 补空：平移采样窗投票，只补空、不覆盖
  function retryBlank(id, grid, outCells, unsure, cells, openThr) {
    const { n, cellX, cellY, x0, y0 } = grid;
    const total = n * n;
    let blanks = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (outCells[r][c] === -1) blanks++;
    if (blanks < 1) return;
    const R = blanks > total * CFG.RETRY_R_SMALL_FRAC ? CFG.RETRY_R_SMALL : CFG.RETRY_R;
    const cw = Math.round(cellX), chh = Math.round(cellY);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (outCells[r][c] !== -1) continue;
        // 未翻开（亮蓝底）格子上只有 X 标记，绝不出数字——纹样容易被误读成 8/0
        const cell = cells && cells[r * n + c];
        const isOpen = cell ? cell.meanLum < openThr : true;
        const Rr = isOpen ? R : Math.min(R, CFG.RETRY_R_UNOPENED);
        const bx = Math.round(x0 + c * cellX), by = Math.round(y0 + r * cellY);
        const dVotes = {}, xVotes = { x: 0 };
        let pos = 0;
        for (let dy = -Rr; dy <= Rr; dy++) {
          for (let dx = -Rr; dx <= Rr; dx++) {
            const px = bx + dx, py = by + dy;
            if (px < 0 || py < 0 || px + cw >= id.width || py + chh >= id.height) continue;
            pos++;
            if (isOpen) {
              const gl = extractGlyph(id, px, py, cw, chh);
              if (gl) {
                const { d, conf } = ocrDigit(gl);
                if (conf >= CFG.DIGIT_GATE) dVotes[d] = (dVotes[d] || 0) + 1;
              }
            }
            if (detectXMark(id, px, py, cw, chh, CFG.X_MINCOV)) xVotes.x++;
          }
        }
        if (pos < CFG.RETRY_MIN_POS) continue;
        const entries = Object.entries(dVotes).map(([d, n2]) => ({ d: +d, n: n2 })).sort((a, b) => b.n - a.n);
        const bestD = entries[0] || { d: -1, n: 0 };
        const secondD = entries[1] ? entries[1].n : 0;
        if (bestD.n >= CFG.RETRY_VOTE_MIN && bestD.n >= pos * CFG.RETRY_VOTE_FRAC && bestD.n >= secondD * CFG.RETRY_VOTE_RATIO && bestD.n > xVotes.x) {
          outCells[r][c] = bestD.d;
        } else if (xVotes.x >= CFG.RETRY_VOTE_MIN && xVotes.x >= pos * CFG.RETRY_VOTE_FRAC) {
          outCells[r][c] = 10;
        }
      }
    }
  }

  return { CFG, configure, recognize, detectBoard, ocrDigit, extractGlyph, detectXMark, holesOf, _internal: { lumMap, safeScale, otsuSplit, buildTemplates } };
});
