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
    // 浅色主题/白底图里"已翻开格"是白或浅灰瓦片（亮、几乎无色）：亮蓝的未翻开格饱和度很高，
    // 所以用"够亮 + 低饱和"把白瓦片和亮蓝瓦片分开（否则白瓦片会被判成未翻开，数字全丢）
    OPEN_WHITE_LUM: 228,
    OPEN_WHITE_SAT: 0.12,
    SEAM_DARK: 62,              // 格缝（暗线）亮度上限
    SEAM_BRIGHT: 92,            // 格缝两侧"未翻开格"的最低亮度
    SEAM_MAXW: 0.35,            // 格缝最大宽度（相对格宽）
    ORANGE: { r: 165, g: 105, b: 125, rb: 65 },   // 宝钻橙色判据
    ORANGE_FRAC_MIN: 0.075,
    // 橙色复核下限：暗色/偏色皮肤下钻石的橙色占比会被压到 0.075 以下，
    // 落在 [0.03, 0.075) 且"已翻开却读不出内容"的格子按钻石收（见 §18.3 问题 B）
    ORANGE_FRAC_MIN_LOW: 0.03,
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
    // 匹配网格的四周留白（格数）：字形"按长边等比缩放 + 居中"后再留白，
    // 等效 MNIST 预处理；不让 1 被拉宽、8 被压扁，纹样也不会被拉伸成数字（§18.2 ③）
    FIT_MARGIN: 1,
    // 候选白名单（用宝钻/×/已翻开格当锚点收窄数字候选）总开关，排查时可关掉对比（§18.2 ①）
    WHITELIST: true,
    // 宝钻计数器里的"金色宝石图标"：色容差带比棋盘宝钻判据略宽（抗主题/亮度差异），
    // 形状闸用于和金色实心按钮（"切换"）区分（§18.2 ④）
    GEM_ICON: { r: 150, g: 95, b: 145, rb: 50 },
    GEM_ICON_FILL_MAX: 0.75,
    GEM_ICON_ASPECT: [0.7, 1.7],
    // 孔洞兜底（一个候选都没有、退回全字体参评）时不再直接采信的带孔数字（§18.3 问题 A）
    HOLE_DIGITS: [0, 4, 6, 8],
    TPL_FONTS: [
      'bold 46px Arial', 'bold 38px Arial', '46px Arial',
      'bold 46px Verdana', 'bold 46px Tahoma', 'bold 46px "Trebuchet MS"',
      'bold 46px "Segoe UI"', 'bold 46px "PingFang SC","Microsoft YaHei"',
      'bold 46px "DejaVu Sans"',
    ],
    X_LUM: 188, X_RGB_MIN: 158,
    X_FRAC_MIN: 0.025, X_FRAC_MAX: 0.42,
    X_SPAN_MIN: 0.50,
    // 浅蓝底上的白色 × 经过 JPEG/缩放后两条对角线会断开，0.62/0.75 会把整批 × 漏掉；仍由覆盖率、跨度和亮色像素占比三重门控防误判。
    X_MINCOV: 0.40,             // 未翻开分支
    X_MINCOV_OPEN: 0.40,        // 已翻开分支
    RETRY_R: 3, RETRY_R_SMALL: 2,
    RETRY_R_UNOPENED: 1,        // 未翻开格只需查 X 标记（纹样不参与数字投票），半径可小
    UPSCALE_BELOW: 62,          // 格宽小于此值（微信压缩图）先放大再读数
    UPSCALE_MAX: 2,             // 放大幅度上限
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

  // 等比缩放（k>1 为放大；小图增强用：微信二次压缩的截图格子只有 45px 左右，
  // 放大到 60px+ 再读数，阈值分割与字形 bbox 会稳很多）
  function scaleImage(id, k) {
    const { width: w, height: h } = id;
    const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
    const src = makeCanvas(w, h);
    src.getContext('2d').putImageData(id, 0, 0);
    const dst = makeCanvas(nw, nh);
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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

  // 枚举上下/左右亮带的所有配对，按"越接近正方形越靠前"排序。
  // 亮带可能多于 4 条（图缩小后上方两个 UI 面板的高光会连成长亮带），
  // 所以不能只认"最长的那两条"——交给调用方用暗缝间距/频谱去校验。
  function frameCandidates(fb) {
    const pairs = (arr) => {
      const s = arr.slice().sort((p, q) => p.mid - q.mid);
      const out = [];
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) out.push([s[i], s[j]]);
      return out;
    };
    const rp = pairs(fb.rows), cp = pairs(fb.cols);
    const cands = [];
    for (const r of rp) {
      const y0 = r[0].end + 0.5, y1 = r[1].start - 0.5;
      const h = y1 - y0;
      if (h <= 0) continue;
      for (const c of cp) {
        const x0 = c[0].end + 0.5, x1 = c[1].start - 0.5;
        const w = x1 - x0;
        if (w <= 0) continue;
        cands.push({ x0, y0, x1, y1, w, h,
          // 正方形程度为主，再加一点"越大越像棋盘"的弱先验（大矩形少，凑巧方的小矩形多）
          score: Math.abs(Math.log(w / h)) - 0.04 * Math.log(Math.min(w, h) / (0.5 * (w + h))) });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    return cands;
  }

  // 用外框亮边 + 亮蓝区域定出棋盘矩形（取亮带内缘 = 网格边界，扫描窗内缩后落在格内）
  // 返回"最像正方形"的那个候选；调用方再用频谱/暗缝校验（见 detectBoard*）
  function frameGrid(fb, bb, n) {
    const cands = frameCandidates(fb);
    if (!cands.length) return null;
    const hasB = bb && bb.rowStart >= 0 && bb.colStart >= 0;
    let best = cands[0], bestScore = cands[0].score + frameBlueBonus(cands[0], bb, hasB);
    for (let i = 1; i < Math.min(cands.length, 6); i++) {
      const s = cands[i].score + frameBlueBonus(cands[i], bb, hasB);
      if (s < bestScore) { bestScore = s; best = cands[i]; }
    }
    return { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1,
      cellX: best.w / n, cellY: best.h / n, skew: Math.abs(best.w - best.h) / Math.max(best.w, best.h) };
  }

  // 亮蓝落在矩形内的加权（软先验，仅微调排序：亮蓝带本身可能被上方 UI 面板污染）
  function frameBlueBonus(c, bb, hasB) {
    if (!hasB) return 0;
    let s = 0;
    const inRow = bb.rowStart > c.y0 && bb.rowEnd < c.y1;
    const inCol = bb.colStart > c.x0 && bb.colEnd < c.x1;
    if (inRow && inCol) s -= 0.02;
    else if (!inRow && !inCol) s += 0.02;
    return s;
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
      // 候选按"越接近正方形越靠前"逐个校验：矩形里收集到的暗缝，只有真档位才排得整齐
      // （落到格点上）——这是硬判据；光看亮带长短会被放缩后的 UI 面板高光骗到。
      // 先把装不下一整个棋盘的碎矩形滤掉（否则一堆 40×40 的凑巧正方形会排在前面）。
      const minSide = Pmin * 6;
      const cands = frameCandidates(fb0).filter((c) => c.w >= minSide && c.h >= minSide);
      for (let ci = 0, tried = 0; ci < cands.length && tried < 10; ci++) {
        const c = cands[ci];
        tried++;
        if (blueFracIn(id, c) < 0.15) continue;                  // 一点亮蓝都没有 → 不是棋盘
        const seamsX = collectSeams(L, W, H, c.x0, c.x1, c.y0, c.y1, true, rough);
        const seamsY = collectSeams(L, W, H, c.x0, c.x1, c.y0, c.y1, false, rough);
        const bx = bestNForAxis(seamsX, c.x0, c.w);
        const by = bestNForAxis(seamsY, c.y0, c.h);
        if (!bx || !by || bx.n !== by.n) continue;
        let n = bx.n;
        if (opts && opts.forceN) n = opts.forceN;
        const rx = refineFromSeams(seamsX, c.x0, c.w / n);
        const ry = refineFromSeams(seamsY, c.y0, c.h / n);
        const g = {
          x0: rx && Math.abs(rx.b - c.w / n) < 0.08 * c.w / n ? rx.a : c.x0,
          y0: ry && Math.abs(ry.b - c.h / n) < 0.08 * c.h / n ? ry.a : c.y0,
          cellX: rx && Math.abs(rx.b - c.w / n) < 0.08 * c.w / n ? rx.b : c.w / n,
          cellY: ry && Math.abs(ry.b - c.h / n) < 0.08 * c.h / n ? ry.b : c.h / n,
          n, src: 'frame', note: '',
        };
        if (g.cellX > Pmin && g.cellX < Pmax && g.cellY > Pmin && g.cellY < Pmax &&
            Math.abs(g.cellX - g.cellY) <= 0.12 * Math.max(g.cellX, g.cellY)) {
          grid = g;
          if (opts && opts.forceN) grid.src = 'force';
          break;
        }
      }
    } catch (e) { grid = null; }

    if (!grid) {
      grid = detectBoardSpectral(id, opts, L, W, H, Pmin, Pmax);
      // 频谱/蓝带回的网格再用暗缝精修一次（DFT 的格宽误差会累积到远端行）
      if (grid && grid.src !== 'manual') grid = polishGrid(L, W, H, grid, minWH * 0.075);
      return grid;
    }
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

  // 在 [lo, hi] 内均匀取 count 个采样位置（落在区间内部，避开边界）
  function samplePositions(lo, hi, count) {
    const out = [];
    if (hi <= lo) { out.push(Math.round((lo + hi) / 2)); return out; }
    const step = (hi - lo) / (count + 1);
    for (let i = 1; i <= count; i++) out.push(Math.round(lo + i * step));
    return out;
  }

  // 收集暗缝中心，按扫描线分组返回：真格线会在很多扫描线上重复出现，
  // 数字笔画/格子纹样造成的假缝只出现在个别扫描线上（后面用投票筛掉）
  function collectSeamsByLine(L, W, H, x0, x1, y0, y1, vertical, guess) {
    const maxw = Math.max(2, Math.round(guess * CFG.SEAM_MAXW));
    const sLo = Math.round(vertical ? y0 + guess * 0.2 : x0 + guess * 0.2);
    const sHi = Math.round(vertical ? y1 - guess * 0.2 : x1 - guess * 0.2);
    const from = Math.max(0, Math.round(vertical ? x0 : y0));
    const to = vertical ? Math.min(W - 1, Math.round(x1)) : Math.min(H - 1, Math.round(y1));
    const groups = [];
    for (const s of samplePositions(sLo, sHi, 12)) {
      const get = vertical ? (i) => L[s * W + i] : (i) => L[i * W + s];
      groups.push(seamCentersIn(get, from, to, maxw));
    }
    return groups;
  }

  // 多扫描线投票：只有被 ≥35% 扫描线命中的缝位才算真格线
  function consensusSeams(groups, tol) {
    const clusters = [];
    for (const g of groups) {
      for (const ctr of g) {
        let hit = null;
        for (const cl of clusters) if (Math.abs(cl.pos - ctr) <= tol) { hit = cl; break; }
        if (hit) { hit.sum += ctr; hit.n++; hit.pos = hit.sum / hit.n; }
        else clusters.push({ pos: ctr, sum: ctr, n: 1 });
      }
    }
    if (!groups.length) return [];
    const need = Math.max(2, Math.round(groups.length * 0.35));
    return clusters.filter((c) => c.n >= need).map((c) => c.pos).sort((a, b) => a - b);
  }

  // 收集暗缝中心（棋盘矩形内按扫描线收集并投票；只取两侧是亮区、宽度合理的暗线）
  function collectSeams(L, W, H, x0, x1, y0, y1, vertical, guess) {
    return consensusSeams(collectSeamsByLine(L, W, H, x0, x1, y0, y1, vertical, guess), Math.max(2, guess * 0.18));
  }

  // 该轴上哪个档位最贴合暗缝：把缝心投影到 [起点, 起点+边长] 的格点栅格，
  // 统计落在 ±0.18 格内的比例 —— 漏检/误检只影响个别点，真档位才对得齐。
  function bestNForAxis(seams, a0, span) {
    if (seams.length < 6) return null;
    let bestN = 0, bestFrac = 0;
    for (const n of CFG.N_CANDIDATES) {
      const pitch = span / n;
      let hit = 0;
      for (const s of seams) {
        const k = Math.round((s - a0) / pitch);
        if (Math.abs(s - (a0 + k * pitch)) <= pitch * 0.18) hit++;
      }
      const frac = hit / seams.length;
      if (frac > bestFrac + 0.02) { bestFrac = frac; bestN = n; }
    }
    return bestFrac >= 0.7 ? { n: bestN, frac: bestFrac } : null;
  }

  // 用对齐的缝心做最小二乘，精修 (起点, 格宽)：矩形内缘受高光/圆角影响有半像素级偏差，
  // 缝心拟合能把格宽误差压到 0.1px 量级（否则 12 行累计会切到邻格）
  function refineFromSeams(seams, a0, pitch) {
    const pts = [];
    for (const s of seams) {
      const k = Math.round((s - a0) / pitch);
      if (k >= 0 && k <= 64 && Math.abs(s - (a0 + k * pitch)) <= pitch * 0.25) pts.push([k, s]);
    }
    if (pts.length < 6) return null;
    let sk = 0, sp = 0, skk = 0, skp = 0;
    const N = pts.length;
    for (const [k, p] of pts) { sk += k; sp += p; skk += k * k; skp += k * p; }
    const den = N * skk - sk * sk;
    if (Math.abs(den) < 1e-6) return null;
    const b = (N * skp - sk * sp) / den;
    const a = (sp - b * sk) / N;
    if (!(b > 0)) return null;
    return { a, b };
  }

  // 给定网格，用暗缝精修起点/格宽（两轴各自独立；拟合离谱就保留原值）
  function polishGrid(L, W, H, g, guess) {
    const x1 = g.x0 + g.n * g.cellX, y1 = g.y0 + g.n * g.cellY;
    const seamsX = collectSeams(L, W, H, g.x0, x1, g.y0, y1, true, guess || g.cellX);
    const seamsY = collectSeams(L, W, H, g.x0, x1, g.y0, y1, false, guess || g.cellY);
    const rx = refineFromSeams(seamsX, g.x0, g.cellX);
    const ry = refineFromSeams(seamsY, g.y0, g.cellY);
    const out = { x0: g.x0, y0: g.y0, cellX: g.cellX, cellY: g.cellY, n: g.n, src: g.src, note: g.note };
    if (rx && Math.abs(rx.b - g.cellX) < 0.08 * g.cellX) { out.x0 = rx.a; out.cellX = rx.b; }
    if (ry && Math.abs(ry.b - g.cellY) < 0.08 * g.cellY) { out.y0 = ry.a; out.cellY = ry.b; }
    return out;
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
      // 与频谱估计相差 20% 以内，且格子必须是正方形（否则说明亮带配错了对，宁可用下面的蓝带吸附）
      if (fg && fg.skew <= 0.10 &&
          fg.cellX > cellX * 0.8 && fg.cellX < cellX * 1.25 &&
          fg.cellY > cellY * 0.8 && fg.cellY < cellY * 1.25) {
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
    // 底色亮度 bgLum：数字/钻石在格子中央、× 是两条对角线，
    // 所以采样点取"靠边但避开两条对角线"的 8 个位置，再取中位数（个别点压到笔画也不怕）。
    // 未翻开=亮蓝底（≈110-130）、已翻开=深底（≈60-80），用它做分组的阈值比整格平均稳得多
    // （整格平均会被大号白字/钻石抬高，把亮蓝格误判成已翻开）。
    const offs = [[0.42, 0.18], [0.42, 0.82], [0.58, 0.18], [0.58, 0.82],
                  [0.18, 0.42], [0.82, 0.42], [0.18, 0.58], [0.82, 0.58]];
    const vals = [];
    const sats = [];
    for (const [fx, fy] of offs) {
      const sx = Math.round(cx + cw * fx), sy = Math.round(cy + ch * fy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const p = (sy * W + sx) * 4;
      const R = data[p], G = data[p + 1], B = data[p + 2];
      vals.push(0.299 * R + 0.587 * G + 0.114 * B);
      const hi = Math.max(R, G, B);
      sats.push(hi ? (hi - Math.min(R, G, B)) / hi : 0);   // 饱和度：0=灰/白，越高越"有色"
    }
    // 取中位数那一处采样点（亮度/饱和度必须是同一块底色的，否则互相打架）
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const med = order.length ? order[order.length >> 1] : -1;
    const bgLum = med >= 0 ? vals[med] : 0;
    const bgSat = med >= 0 ? sats[med] : 0;
    return { meanLum: n ? sum / n : 0, bgLum, bgSat, orangeFrac: total ? orange / total : 0, mn, mx, n };
  }

  // 判"已翻开"：① 深色底（游戏盘面 / 深色主题素材瓦片）② 够亮且几乎无色的白瓦片（浅色主题）
  // 亮蓝的未翻开格饱和度很高，被 ② 的条件挡住
  function isOpenBg(lum, sat, thr) {
    if (lum < thr) return true;
    return lum >= CFG.OPEN_WHITE_LUM && sat <= CFG.OPEN_WHITE_SAT;
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
        g16.push(normGridFit(gg, CFG.GW, CFG.GH));
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

  // 归一化到 GW×GH（保形版）：按长边等比缩放后居中，四周各留 FIT_MARGIN 格空白。
  // 与 normGrid 的区别：不拉伸字形（1 不会被压成方块、正方形纹样不会被拉成长条），
  // 模板与待测字形都用它，形近数字（3↔8、5↔6）和纹样的区分度更高（§18.2 ③）
  function normGridFit(gl, GW, GH) {
    const m = Math.max(0, Math.min(CFG.FIT_MARGIN | 0, (Math.min(GW, GH) - 2) >> 1));
    const aw = Math.max(1, GW - 2 * m), ah = Math.max(1, GH - 2 * m);
    const k = Math.min(aw / gl.bw, ah / gl.bh);
    const tw = gl.bw * k, th = gl.bh * k;
    const ox = (GW - tw) / 2, oy = (GH - th) / 2;
    const g = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const x0 = Math.max(0, Math.floor((gx - ox) / k)), x1 = Math.min(gl.bw, Math.ceil((gx + 1 - ox) / k));
        const y0 = Math.max(0, Math.floor((gy - oy) / k)), y1 = Math.min(gl.bh, Math.ceil((gy + 1 - oy) / k));
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gl.bin[y * gl.bw + x]; n++; }
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
  function extractGlyph(id, x0, y0, w, h, darkInk) {
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

    const main = buildGlyph(id, cx, cy, cw, chh, thr, !!darkInk, CFG.GLYPH_BBOX_MAXFRAC);
    if (main) return { ...main, channel: 'main' };
    // 降级通道：浅灰笔画数字（同样按底色决定是"暗笔画"还是"亮笔画"）
    const fb = buildGlyph(id, cx, cy, cw, chh, mn + CFG.GLYPH_FALLBACK_TH_ADD * span, !!darkInk, CFG.GLYPH_BBOX_MAXFRAC_FB);
    if (fb) return { ...fb, channel: 'fallback' };
    // 白底图里也可能是亮色数字（深色主题素材贴到白瓦片上）：反过来再试一次
    if (darkInk) {
      const alt = buildGlyph(id, cx, cy, cw, chh, thr, false, CFG.GLYPH_BBOX_MAXFRAC);
      if (alt) return { ...alt, channel: 'main' };
    }    return null;
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
  // allowed（可选）：候选白名单（数字数组）。给了就只在白名单内取最优，
  // 并在返回值里带上"全候选最优"（dAll/eAll）供调用方判断是否改判/降级（§18.2 ①）
  function ocrDigit(gl, allowed) {
    const T = buildTemplates();
    const g16 = normGridFit(gl, CFG.GW, CFG.GH);
    const obsHoles = holesOf(gl, CFG.FW, CFG.FH);
    const N = g16.length;
    const errOf = (t) => { let e = 0; for (let i = 0; i < g16.length; i++) { const d = g16[i] - t[i]; e += d * d; } return e; };
    const ok = allowed && allowed.length ? (d) => allowed.indexOf(d) >= 0 : () => true;
    const errs = [];
    for (let i = 0; i < T.g16.length; i++) {
      if (T.holes[i] !== obsHoles || !ok(i % 9)) continue;
      errs.push({ d: i % 9, e: errOf(T.g16[i]) });
    }
    let holesOk = errs.length > 0;
    if (!holesOk) {
      for (let i = 0; i < T.g16.length; i++) {
        if (!ok(i % 9)) continue;
        errs.push({ d: i % 9, e: errOf(T.g16[i]) });
      }
    }
    if (!errs.length) return { d: -1, conf: 0, holesOk: false, dAll: -1, eAll: Infinity };
    errs.sort((a, b) => a.e - b.e);
    const best = errs[0];
    let second = 1e9;
    for (const e of errs) if (e.d !== best.d) { second = e.e; break; }
    let conf = 1 - best.e / N;
    conf *= Math.min(1, (second - best.e) / N * 4 + 0.5);
    if (!holesOk) conf *= 0.85;
    // 无约束的最优（用于"读数与盘面约束冲突"的判定；只在真的收窄过候选时才算）
    let dAll = best.d, eAll = best.e;
    if (allowed && allowed.length) {
      let bestAll = Infinity;
      for (let i = 0; i < T.g16.length; i++) {
        if (T.holes[i] !== obsHoles) continue;
        const e = errOf(T.g16[i]);
        if (e < bestAll) { bestAll = e; dAll = i % 9; }
      }
      if (!isFinite(bestAll)) {
        bestAll = Infinity;
        for (let i = 0; i < T.g16.length; i++) {
          const e = errOf(T.g16[i]);
          if (e < bestAll) { bestAll = e; dAll = i % 9; }
        }
      }
      eAll = bestAll;
    }
    return { d: best.d, conf, holesOk, topErr: best.e, dAll, eAll };
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

  // 金色宝石图标定位：颜色容差带 + 连通域 + 形状筛选（§18.2 ④）
  // 返回靠左、且右边确实跟着白字（计数器）的那个图标；找不到返回 null
  function findGemIcon(id, grid, yA, yB, isInk) {
    const { width: W } = id, d = id.data;
    const G = CFG.GEM_ICON;
    const isGold = (x, y) => {
      const p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      return r > G.r && g > G.g && b < G.b && r - b > G.rb;
    };
    const h = yB - yA;
    const seen = new Uint8Array(W * h);
    const cellX = grid.cellX, cellY = grid.cellY;
    const cand = [];
    for (let y = yA; y < yB; y++) {
      for (let x = 0; x < W; x++) {
        const k = (y - yA) * W + x;
        if (seen[k] || !isGold(x, y)) continue;
        let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
        const st = [k]; seen[k] = 1;
        while (st.length) {
          const i2 = st.pop(), yy = yA + ((i2 / W) | 0), xx = i2 % W;
          n++;
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = xx + dx, ny = yy + dy;
              if (nx < 0 || ny < yA || nx >= W || ny >= yB) continue;
              const k2 = (ny - yA) * W + nx;
              if (!seen[k2] && isGold(nx, ny)) { seen[k2] = 1; st.push(k2); }
            }
          }
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const fill = n / (bw * bh), aspect = bw / bh;
        // 形状闸：实心大按钮（切换）填充率 ≈0.9、宽高比 ≈1.9，都被挡在外面
        if (bh < cellY * 0.25 || bh > cellY * 1.3) continue;
        if (bw < cellX * 0.25 || bw > cellX * 1.4) continue;
        if (fill > CFG.GEM_ICON_FILL_MAX) continue;
        if (aspect < CFG.GEM_ICON_ASPECT[0] || aspect > CFG.GEM_ICON_ASPECT[1]) continue;
        cand.push({ x0, x1, y0, y1, h: bh });
      }
    }
    cand.sort((a, b) => a.x0 - b.x0);
    // 图标右边要真的有白字（一两百个墨迹点）才算数，免得把别的金色装饰当锚点
    for (const c of cand) {
      const xLo = c.x1 + 1, xHi = Math.min(W - 1, c.x1 + Math.round(c.h * 9));
      const yMid = (c.y0 + c.y1) / 2, yTol = c.h * 0.75;
      let ink = 0;
      for (let y = Math.max(yA, Math.round(yMid - yTol)); y < Math.min(yB, Math.round(yMid + yTol)); y++) {
        for (let x = xLo; x <= xHi; x++) if (isInk(x, y)) ink++;
      }
      if (ink >= 200) return c;
    }
    return null;
  }

  /* ---------- 宝钻计数器（棋盘上方"剩余/总数"徽章，辅助交叉验证） ---------- */
  // 读"💎 22/45"。只在"总数 == 本尺寸标准总数（20/30/45）"且两个数自洽时才采信 ——
  // 计数器一旦读错会把"钻石总数"带偏（错的总数会推出错误结论），宁可不采信。
  function detectGemCounter(id, grid) {
    const { width: W, height: H } = id;
    const yA = Math.max(0, Math.round(grid.y0 - 0.082 * H));
    const yB = Math.max(0, Math.round(grid.y0 - 0.012 * H));
    if (yB - yA < 12) return null;
    const d = id.data;
    const isInk = (x, y) => {
      const p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      return r > 140 && g > 140 && b > 140;      // 白字（面板边框是青色、宝石是橙色，都被这条排除）
    };
    const colInk = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = yA; y < yB; y++) if (isInk(x, y)) n++;
      colInk[x] = n;
    }
    // 墨迹列 → 连续段（允许 2px 小缝）
    const runs = [];
    let s = -1, gap = 0;
    for (let x = 0; x < W; x++) {
      if (colInk[x] > 0) { if (s < 0) s = x; gap = 0; }
      else if (s >= 0) {
        gap++;
        if (gap > 2) { const e = x - gap; if (e - s >= 3) runs.push([s, e]); s = -1; gap = 0; }
      }
    }
    if (s >= 0 && W - 1 - s >= 3) runs.push([s, W - 1]);
    if (runs.length < 2) return null;
    // 段高度（同一带里所有白字高度接近；用整带的行范围做上限）
    const boxOf = (r) => {
      let mnY = yB, mxY = yA - 1;
      for (let x = r[0]; x <= r[1]; x++) {
        for (let y = yA; y < yB; y++) {
          if (isInk(x, y)) { if (y < mnY) mnY = y; if (y > mxY) mxY = y; }
        }
      }
      return { x0: r[0], x1: r[1], y0: mnY, y1: mxY, w: r[1] - r[0] + 1, h: mxY - mnY + 1 };
    };
    const boxesAll = runs.map(boxOf).filter((b) => b.h >= 8);
    if (boxesAll.length < 2) return null;
    // ---- 金色宝石图标当锚点（§18.2 ④）----
    // 颜色容差带 + 连通域找图标，再只读它右边的白字：
    // 同一带里还有"地图：38（12×12）"的白字和金色"切换"按钮，
    // 靠形状分辨（图标是多面体，填充率低、宽高比≈1；按钮是实心矩形，填充率≈0.9、宽高比≈1.9）。
    // 找不到图标就退回"整条带 + 斜杠"老路径。
    const icon = findGemIcon(id, grid, yA, yB, isInk);
    let boxes = boxesAll, anchored = false;
    if (icon) {
      const xLo = icon.x1 + 1, xHi = icon.x1 + Math.max(4, Math.round(icon.h * 9));
      const yMid = (icon.y0 + icon.y1) / 2, yTol = icon.h * 0.75;
      const near = boxesAll.filter((b) => b.x0 >= xLo && b.x1 <= xHi && Math.abs((b.y0 + b.y1) / 2 - yMid) <= yTol);
      if (near.length >= 2) { boxes = near; anchored = true; }
    }
    if (boxes.length < 2) return null;
    const medH = boxes.map((b) => b.h).sort((a, b) => a - b)[(boxes.length / 2) | 0];
    // 斜杠：比数字窄、高度接近，且左右紧邻的都是"同高的数字块" ——
    // 用邻居高度兜住，免得把别的 UI 里的小图标（也可能是窄条）当成斜杠。
    let slash = -1, slashScore = Infinity;
    for (let i = 1; i < boxes.length - 1; i++) {
      const b = boxes[i];
      if (b.h < medH * 0.7 || b.w > 0.62 * medH) continue;
      const a = boxes[i - 1], c = boxes[i + 1];
      if (b.x0 - a.x1 > medH * 0.45 || c.x0 - b.x1 > medH * 0.45) continue;
      if (Math.abs(a.h - b.h) > b.h * 0.3 || Math.abs(c.h - b.h) > b.h * 0.3) continue;
      const score = Math.abs(a.h - b.h) + Math.abs(c.h - b.h) + (b.w / medH);
      if (score < slashScore) { slashScore = score; slash = i; }
    }
    if (slash <= 0 || slash >= boxes.length - 1) return null;
    // 左/右各取紧邻斜杠的那一"组"数字（可能被 2px 小缝拆成多段 → 按间距合并）
    const groupOf = (idx, dir) => {
      const group = [boxes[idx]];
      let cur = boxes[idx];
      for (let i = idx + dir; i >= 0 && i < boxes.length; i += dir) {
        const b = boxes[i];
        const gapPx = dir < 0 ? cur.x0 - b.x1 : b.x0 - cur.x1;
        if (gapPx > medH * 0.42) break;                 // 间距过大 = 另一个东西（星形/宝石）
        group.push(b);
        cur = b;
      }
      return group;
    };
    const readGroup = (group) => {
      const x0 = Math.min(...group.map((b) => b.x0)), x1 = Math.max(...group.map((b) => b.x1));
      const y0 = Math.min(...group.map((b) => b.y0)), y1 = Math.max(...group.map((b) => b.y1));
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (h < 8) return null;
      // 数字个数 = 宽度 / 单字宽（数字宽高比约 0.55~0.75）
      const cnt = Math.max(1, Math.min(3, Math.round(w / (h * 0.66))));
      const cwEach = w / cnt;
      let num = '';
      for (let k = 0; k < cnt; k++) {
        const cx0 = Math.round(x0 + k * cwEach), cx1 = Math.round(x0 + (k + 1) * cwEach) - 1;
        const gl = glyphOfThreshold(id, cx0, y0, cx1 - cx0 + 1, h, 170);
        if (!gl) return null;
        const { d: dg, conf, holesOk } = ocrDigit(gl);
        if (conf < 0.72) return null;
        // 孔洞兜底读出的带孔数字不采信（同 §18.3 问题 A：宁可当没读到）
        if (holesOk === false && CFG.HOLE_DIGITS.indexOf(dg) >= 0) return null;
        num += String(dg);
      }
      return { num: Number(num), conf: 0.8 };
    };
    const left = readGroup(groupOf(slash - 1, -1).slice().reverse());
    const right = readGroup(groupOf(slash + 1, 1));
    if (!left || !right) return null;
    // 格式/数量校验（§18.2 ⑥）：两个数都必须读全，且"已收集 ≤ 总数"、总数在标准档位内；
    // 任何一条不成立就当没读到（计数器读错会把钻石总数带偏，宁可不采信）
    const std = CFG.GEM_TOTAL[grid.n] || 0;
    if (!Number.isFinite(left.num) || !Number.isFinite(right.num)) return null;
    if (left.num < 0 || left.num > right.num) return null;
    if (std && right.num !== std) return null;
    return { left: left.num, right: right.num, box: boxes[slash], anchored };
  }

  // 用给定阈值从指定区域抽字形（计数器是纯白字，Otsu 反而会被面板渐变带偏）
  function glyphOfThreshold(id, x0, y0, w, h, thr) {
    if (w < 3 || h < 5) return null;
    return glyphOf(id, x0, y0, w, h, thr);
  }

  /* ---------- 盘面约束（候选白名单，§18.2 ①） ---------- */
  // 只用三类高可靠锚点：橙色宝钻（已知钻石）、玩家 ×（确定没钻石）、已翻开的格子（不可能是钻石）。
  // 数字读数不参与当锚点——它正是被复核的对象。
  // 返回 limits[i] = [lo, hi]：该格数字的可行区间（只对已翻开格有意义）
  function buildConstraintMap(outCells, openFlag, n, gemTotal) {
    const total = n * n;
    const gem = new Uint8Array(total), safe = new Uint8Array(total);
    let gemCount = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c, v = outCells[r][c];
        if (v === 9) { gem[i] = 1; gemCount++; }
        else if (v === 10) safe[i] = 1;
        else if (openFlag[i]) safe[i] = 1;
      }
    }
    let possible = 0;                      // 还能放钻石的格子（未翻开、未标 ×、未确定是钻石）
    for (let i = 0; i < total; i++) if (!gem[i] && !safe[i]) possible++;
    const remaining = Math.max(0, (gemTotal || 0) - gemCount);
    // 锚点自相矛盾（钻石数对不上候选格数）时整盘放弃收窄，交给求解器报矛盾
    const consistent = gemTotal > 0 && remaining <= possible;
    const limits = new Array(total).fill(null);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (!openFlag[i]) continue;
        let gAdj = 0, hid = 0;
        for (let rr = Math.max(0, r - 1); rr <= Math.min(n - 1, r + 1); rr++) {
          for (let cc = Math.max(0, c - 1); cc <= Math.min(n - 1, c + 1); cc++) {
            if (rr === r && cc === c) continue;
            const j = rr * n + cc;
            if (gem[j]) gAdj++;
            else if (!safe[j]) hid++;
          }
        }
        // 邻域外的候选格放不下的钻石（鸽笼）必须落进邻域 → lo；
        // 邻域候选格与剩余钻石取小 → hi
        const lo = gAdj + Math.max(0, remaining - (possible - hid));
        const hi = gAdj + Math.min(hid, remaining);
        limits[i] = [lo, hi];
      }
    }
    return { ok: consistent && CFG.WHITELIST !== false, limits, gemCount, remaining, possible };
  }

  /* ---------- 全盘识别流程 ---------- */
  // 旋转图像（deg = 0/90/180/270，顺时针）
  function rotateImageData(id, deg) {
    if (!deg) return id;
    const { width: w, height: h } = id;
    const dst = (deg === 180) ? makeCanvas(w, h) : makeCanvas(h, w);
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    const src = makeCanvas(w, h);
    src.getContext('2d').putImageData(id, 0, 0);
    ctx.translate(dst.width / 2, dst.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(src, -w / 2, -h / 2);
    return ctx.getImageData(0, 0, dst.width, dst.height);
  }

  /* 自动旋转：平板斜拍 / 相册把截图转了 90° 时也能认。
     顺序 0° → 90° → 180° → 270°，读到"像样的盘面"就停：
       · 像样 = 读出 ≥6 个数字，且"已翻开却读不出内容"的格子很少（正确方向下每个已翻开格都有数字/钻石/×）；
         —— 只数"读出多少格"不够：盘面转 90° 时钻石/×/未翻开格照样能认（它们不依赖方向），
            光看格数会把歪着的读数当成好结果（实测：横着读也能写 42 格，但数字只有个位数）。
         —— 所以打分里数字权重最高：dig*3 + gem + x。
     返回的所有坐标/图像都在「识别成功的那一版」坐标系里（image 字段），前端预览直接用不会错位。 */
  function statOf(r) {
    let dig = 0, gem = 0, x = 0;
    for (const row of r.cells) {
      for (const v of row) {
        if (v === 9) gem++;
        else if (v === 10) x++;
        else if (typeof v === 'number' && v >= 0) dig++;
      }
    }
    return { dig, gem, x };
  }
  function orientScore(r) {
    const s = statOf(r);
    return s.dig * 3 + s.gem + s.x - (r.thin ? 10 : 0);
  }
  function orientSolid(r) {
    const s = statOf(r);
    // 整盘没翻开（新图/开局）：内容不区分方向，第一版就采信，不白跑另外三个方向
    if (!r.openedCount && !s.gem && !s.x) return true;
    // openedCount 只统计"被判为已翻开、送去读数字"的格子（钻石/× 不在其中），
    // 所以正确方向下 dig 应当基本等于 openedCount；歪着读时钻石/× 照样能认、
    // 数字却读不出来（实测：横着读 41 个已翻开格只读出 8 个数字）。
    const need = Math.max(3, Math.round((r.openedCount || 0) * 0.8));
    return s.dig >= need;
  }
  function tryOrient(raw, deg, opts) {
    const img = deg ? rotateImageData(raw, deg) : raw;
    const r = recognizeOnce(img, opts);
    const score = orientScore(r);
    return { deg, r, score, img, solid: orientSolid(r) };
  }

  function recognize(input, opts) {
    opts = opts || {};
    if (opts.grid) return recognizeOnce(input, opts);   // 手动微调路径：网格已定，不再试探方向
    const raw = toImageData(input);
    let first = null, solidBest = null;
    for (const deg of [0, 90, 180, 270]) {
      if (solidBest) break;                              // 正立截图第一次就中：先判再算，别白跑 90°
      try {
        const t = tryOrient(raw, deg, opts);
        if (t.solid) solidBest = t;                      // 找到"像样的盘面"就定下来
        else if (!first) first = t;                       // 都不像样时保留原方向（deg=0 那版）
      } catch (e) { /* 这个方向不行，继续 */ }
    }
    const best = solidBest || first;
    if (!best || !best.r) {
      const e = new Error('未能自动识别棋盘（四个方向都试过了），请手动调整或改用服务器识别');
      e.code = 'NO_BOARD';
      throw e;
    }
    const r = best.r;
    r.image = best.img;                                  // 识别实际用的那一版图（可能已旋转）
    if (best.deg) {
      r.rotation = best.deg;
      r.note = (r.note ? r.note + '；' : '') + `已按旋转 ${best.deg}° 识别`;
    }
    return r;
  }

  function recognizeOnce(input, opts) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    opts = opts || {};
    const raw = toImageData(input);
    let id = safeScale(raw);
    let sc = id.width / raw.width;      // 输入图 → 工作图的缩放比（>1 只可能来自下面的小图增强）

    let grid = detectBoard(id, opts);
    if (!grid) {
      const e = new Error('未能自动识别棋盘，请手动调整或改用服务器识别');
      e.code = 'NO_BOARD';
      throw e;
    }
    // 手动微调路径：调用方给的网格是"输入图坐标"，换算到工作图
    if (opts.grid) {
      const g = opts.grid;
      grid = { x0: g.x0 * sc, y0: g.y0 * sc, cellX: g.cellX * sc, cellY: g.cellY * sc, n: g.n, src: 'manual', note: '' };
    } else if (grid.cellX < CFG.UPSCALE_BELOW) {
      // 小图增强：格子小于 ~60px 时（微信二次压缩的截图）放大后读数更稳
      const k = Math.min(CFG.UPSCALE_MAX, CFG.UPSCALE_BELOW / grid.cellX);
      if (id.width * id.height * k * k <= CFG.MAX_PIXELS) {
        const up = scaleImage(id, k);
        grid = { x0: grid.x0 * k, y0: grid.y0 * k, cellX: grid.cellX * k, cellY: grid.cellY * k, n: grid.n, src: grid.src, note: grid.note };
        id = up;
        sc *= k;
      }
    }
    const { n } = grid;
    const gridIn = { x0: grid.x0 / sc, y0: grid.y0 / sc, cellX: grid.cellX / sc, cellY: grid.cellY / sc, n, src: grid.src, note: grid.note };   // 报给外部的始终是输入图坐标
    // 尺寸文字交叉验证（只记入 note）
    const textN = detectMapSizeText(lumMap(id), id.width, id.height, grid);
    if (textN && textN !== n) gridIn.note = `另有线索指向 ${textN}×${textN}，已按格子周期取 ${n}×${n}`;
    // 宝钻计数器（辅助线索）：总数必须等于本尺寸标准总数才采信（防误读带偏总数推断）
    let gemCounter = null, gemAnchored = null;
    try {
      const gc = detectGemCounter(id, grid);
      if (gc) gemAnchored = !!gc.anchored;
      if (gc && gc.right === (CFG.GEM_TOTAL[n] || 0) && gc.left >= 0 && gc.left <= gc.right) {
        gemCounter = { left: gc.left, right: gc.right };
      }
    } catch (e) { gemCounter = null; }

    const cells = resample(id, grid);
    const unsure = [];
    const total = n * n;
    const outCells = Array.from({ length: n }, () => new Array(n).fill(-1));

    // 全盘"底色亮度" Otsu 分「未翻开/已翻开」：
    // 用四角底色而不是整格平均——整格平均会因为"白字/钻石格"很亮而把阈值抬高，
    // 把亮蓝的未翻开格误判成已翻开（实测会把纹样认成 8）。
    const lums = cells.map(c => (c.bgLum != null ? c.bgLum : c.meanLum));
    const sp = otsuSplit(lums);
    const separable = sp.sep > CFG.OTSUSPLIT_SEP_MIN && sp.nB > 0 && sp.nD > 0;

    let filled = 0, openedCount = 0;
    const openFlag = new Uint8Array(total);        // 判为"已翻开"的格子（不可能是钻石，供白名单当锚点）
    const reads = new Array(total).fill(null);     // 已翻开格的字形与读数（供白名单复核，§18.2 ①）
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const cell = cells[i];
        const px = Math.round(grid.x0 + c * grid.cellX);
        const py = Math.round(grid.y0 + r * grid.cellY);
        const cw = Math.round(grid.cellX), chh = Math.round(grid.cellY);

        // 宝钻
        if (cell.orangeFrac > CFG.ORANGE_FRAC_MIN) { outCells[r][c] = 9; filled++; continue; }
        // 未翻开 = 亮蓝底（亮），已翻开 = 深色底（暗）；不满足可分条件时用绝对亮度兜底
        // 注意：阈值 sp.thr 是用 bgLum 分的组，这里也必须拿 bgLum 比（量纲一致）
        const bgLum = cell.bgLum != null ? cell.bgLum : cell.meanLum;
        const bgSat = cell.bgSat != null ? cell.bgSat : 0;
        const isOpen = isOpenBg(bgLum, bgSat, separable ? sp.thr : CFG.OPEN_LUM_FALLBACK);
        if (isOpen) { openedCount++; openFlag[i] = 1; }
        if (isOpen) {
          // 白瓦片（浅色主题）上是深色笔画，用暗笔画通道提字形；深底用原来的亮笔画通道
          const gl = extractGlyph(id, px, py, cw, chh, bgLum >= CFG.OPEN_WHITE_LUM);
          if (gl) {
            const res = ocrDigit(gl);
            reads[i] = { gl, d: res.d, conf: res.conf, holesOk: res.holesOk };
            const gate = separable ? CFG.DIGIT_GATE : CFG.DIGIT_GATE_HARD;
            // 孔洞拓扑都筛不出候选（退回全字体参评）时读出的带孔数字不再直接采信 ——
            // 这时纹样/图案最容易被读成 8（§18.3 问题 A），宁可红框不硬写
            const suspectHole = res.holesOk === false && CFG.HOLE_DIGITS.indexOf(res.d) >= 0;
            if (res.conf >= gate && !suspectHole) {
              // 暗色/偏色钻石可能被读成数字：只有把握不足（<0.70）时才让位给低阈值橙色复核
              if (res.conf < 0.70 && cell.orangeFrac > CFG.ORANGE_FRAC_MIN_LOW) {
                outCells[r][c] = 9; filled++;
                continue;
              }
              outCells[r][c] = res.d; filled++;
              if (res.conf < 0.70) unsure.push([r, c]);
              continue;
            }
          }
          // 已翻开但数字没认出来 → 补一次更严格的 X 判定
          if (detectXMark(id, px, py, cw, chh, CFG.X_MINCOV_OPEN)) {
            outCells[r][c] = 10; filled++;
            continue;
          }
          // 低阈值橙色复核：暗色/偏色钻石的 orangeFrac 会掉到 0.075 以下，
          // "已翻开却读不出内容"时按钻石收，不再塞进待核对红框（§18.3 问题 B）
          if (cell.orangeFrac > CFG.ORANGE_FRAC_MIN_LOW) { outCells[r][c] = 9; filled++; continue; }
          // 已翻开但无内容：留空（"绝不误判"），明显有笔画的记入待核对
          if (gl) unsure.push([r, c]);
        } else {
          if (detectXMark(id, px, py, cw, chh, CFG.X_MINCOV)) {
            outCells[r][c] = 10; filled++;
          }
        }
      }
    }

    // ---------- 候选白名单：用盘面约束收窄数字候选（§18.2 ① / §18.3 问题 A）----------
    // 锚点只用高可靠信息：橙色宝钻、玩家 ×、已翻开的格子（不可能是钻石）。
    // 某格数字 v = 周围 8 格的钻石数，所以 v ∈ [lo, hi]：
    //   lo = 邻域已知钻石 + 必须落在邻域内的剩余钻石；hi = 邻域已知钻石 + 邻域候选格数
    // "剩余总数"参与上/下界（这就是"识别 + 求解器"闭环，survivor 站没有求解器做不到）。
    // 与约束冲突的读数 → 收窄候选重读（改判）；重读不成立 → 按单点约束改判或降级留空；
    // 改判/降级/保留冲突都记入待核对（红框）+ debug.constrained，绝不静默改盘面。
    const wl = buildConstraintMap(outCells, openFlag, n, CFG.GEM_TOTAL[n] || 0);
    const constrained = [];
    const markCells = new Set();
    const flag = (r, c, info) => {
      const k = r * n + c;
      if (!markCells.has(k)) { markCells.add(k); unsure.push([r, c]); }
      constrained.push({ r, c, ...info });
    };
    if (wl.ok) {
      const gate = separable ? CFG.DIGIT_GATE : CFG.DIGIT_GATE_HARD;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const i = r * n + c, rd = reads[i];
          const v = outCells[r][c];
          if (!rd || rd.d < 0 || typeof v !== 'number' || v < 0 || v > 8) continue;
          const lim = wl.limits[i];
          if (!lim) continue;
          const lo = lim[0], hi = lim[1];
          if (rd.d >= lo && rd.d <= hi) continue;         // 读数与盘面一致 → 不动
          const allowed = [];
          for (let d = lo; d <= hi; d++) allowed.push(d);
          const res = ocrDigit(rd.gl, allowed);
          // 改判：收窄后重读出的数字要既过门限、又不比"冲突值"更差（topErr ≤ eAll）
          if (res.d >= 0 && res.d !== rd.d && res.conf >= gate && res.topErr <= res.eAll) {
            outCells[r][c] = res.d;
            flag(r, c, { from: v, to: res.d, kind: 'rejudge', lo, hi });
          } else if (lo === hi && lo !== v) {
            outCells[r][c] = lo;                          // 约束只有一个取值 → 按约束改判
            flag(r, c, { from: v, to: lo, kind: 'forced', lo, hi });
          } else if (rd.conf < CFG.DIGIT_GATE_HARD) {
            outCells[r][c] = -1;                          // 弱置信 + 冲突 → 降级留空（宁可留空）
            flag(r, c, { from: v, to: -1, kind: 'drop', lo, hi });
          } else {
            flag(r, c, { from: v, to: v, kind: 'keep', lo, hi });   // 高置信冲突：保留但标红（可能是锚点错）
          }
        }
      }
      filled = outCells.flat().filter(v => v !== -1).length;
    }

    // 二次补空（只补空、不覆盖；投票同样受白名单约束）
    const hitsFirst = filled;
    if (hitsFirst >= CFG.RETRY_HIT_MIN) {
      retryBlank(id, grid, outCells, unsure, cells, separable ? sp.thr : CFG.OPEN_LUM_FALLBACK, wl);
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
      gemCounter,          // 截图里读到的"剩余/总数"（校验通过才有；不参与判定，仅供前端参考）
      coverage: filled / total,
      reported: filled,
      total,
      note: `识别出 ${filled} 个已填格${unsure.length ? '，' + unsure.length + ' 处待核对' : ''}${constrained.length ? '，' + constrained.length + ' 处按盘面约束复核' : ''}${gridIn.note ? '；' + gridIn.note : ''}`,
      badRows: 0,
      thin,
      openedCount,          // 判为"已翻开"的格子数
      unopened: openedCount <= 1 && filled === 0,   // 整盘都没翻开（新图）：不是识别失败
      model: 'local',
      usedBackup: false,
      elapsedMs: Math.round(done - t0),
      // 调试信息（不入契约，前端忽略）
      debug: { grid: gridIn, scale: sc, gemCounter, gemAnchored, constrained, whitelist: wl.ok ? { gemCount: wl.gemCount, remaining: wl.remaining, possible: wl.possible } : null },
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
  // wl（可选）：盘面约束白名单 —— 只给"盘面上可能取的值"投票（§18.2 ①）
  function retryBlank(id, grid, outCells, unsure, cells, openThr, wl) {
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
        const bgLum = cell ? (cell.bgLum != null ? cell.bgLum : cell.meanLum) : 0;
        const bgSat = cell && cell.bgSat != null ? cell.bgSat : 0;
        const isOpen = cell ? isOpenBg(bgLum, bgSat, openThr) : true;
        const darkInk = bgLum >= CFG.OPEN_WHITE_LUM;
        const Rr = isOpen ? R : Math.min(R, CFG.RETRY_R_UNOPENED);
        const lim = (wl && wl.ok && wl.limits[r * n + c]) || null;
        const bx = Math.round(x0 + c * cellX), by = Math.round(y0 + r * cellY);
        const dVotes = {}, xVotes = { x: 0 };
        let pos = 0;
        for (let dy = -Rr; dy <= Rr; dy++) {
          for (let dx = -Rr; dx <= Rr; dx++) {
            const px = bx + dx, py = by + dy;
            if (px < 0 || py < 0 || px + cw >= id.width || py + chh >= id.height) continue;
            pos++;
            if (isOpen) {
              const gl = extractGlyph(id, px, py, cw, chh, darkInk);
              if (gl) {
                const res = ocrDigit(gl);
                const d = res.d;
                // 白名单外的数字不投票；孔洞兜底读出的带孔数字同样不投票（§18.3 问题 A）
                const banned = (lim && (d < lim[0] || d > lim[1])) ||
                  (res.holesOk === false && CFG.HOLE_DIGITS.indexOf(d) >= 0);
                if (res.conf >= CFG.DIGIT_GATE && !banned) dVotes[d] = (dVotes[d] || 0) + 1;
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

  return { CFG, configure, recognize, detectBoard, ocrDigit, extractGlyph, detectXMark, holesOf, _internal: { lumMap, safeScale, otsuSplit, buildTemplates, normGrid, normGridFit, buildConstraintMap, frameBands, frameCandidates, collectSeams, bestNForAxis, refineFromSeams, polishGrid, blueFracIn, detectBoardSpectral, detectGemCounter, findGemIcon, glyphOfThreshold, cellStats, isOpenBg } };
});
