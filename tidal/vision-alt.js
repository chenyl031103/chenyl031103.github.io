/*
 * 潮汐秘境 · 独立本机备选识别器
 *
 * 这是根据公开可观察的棋盘视觉特征重新实现的独立算法：
 * 青色棋盘区域定位 → 格缝周期判断 → 金色/蓝色/白色像素分类 → 数字模板匹配。
 * 不上传图片，不依赖外部站点、Tesseract 资源或服务器接口。
 */
(() => {
  'use strict';

  const GEM_TOTAL = { 8: 20, 10: 30, 12: 45 };
  const WORK_MAX_PIXELS = 5000000;
  const TEMPLATE_W = 28, TEMPLATE_H = 36;
  let templates = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  function toImageData(input) {
    if (input && input.data && input.width && input.height) return input;
    if (typeof document === 'undefined') throw new Error('当前环境无法读取图片');
    if (input && typeof input.getContext === 'function') {
      return input.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, input.width, input.height);
    }
    throw new Error('备选识别器收到的不是图片');
  }

  function scaleImage(id) {
    const pixels = id.width * id.height;
    if (pixels <= WORK_MAX_PIXELS || typeof document === 'undefined') return id;
    const k = Math.sqrt(WORK_MAX_PIXELS / pixels);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(id.width * k));
    cv.height = Math.max(1, Math.round(id.height * k));
    const c = cv.getContext('2d', { willReadFrequently: true });
    const src = document.createElement('canvas');
    src.width = id.width; src.height = id.height;
    src.getContext('2d').putImageData(id, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, cv.width, cv.height);
    return c.getImageData(0, 0, cv.width, cv.height);
  }

  function cyanPixel(r, g, b) {
    return g > 100 && b > 130 && r < 135 && b > r * 1.35 && g > r * 1.05;
  }

  function collectRuns(values, threshold, minLength) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= values.length; i++) {
      const on = i < values.length && values[i] >= threshold;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start >= minLength) runs.push({ start, end: i - 1, length: i - start });
        start = -1;
      }
    }
    return runs;
  }

  function colorBounds(id) {
    const { width: W, height: H, data } = id;
    const row = new Int32Array(H), col = new Int32Array(W);
    const step = Math.max(1, Math.round(Math.min(W, H) / 700));
    // 先找大面积近方形青色连通区；场景和奖励条虽然也有青色，通常不具备这个形状。
    const mw = Math.ceil(W / step), mh = Math.ceil(H / step);
    const mask = new Uint8Array(mw * mh), seen = new Uint8Array(mw * mh);
    for (let yy = 0; yy < mh; yy++) for (let xx = 0; xx < mw; xx++) {
      const x = Math.min(W - 1, xx * step), y = Math.min(H - 1, yy * step);
      const p = (y * W + x) * 4;
      if (cyanPixel(data[p], data[p + 1], data[p + 2])) mask[yy * mw + xx] = 1;
    }
    let componentBest = null;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      const stack = [i]; seen[i] = 1; let count = 0;
      let x0 = i % mw, x1 = x0, y0 = (i / mw) | 0, y1 = y0;
      while (stack.length) {
        const q = stack.pop(), x = q % mw, y = (q / mw) | 0;
        count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
          const q2 = ny * mw + nx;
          if (mask[q2] && !seen[q2]) { seen[q2] = 1; stack.push(q2); }
        }
      }
      const bw = (x1 - x0 + 1) * step, bh = (y1 - y0 + 1) * step;
      const ratio = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (count >= 120 && bw >= W * 0.35 && bh >= H * 0.20 && ratio <= 1.25) {
        const score = count * Math.min(bw, bh) * (1 - (ratio - 1));
        if (!componentBest || score > componentBest.score) componentBest = { x0: x0 * step, y0: y0 * step, x1: Math.min(W - 1, (x1 + 1) * step - 1), y1: Math.min(H - 1, (y1 + 1) * step - 1), score };
      }
    }
    if (componentBest) {
      const pad = Math.max(3, Math.round(Math.min(componentBest.x1 - componentBest.x0 + 1, componentBest.y1 - componentBest.y0 + 1) * 0.007));
      componentBest.x0 += pad; componentBest.y0 += pad;
      componentBest.x1 -= pad; componentBest.y1 -= pad;
      return componentBest;
    }
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const p = (y * W + x) * 4;
        if (!cyanPixel(data[p], data[p + 1], data[p + 2])) continue;
        row[y] += step; col[x] += step;
      }
    }
    const rowSmooth = new Float64Array(H), colSmooth = new Float64Array(W);
    const rw = Math.max(3, Math.round(H * 0.006)), cw = Math.max(3, Math.round(W * 0.006));
    let rowMax = 0, colMax = 0;
    for (let y = 0; y < H; y++) {
      let s = 0, n = 0;
      for (let q = Math.max(0, y - rw); q <= Math.min(H - 1, y + rw); q++) { s += row[q]; n++; }
      rowSmooth[y] = s / n; rowMax = Math.max(rowMax, rowSmooth[y]);
    }
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let q = Math.max(0, x - cw); q <= Math.min(W - 1, x + cw); q++) { s += col[q]; n++; }
      colSmooth[x] = s / n; colMax = Math.max(colMax, colSmooth[x]);
    }
    const rowRuns = collectRuns(rowSmooth, Math.max(20, rowMax * 0.22), Math.max(20, Math.round(H * 0.025)));
    let best = null;
    for (const rr of rowRuns) {
      const height = rr.length;
      const y0 = rr.start, y1 = rr.end;
      const localCols = [];
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let y = y0; y <= y1; y += step) {
          const p = (y * W + x) * 4;
          if (cyanPixel(data[p], data[p + 1], data[p + 2])) n += step;
        }
        localCols[x] = n;
      }
      const colRuns = collectRuns(localCols, Math.max(20, height * 0.18), Math.max(20, Math.round(W * 0.08)));
      for (const cr of colRuns) {
        const width = cr.length;
        const side = Math.min(width, height);
        const ratio = Math.max(width, height) / Math.max(1, side);
        if (side < Math.min(W, H) * 0.22 || ratio > 1.35) continue;
        const score = side * side * (1 - Math.min(0.8, Math.abs(width - height) / side));
        if (!best || score > best.score) best = { x0: cr.start, y0: rr.start, x1: cr.end, y1: rr.end, score };
      }
    }
    return best;
  }

  function darkAt(id, x, y) {
    if (x < 0 || y < 0 || x >= id.width || y >= id.height) return 255;
    const p = (y * id.width + x) * 4;
    return lum(id.data[p], id.data[p + 1], id.data[p + 2]);
  }

  function seamScore(id, rect, n) {
    const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
    const cx = w / n, cy = h / n;
    const sample = (vertical) => {
      let score = 0, count = 0;
      for (let k = 1; k < n; k++) {
        const pos = vertical ? rect.x0 + k * cx : rect.y0 + k * cy;
        for (let t = 0.15; t <= 0.85; t += 0.04) {
          const x = vertical ? Math.round(pos) : Math.round(rect.x0 + t * w);
          const y = vertical ? Math.round(rect.y0 + t * h) : Math.round(pos);
          const line = darkAt(id, x, y);
          const off = Math.max(2, Math.round((vertical ? cx : cy) * 0.16));
          const a = darkAt(id, vertical ? x - off : x, vertical ? y : y - off);
          const b = darkAt(id, vertical ? x + off : x, vertical ? y : y + off);
          score += (a + b) / 2 - line;
          count++;
        }
      }
      return count ? score / count : 0;
    };
    const v = sample(true), hscore = sample(false);
    return (v + hscore) / 2;
  }

  function findGrid(id, forcedN) {
    const bounds = colorBounds(id);
    if (!bounds) throw new Error('备选识别器没有找到青色棋盘区域');
    const candidates = forcedN ? [forcedN] : [8, 10, 12];
    let best = null;
    for (const n of candidates) {
      const w = bounds.x1 - bounds.x0 + 1, h = bounds.y1 - bounds.y0 + 1;
      const side = Math.min(w, h);
      const x0 = bounds.x0 + (w - side) / 2;
      const y0 = bounds.y0 + (h - side) / 2;
      const grid = { x0, y0, cellX: side / n, cellY: side / n, n, src: 'alt-cyan' };
      const score = seamScore(id, { x0, y0, x1: x0 + side - 1, y1: y0 + side - 1 }, n) + side * 0.002;
      if (!best || score > best.score) best = { grid, score };
    }
    if (!best || best.grid.cellX < 12) throw new Error('备选识别器棋盘格太小');
    return best.grid;
  }

  function cellPixels(id, grid, r, c) {
    const insetX = grid.cellX * 0.13, insetY = grid.cellY * 0.13;
    const x0 = Math.round(grid.x0 + c * grid.cellX + insetX);
    const y0 = Math.round(grid.y0 + r * grid.cellY + insetY);
    const x1 = Math.round(grid.x0 + (c + 1) * grid.cellX - insetX);
    const y1 = Math.round(grid.y0 + (r + 1) * grid.cellY - insetY);
    const points = [];
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const p = (y * id.width + x) * 4;
      points.push([id.data[p], id.data[p + 1], id.data[p + 2], x, y]);
    }
    return { points, x0, y0, x1, y1 };
  }

  function makeMask(cell) {
    const mask = new Float32Array(TEMPLATE_W * TEMPLATE_H);
    const bright = [];
    for (const [r, g, b, x, y] of cell.points) {
      if (lum(r, g, b) > 160 && r > 125 && g > 125 && b > 125) bright.push([x, y]);
    }
    if (!bright.length) return mask;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of bright) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const bw = Math.max(1, maxX - minX + 1), bh = Math.max(1, maxY - minY + 1);
    for (const [x, y] of bright) {
      const tx = clamp(Math.floor((x - minX) * (TEMPLATE_W - 1) / bw), 0, TEMPLATE_W - 1);
      const ty = clamp(Math.floor((y - minY) * (TEMPLATE_H - 1) / bh), 0, TEMPLATE_H - 1);
      mask[ty * TEMPLATE_W + tx] = 1;
    }
    return mask;
  }

  function buildTemplates() {
    if (templates || typeof document === 'undefined') return templates;
    const cv = document.createElement('canvas'); cv.width = 100; cv.height = 120;
    const ctx = cv.getContext('2d'); templates = [];
    const fonts = ['bold 48px Arial', 'bold 48px Verdana', 'bold 48px Tahoma', 'bold 48px system-ui'];
    for (let d = 0; d <= 8; d++) for (const font of fonts) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#fff'; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(d), 50, 60);
      const id = ctx.getImageData(0, 0, cv.width, cv.height);
      const cell = { points: [], x0: 0, y0: 0, x1: 100, y1: 120 };
      for (let y = 0; y < 120; y += 2) for (let x = 0; x < 100; x += 2) {
        const p = (y * 100 + x) * 4; if (id.data[p + 3] && id.data[p] > 150) cell.points.push([255, 255, 255, x, y]);
      }
      const mask = makeMask(cell); templates.push({ d, mask });
    }
    return templates;
  }

  function maskError(a, b) {
    let err = 0, active = 0;
    for (let i = 0; i < a.length; i++) { err += Math.abs(a[i] - b[i]); active += a[i] > 0.1 ? 1 : 0; }
    return err / a.length + (active < 8 ? 0.2 : 0);
  }

  function diagCoverage(cell, which) {
    const { x0, y0, x1, y1, points } = cell;
    const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
    let hit = 0, total = 0;
    for (let i = 0; i < 36; i++) {
      const t = i / 35;
      const x = Math.round(x0 + (which ? (1 - t) : t) * W);
      const y = Math.round(y0 + t * H);
      let found = false;
      for (const [r, g, b, px, py] of points) {
        if (Math.abs(px - x) <= Math.max(2, W * 0.035) && Math.abs(py - y) <= Math.max(2, H * 0.035) && lum(r, g, b) > 160 && r > 125 && g > 125 && b > 125) { found = true; break; }
      }
      if (found) hit++; total++;
    }
    return hit / total;
  }

  function classifyCell(id, grid, r, c) {
    const cell = cellPixels(id, grid, r, c);
    let gold = 0, blue = 0, bright = 0, white = 0, total = cell.points.length;
    for (const [rr, gg, bb] of cell.points) {
      if (rr > 140 && gg > 70 && gg < rr * 0.98 && bb < gg * 0.70) gold++;
      if (bb > rr * 1.45 && bb > gg * 1.08 && gg > 25 && rr < 135) blue++;
      const L = lum(rr, gg, bb);
      if (L > 160 && rr > 125 && gg > 125 && bb > 125) {
        bright++;
        // 数字和 × 是近白色笔画；未翻开格的亮蓝高光饱和度很高（实测 max-min 常在 50 以上），
        // 不能算笔画，否则拿高光去套模板会稳定误读成 1
        if (Math.max(rr, gg, bb) - Math.min(rr, gg, bb) <= 45) white++;
      }
    }
    const goldFrac = gold / total, blueFrac = blue / total;
    const brightFrac = bright / total, whiteFrac = white / total;
    if (goldFrac > 0.11) return { value: 9, confidence: 0.96 };
    const d1 = diagCoverage(cell, false), d2 = diagCoverage(cell, true);
    // × 的两条对角线都亮（实测两条都 ≥0.55）；数字只有个别笔画压到对角线（实测 ≤0.47）。
    // 压缩后的浅蓝 X 对角线会断裂，这里已经比数字宽出一档，不必再放宽。
    if (brightFrac > 0.05 && Math.min(d1, d2) >= 0.50) return { value: 10, confidence: 0.86 };
    // 没有近白笔画 = 未翻开的蓝格（实测未翻开格 whiteFrac ≤0.02，数字/× ≥0.06）
    if (whiteFrac < 0.03 && blueFrac > 0.30) return { value: -1, confidence: 0.94 };
    if (whiteFrac < 0.008) return { value: -1, confidence: 0.45, unsure: true };
    const mask = makeMask(cell), ts = buildTemplates();
    let best = null, second = null;
    for (const t of ts) {
      const e = maskError(mask, t.mask);
      if (!best || e < best.e) { second = best; best = { d: t.d, e }; }
      else if (!second || e < second.e) second = { d: t.d, e };
    }
    const margin = second ? second.e - best.e : 0;
    const confidence = clamp(1 - best.e * 2.2 + margin * 1.4, 0, 1);
    if (best && confidence >= 0.48) return { value: best.d, confidence, unsure: confidence < 0.68 };
    return { value: -1, confidence: 0.3, unsure: true };
  }

  function recognize(input, options) {
    const raw = scaleImage(toImageData(input));
    const grid = findGrid(raw, options && options.forceN);
    const cells = [], unsure = [];
    let filled = 0;
    for (let r = 0; r < grid.n; r++) {
      const row = [];
      for (let c = 0; c < grid.n; c++) {
        const result = classifyCell(raw, grid, r, c);
        row.push(result.value);
        if (result.value !== -1) filled++;
        if (result.unsure || result.confidence < 0.65) unsure.push([r, c]);
      }
      cells.push(row);
    }
    const coverage = filled / (grid.n * grid.n);
    const thin = coverage < 0.08 || unsure.length > grid.n * grid.n * 0.42;
    if (thin) throw new Error('备选本机识别可信度不足，请手动填写');
    return {
      rows: grid.n, cols: grid.n, cells, unsure, coverage, thin: false,
      image: raw,
      debug: { grid, detector: 'alt', unsureCount: unsure.length },
      note: `本机增强识别：读出 ${filled} 格`,
      gemTotal: GEM_TOTAL[grid.n] || 0,
    };
  }

  window.TidalAltVision = { recognize };
})();
