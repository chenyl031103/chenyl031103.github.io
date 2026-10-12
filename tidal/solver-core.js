/* =====================================================================
   潮汐秘境 · 残局求解核心
   输入：一张残局（每格：未翻开 / 已翻开数字 0-8 / 钻石 / × 标记）+ 该地图钻石总数
   输出：必定是钻石的格子、必定安全的格子、无法确定格子的含钻石概率、下一步建议
        以及与玩家 × 标记的矛盾之处

   规则要点（与活动一致）：数字 = 周围 8 格中的钻石数量；钻石就是雷。
   求解只用「数字」这一硬约束；玩家的 × 标记仅用于事后比对，不参与推理。
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TidalSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HIDDEN = -1;

  function neighborsOf(rows, cols) {
    const out = new Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      const r = (i / cols) | 0, c = i % cols;
      const list = [];
      for (let rr = Math.max(0, r - 1); rr <= Math.min(rows - 1, r + 1); rr++) {
        for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) {
          const j = rr * cols + cc;
          if (j !== i) list.push(j);
        }
      }
      out[i] = list;
    }
    return out;
  }

  function solve(input) {
    const rows = input.rows | 0;
    const cols = input.cols | 0;
    const total = rows * cols;
    const gTotal = Number.isFinite(input.gemTotal) ? input.gemTotal : null;
    const raw = input.cells || [];
    // 数字含义：0 = 数字就是周围钻石数（标准，默认）；1 = 数字比周围钻石数多 1
    const bias = input.numberBias === 1 ? 1 : 0;

    const clue = new Int8Array(total).fill(HIDDEN);
    const markedX = new Uint8Array(total);
    const givenGem = new Uint8Array(total);

    for (let r = 0; r < rows; r++) {
      const row = raw[r] || [];
      for (let c = 0; c < cols; c++) {
        const v = row[c];
        const i = r * cols + c;
        if (v === 'G' || v === 9 || v === 'gem' || v === 'GEM') givenGem[i] = 1;
        else if (v === 'X' || v === 10 || v === 'x') markedX[i] = 1;
        else if (typeof v === 'number' && v >= 0 && v <= 8) clue[i] = v;
        else clue[i] = HIDDEN;
      }
    }

    const NB = neighborsOf(rows, cols);
    const knownGem = Uint8Array.from(givenGem);
    const knownSafe = new Uint8Array(total);
    const reason = new Array(total).fill('');
    const errors = [];
    const conflicts = [];
    const conflictKeys = new Set();
    const steps = [];
    // 是否把玩家的 × 标记当作「确定没有钻石」参与推理（默认当作依据）
    const trustMarks = input.trustMarks !== false;

    const rc = (i) => `第${((i / cols) | 0) + 1}行第${(i % cols) + 1}列`;

    if (trustMarks) {
      for (let i = 0; i < total; i++) {
        if (markedX[i]) {
          knownSafe[i] = 1;
          reason[i] = '你标的 ×（当作确定没有钻石）';
        }
      }
    }

    function buildConstraints() {
      const list = [];
      for (let i = 0; i < total; i++) {
        if (clue[i] < 0) continue;
        let gems = 0;
        const hidden = [];
        for (const j of NB[i]) {
          if (knownGem[j]) gems++;
          else if (clue[j] < 0 && !knownSafe[j]) hidden.push(j);
        }
        const want = clue[i] - bias;            // 按选定含义，这一格周围应有的钻石数
        const need = want - gems;
        const over = need < 0 || need > hidden.length;
        if (over && !conflictKeys.has(i)) {
          conflictKeys.add(i);
          conflicts.push({
            r: (i / cols) | 0, c: i % cols, i,
            clue: clue[i], want, gems, hidden: hidden.length,
            tooMany: need < 0,
          });
          const msg = need < 0
            ? `${rc(i)} 显示数字 ${clue[i]}，但周围已经翻出 ${gems} 颗钻石（应只有 ${want} 颗）`
            : `${rc(i)} 显示数字 ${clue[i]}，需要周围有 ${want} 颗钻石，但只剩 ${hidden.length} 格没翻开`;
          if (!errors.includes(msg)) errors.push(msg);
        }
        list.push({ at: i, need, hidden, over });
      }
      return list;
    }

    /* ---------- 1. 约束传播 + 子集（1-2 型）规则 ---------- */
    function deduce() {
      for (let pass = 0; pass < 500; pass++) {
        const cs = buildConstraints();
        let changed = false;

        for (const k of cs) {
          if (k.over) {
            const msg = `${rc(k.at)} 的数字 ${clue[k.at]} 与周围已知钻石/未翻开格数量矛盾`;
            if (!errors.includes(msg)) errors.push(msg);
            continue;
          }
          if (!k.hidden.length) continue;
          const want = clue[k.at] - bias;
          if (k.need === 0) {
            for (const j of k.hidden) {
              if (!knownSafe[j]) {
                knownSafe[j] = 1;
                reason[j] = `${rc(k.at)} 的数字 ${clue[k.at]}：周围 ${want} 颗钻石已经全部找到 → 这里没有钻石`;
                changed = true;
              }
            }
          } else if (k.need === k.hidden.length) {
            for (const j of k.hidden) {
              if (!knownGem[j]) {
                knownGem[j] = 1;
                reason[j] = `${rc(k.at)} 的数字 ${clue[k.at]}：还差 ${k.need} 颗钻石，而这 ${k.hidden.length} 格正好是剩下的 → 全是钻石`;
                changed = true;
              }
            }
          }
        }
        if (changed) continue;

        // 子集规则：A 的候选格被 B 完全包含 → B\A 的钻石数 = need(B) - need(A)
        for (let a = 0; a < cs.length && !changed; a++) {
          const A = cs[a];
          if (A.over || !A.hidden.length) continue;
          const setA = new Set(A.hidden);
          for (let b = 0; b < cs.length; b++) {
            if (a === b) continue;
            const B = cs[b];
            if (B.over) continue;
            if (A.hidden.length >= B.hidden.length) continue;
            let isSubset = true;
            for (const x of A.hidden) if (!B.hidden.includes(x)) { isSubset = false; break; }
            if (!isSubset) continue;
            const diff = B.hidden.filter((x) => !setA.has(x));
            if (!diff.length) continue;
            const need = B.need - A.need;
            if (need < 0 || need > diff.length) continue;
            if (need === 0) {
              for (const j of diff) {
                if (!knownSafe[j]) {
                  knownSafe[j] = 1;
                  reason[j] = `${rc(A.at)} 与 ${rc(B.at)} 两个数字叠加推算 → 这里没有钻石`;
                  changed = true;
                }
              }
            } else if (need === diff.length) {
              for (const j of diff) {
                if (!knownGem[j]) {
                  knownGem[j] = 1;
                  reason[j] = `${rc(A.at)} 与 ${rc(B.at)} 两个数字叠加推算 → 这里必定是钻石`;
                  changed = true;
                }
              }
            }
            if (changed) break;
          }
        }
        if (!changed) break;
      }
    }

    /* ---------- 2. 概率：分量精确枚举 + 总数约束 ---------- */
    function analyze() {
      const cand = [];
      for (let i = 0; i < total; i++) if (clue[i] < 0 && !knownGem[i] && !knownSafe[i]) cand.push(i);

      const probs = new Array(total).fill(null);
      let approx = false;
      if (!cand.length) {
        // 没有待定格了：只可能是"整盘都已判定"，此时唯一能矛盾的是已标钻石数超过总数
        let knownN = 0;
        for (let i = 0; i < total; i++) if (knownGem[i]) knownN++;
        return { probs, approx, impossible: gTotal != null && knownN > gTotal };
      }

      const cs = buildConstraints();
      const candSet = new Set(cand);
      const adj = new Map();
      for (const i of cand) adj.set(i, new Set());
      for (const k of cs) {
        for (const a of k.hidden) {
          if (!candSet.has(a)) continue;
          for (const b of k.hidden) {
            if (a !== b && candSet.has(b)) adj.get(a).add(b);
          }
        }
      }

      // 连通分量
      const seen = new Set();
      const comps = [];
      for (const i of cand) {
        if (seen.has(i)) continue;
        const stack = [i], cells = [];
        seen.add(i);
        while (stack.length) {
          const v = stack.pop();
          cells.push(v);
          for (const w of adj.get(v)) if (!seen.has(w)) { seen.add(w); stack.push(w); }
        }
        comps.push(cells);
      }

      // 通用精确枚举（MRV 动态选格 + 约束优先），cellsArr 为格子列表、relArr 的 ix 是其下标
      function enumStats(cellsArr, relArr, budgetMs) {
        const kk = cellsArr.length;
        const perCount = new Float64Array(kk + 1);
        const cellGem = cellsArr.map(() => new Float64Array(kk + 1));
        const inc = cellsArr.map(() => []);
        for (const c of relArr) for (const ix of c.ix) inc[ix].push(c);
        const assign = new Int8Array(kk).fill(-1);
        let steps = 0, overflow = false;
        const t0 = Date.now();
        (function rec(depth, gemCount) {
          if (overflow) return;
          if ((++steps & 511) === 0 && Date.now() - t0 > budgetMs) { overflow = true; return; }
          if (depth === kk) {
            perCount[gemCount] += 1;
            for (let z = 0; z < kk; z++) if (assign[z] === 1) cellGem[z][gemCount] += 1;
            return;
          }
          let best = -1, bestScore = -1;
          for (let i = 0; i < kk; i++) {
            if (assign[i] >= 0) continue;
            let score = 0;
            for (const c of inc[i]) {
              let done = 0;
              for (const ix of c.ix) if (assign[ix] >= 0) done++;
              score += done * done + 1;
            }
            if (score > bestScore) { bestScore = score; best = i; }
          }
          for (const v of [0, 1]) {
            assign[best] = v;
            let ok = true;
            for (const c of inc[best]) {
              let done = true, g = 0;
              for (const ix of c.ix) {
                if (assign[ix] < 0) { done = false; break; }
                if (assign[ix] === 1) g++;
              }
              if (done && g !== c.need) { ok = false; break; }
            }
            if (ok) rec(depth + 1, gemCount + v);
            assign[best] = -1;
          }
        })(0, 0);
        return { perCount, cellGem, overflow };
      }

      // 每个分量的方案统计
      const compStats = [];
      let freeCells = 0;      // 没有任何线索约束的格子数（容量上界要用）
      for (const cells of comps) {
        // 按"被约束次数"从多到少排序：枚举时先放约束最紧的格子，剪枝更早、大分量也不怕
        const touchCount = new Map();
        for (const i of cells) touchCount.set(i, 0);
        for (const k of cs) {
          let inComp = true;
          for (const h of k.hidden) if (!touchCount.has(h)) { inComp = false; break; }
          if (!inComp) continue;
          for (const h of k.hidden) touchCount.set(h, touchCount.get(h) + 1);
        }
        cells.sort((a, b) => touchCount.get(b) - touchCount.get(a));

        const pos = new Map();
        cells.forEach((c, ix) => pos.set(c, ix));
        const rel = cs
          .filter((k) => k.hidden.length && k.hidden.every((h) => pos.has(h)))
          .map((k) => ({ need: k.need, ix: k.hidden.map((h) => pos.get(h)) }));
        // 与任何数字都不相交的孤立格：这里不枚举（否则"0 或 1 颗"会给出固定的 50%），
        // 交给后面的「密度先验」= 剩余钻石 / 未翻开格数。
        // 但它们的"容量"要记下来：剩余钻石也可以藏在这些格子里（见下面的总数一致性检查）。
        if (!rel.length) { freeCells += cells.length; continue; }
        const touch = new Set();
        for (const k of rel) for (const ix of k.ix) touch.add(ix);

        const k = cells.length;
        const stat = { cells, perCount: new Float64Array(k + 1), cellGem: cells.map(() => new Float64Array(k + 1)), approx: false };

        // 分量过大时（>EXACT_MAX 或枚举爆预算）退化为启发式估算
        // 整分量精确枚举（40 格以内、150ms 以内基本都是秒算）
        const EXACT_MAX = 40;
        if (k <= EXACT_MAX) {
          const r = enumStats(cells, rel, 150);
          if (!r.overflow) {
            stat.perCount = r.perCount;
            stat.cellGem = r.cellGem;
            compStats.push(stat);
            continue;
          }
        }

        // 大分量 / 超时：改为"逐格局部精确"——把该格相关的两层约束圈出来当独立小问题精确枚举，
        // 不同位置各算各的值，不会再出现一大片相同的粗估值。
        stat.approx = true;
        approx = true;
        const ratio = new Float64Array(k);
        for (const kk of rel) {
          const p = kk.need / kk.ix.length;
          for (const ix of kk.ix) if (p > ratio[ix]) ratio[ix] = p;
        }
        const touching = cells.map(() => []);
        rel.forEach((kk, ri) => { for (const ix of kk.ix) touching[ix].push(ri); });
        const regionCache = new Map();
        const FB_BUDGET = 250;              // 局部兜底总预算
        const fbStart = Date.now();
        const direct = new Float64Array(k);
        for (let t = 0; t < k; t++) {
          let val = ratio[t];               // 算不动时的兜底：按最紧约束的比例
          if (Date.now() - fbStart < FB_BUDGET) {
            const relSet = new Set();
            for (const ri of touching[t]) {
              relSet.add(ri);
              for (const ix of rel[ri].ix) for (const r2 of touching[ix]) relSet.add(r2);
            }
            const key = [...relSet].sort((a, b) => a - b).join(',');
            let entry = regionCache.get(key);
            if (entry === undefined) {
              entry = null;
              const vars = new Set();
              for (const ri of relSet) for (const ix of rel[ri].ix) vars.add(ix);
              if (vars.size <= 26) {
                const varArr = [...vars];
                const m = new Map();
                varArr.forEach((v, i) => m.set(v, i));
                const subRel = [...relSet].map((ri) => ({ need: rel[ri].need, ix: rel[ri].ix.map((v) => m.get(v)) }));
                const rr = enumStats(varArr, subRel, 25);
                if (!rr.overflow) {
                  let den = 0;
                  for (const w of rr.perCount) den += w;
                  if (den) {
                    const sub = new Float64Array(varArr.length);
                    for (let z = 0; z < varArr.length; z++) {
                      let num = 0;
                      for (let g = 0; g < rr.cellGem[z].length; g++) num += rr.cellGem[z][g];
                      sub[z] = num / den;
                    }
                    entry = { m, probs: sub };
                  }
                }
              }
              regionCache.set(key, entry);
            }
            if (entry) val = entry.probs[entry.m.get(t)];
          }
          direct[t] = val;
        }
        // 供"全盘总数一致性检查"用的粗略最少/最多钻石数
        let mn = 0, mx = 0;
        for (let t = 0; t < k; t++) {
          if (direct[t] >= 0.999) mn++;
          if (direct[t] > 0.001) mx++;
        }
        stat.perCount = new Float64Array(k + 1);
        stat.perCount[mn] = 1;
        stat.perCount[mx] = 1;
        stat.direct = direct;
        compStats.push(stat);
      }

      // 概率采用「分组局部」模型：只统计该格所在线索组内的合法摆法（逐组独立），
      // 放一个数字只影响与它 3×3 邻域相交的数字组，不相交的区域完全不受影响。
      for (const st of compStats) {
        if (st.direct) {
          // 大分量的局部兜底：每格已是最终概率（局部精确或比例估计）
          for (let t = 0; t < st.cells.length; t++) probs[st.cells[t]] = st.direct[t];
          continue;
        }
        let denom = 0;
        for (const v of st.perCount) denom += v;
        if (!denom) return { probs, approx, impossible: true };   // 组内无合法摆法 → 盘面矛盾
        for (let t = 0; t < st.cells.length; t++) {
          let num = 0;
          for (let g = 0; g < st.cellGem[t].length; g++) num += st.cellGem[t][g];
          probs[st.cells[t]] = num / denom;
        }
      }

      // 没有任何数字线索约束的格子（与线索不相交的孤立格）：用「盘面密度」当先验 ——
      //   剩余钻石 / 还没翻开的格子数。
      // 它只随"场上还剩几颗钻石、还剩几格没开"变化（开掉钻石、翻开格子都会更新），
      // 和"放/改哪个数字"无关 —— 这样既反映盘面剩余，又保持局部模型的稳定性。
      if (gTotal != null) {
        const knownN = knownGem.reduce((a, b) => a + b, 0);
        let unknownN = 0;
        for (let i = 0; i < total; i++) if (clue[i] < 0 && !knownGem[i] && !knownSafe[i]) unknownN++;
        if (unknownN > 0) {
          const prior = Math.max(0, Math.min(1, (gTotal - knownN) / unknownN));
          for (const i of cand) if (probs[i] == null) probs[i] = prior;
        }
      }

      // 单独的「全盘钻石总数」一致性检查：只用于矛盾提示，不参与概率计算。
      // 各组最少/最多需要的钻石数求和，与剩余总数比较，超出范围即盘面矛盾。
      if (gTotal != null) {
        const knownCount = knownGem.reduce((a, b) => a + b, 0);
        const needLeft = gTotal - knownCount;
        if (needLeft < 0) return { probs, approx, impossible: true };
        let minSum = 0, maxSum = 0;
        for (const st of compStats) {
          let mn = -1, mx = -1;
          for (let g = 0; g < st.perCount.length; g++) {
            if (st.perCount[g]) { if (mn < 0) mn = g; mx = g; }
          }
          if (mn < 0) return { probs, approx, impossible: true };
          minSum += mn; maxSum += mx;
        }
        // 上界要把"没有任何线索约束的孤立格"也算进去：剩余钻石本来就允许藏在那些格子里
        // （漏掉它们会导致"新开一盘、只有几个数字"的盘面被误判成矛盾）
        if (needLeft < minSum || needLeft > maxSum + freeCells) return { probs, approx, impossible: true };
      }
      return { probs, approx };
    }

    /* ---------- 3. 主流程 ---------- */
    deduce();
    let res = analyze();
    let promoted = true;
    for (let pass = 0; pass < 3 && promoted; pass++) {
      promoted = false;
      if (!res.probs || res.impossible) break;   // 已经是矛盾盘面：别再提升、保留矛盾标记
      for (let i = 0; i < total; i++) {
        const p = res.probs[i];
        if (p == null) continue;
        if (p >= 1 - 1e-9 && !knownGem[i]) { knownGem[i] = 1; reason[i] = reason[i] || '结合地图钻石总数推出必然是钻石'; promoted = true; }
        else if (p <= 1e-9 && !knownSafe[i]) { knownSafe[i] = 1; reason[i] = reason[i] || '结合地图钻石总数推出必然没钻石'; promoted = true; }
      }
      if (promoted) { deduce(); res = analyze(); }
    }
    // 全盘固定钻石数的确定性推导：局部概率模型不含总数，这里单独补上"已找齐 / 剩满格"的必然后果。
    // （例：8×8 的 20 颗全找到了 → 剩下的格子全部没有钻石，直接标 ×）
    if (gTotal != null && res && !res.impossible) {
      let changed = false;
      const leftCells = [];
      for (let i = 0; i < total; i++) if (clue[i] < 0 && !knownGem[i] && !knownSafe[i]) leftCells.push(i);
      const knownCount = knownGem.reduce((a, b) => a + b, 0);
      const rem = gTotal - knownCount;
      if (leftCells.length && rem <= 0) {
        for (const i of leftCells) { knownSafe[i] = 1; reason[i] = reason[i] || `本图 ${gTotal} 颗钻石已全部找到，剩余的格子都没有钻石`; changed = true; }
      } else if (leftCells.length && rem >= leftCells.length) {
        for (const i of leftCells) { knownGem[i] = 1; reason[i] = reason[i] || `剩余 ${rem} 颗钻石正好等于剩下的格子数，剩下的格子全是钻石`; changed = true; }
      }
      if (changed) { deduce(); res = analyze(); }
    }
    const probs = res.probs;

    /* ---------- 4. 与玩家 × 标记比对 ---------- */
    const markWrong = [];      // × 标了，但推出来是钻石
    const markRisky = [];      // × 标了，但完全没有依据（概率不低）
    const gemWrong = [];       // 标了钻石，但推出必然安全
    for (let i = 0; i < total; i++) {
      if (markedX[i]) {
        if (knownGem[i]) markWrong.push({ r: (i / cols) | 0, c: i % cols, i });
        else if (probs[i] != null && probs[i] > 0.02) markRisky.push({ r: (i / cols) | 0, c: i % cols, i, p: probs[i] });
      }
      if (givenGem[i] && knownSafe[i]) gemWrong.push({ r: (i / cols) | 0, c: i % cols, i });
    }
    // × 标记之间/与已知钻石的硬矛盾
    const contradict = [];
    for (let i = 0; i < total; i++) {
      if (markedX[i] && knownGem[i]) contradict.push(rc(i));
    }

    /* ---------- 5. 汇总与建议 ---------- */
    const certainGems = [], certainSafe = [], undecided = [];
    for (let i = 0; i < total; i++) {
      if (knownGem[i] && !givenGem[i]) certainGems.push({ r: (i / cols) | 0, c: i % cols, i, why: reason[i] });
      else if (knownSafe[i]) certainSafe.push({ r: (i / cols) | 0, c: i % cols, i, why: reason[i] });
      else if (clue[i] < 0 && probs[i] != null) undecided.push({ r: (i / cols) | 0, c: i % cols, i, p: probs[i] });
    }
    undecided.sort((a, b) => a.p - b.p);

    const clueNeighborCount = (i) => NB[i].filter((j) => clue[j] >= 0).length;
    certainSafe.sort((a, b) => clueNeighborCount(b.i) - clueNeighborCount(a.i));
    certainGems.sort((a, b) => clueNeighborCount(b.i) - clueNeighborCount(a.i));

    const knownCount = knownGem.reduce((a, b) => a + b, 0);
    let pick = null;
    if (certainGems.length) {
      pick = { ...certainGems[0], type: 'gem' };
    } else if (certainSafe.length) {
      pick = { ...certainSafe[0], type: 'safe' };
    } else if (undecided.length) {
      const hi = undecided[undecided.length - 1], lo = undecided[0];
      pick = { ...hi, type: 'guess', alt: lo };
    }

    const hiddenLeft = (() => { let n = 0; for (let i = 0; i < total; i++) if (clue[i] < 0 && !givenGem[i]) n++; return n; })();

    return {
      rows, cols,
      counts: {
        gemTotal: gTotal,
        knownGems: knownCount,
        remainingGems: gTotal == null ? null : Math.max(0, gTotal - knownCount),
        certainGems: certainGems.length,
        certainSafe: certainSafe.length,
        undecided: undecided.length,
        hiddenCells: hiddenLeft,
      },
      certainGems, certainSafe, undecided, pick,
      probs,
      knownGem, knownSafe, markedX, givenGem, clue,
      markWrong, markRisky, gemWrong, contradict,
      impossible: !!res.impossible,
      approx: !!res.approx,
      errors,
      conflicts,
      numberBias: bias,
      numberCells: (() => { let n = 0; for (let i = 0; i < total; i++) if (clue[i] >= 0) n++; return n; })(),
    };
  }

  return { solve, HIDDEN };
});
