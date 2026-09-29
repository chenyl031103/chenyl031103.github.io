/* =====================================================================
   潮汐秘境 · 残局求解核心
   输入：一张残局（每格：未翻开 / 已翻开数字 0-8 / 宝钻 / × 标记）+ 该地图宝钻总数
   输出：必定是宝钻的格子、必定安全的格子、无法确定格子的含宝钻概率、下一步建议
        以及与玩家 × 标记的矛盾之处

   规则要点（与活动一致）：数字 = 周围 8 格中的宝钻数量；宝钻就是雷。
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

  /** 卷积（带上限），用于把各连通分量的方案数合并成总数约束下的权重 */
  function convolve(a, b, limit) {
    const out = new Float64Array(limit + 1);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === 0) continue;
      for (let j = 0; j < b.length && i + j <= limit; j++) {
        if (b[j] === 0) continue;
        out[i + j] += a[i] * b[j];
      }
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

    const rc = (i) => `第${((i / cols) | 0) + 1}行第${(i % cols) + 1}列`;

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
            ? `${rc(i)} 显示数字 ${clue[i]}，但周围已经翻出 ${gems} 颗宝钻（应只有 ${want} 颗）`
            : `${rc(i)} 显示数字 ${clue[i]}，需要周围有 ${want} 颗宝钻，但只剩 ${hidden.length} 格没翻开`;
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
            const msg = `${rc(k.at)} 的数字 ${clue[k.at]} 与周围已知宝钻/未翻开格数量矛盾`;
            if (!errors.includes(msg)) errors.push(msg);
            continue;
          }
          if (!k.hidden.length) continue;
          const want = clue[k.at] - bias;
          if (k.need === 0) {
            for (const j of k.hidden) {
              if (!knownSafe[j]) {
                knownSafe[j] = 1;
                reason[j] = `${rc(k.at)} 的数字 ${clue[k.at]}：周围 ${want} 颗宝钻已经全部找到 → 这里没有宝钻`;
                changed = true;
              }
            }
          } else if (k.need === k.hidden.length) {
            for (const j of k.hidden) {
              if (!knownGem[j]) {
                knownGem[j] = 1;
                reason[j] = `${rc(k.at)} 的数字 ${clue[k.at]}：还差 ${k.need} 颗宝钻，而这 ${k.hidden.length} 格正好是剩下的 → 全是宝钻`;
                changed = true;
              }
            }
          }
        }
        if (changed) continue;

        // 子集规则：A 的候选格被 B 完全包含 → B\A 的宝钻数 = need(B) - need(A)
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
                  reason[j] = `${rc(A.at)} 与 ${rc(B.at)} 两个数字叠加推算 → 这里没有宝钻`;
                  changed = true;
                }
              }
            } else if (need === diff.length) {
              for (const j of diff) {
                if (!knownGem[j]) {
                  knownGem[j] = 1;
                  reason[j] = `${rc(A.at)} 与 ${rc(B.at)} 两个数字叠加推算 → 这里必定是宝钻`;
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
      if (!cand.length) return { probs, approx };

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

      // 每个分量的方案统计
      const compStats = [];
      for (const cells of comps) {
        const pos = new Map();
        cells.forEach((c, ix) => pos.set(c, ix));
        const rel = cs
          .filter((k) => k.hidden.length && k.hidden.every((h) => pos.has(h)))
          .map((k) => ({ need: k.need, ix: k.hidden.map((h) => pos.get(h)) }));
        const touch = new Set();
        for (const k of rel) for (const ix of k.ix) touch.add(ix);

        const k = cells.length;
        const stat = { cells, perCount: new Float64Array(k + 1), cellGem: cells.map(() => new Float64Array(k + 1)), approx: false };

        if (k > 20) {
          // 分量过大：退化为启发式（按约束比例取最大），并标注为估算
          stat.approx = true;
          approx = true;
          const hv = new Float64Array(k);
          for (const kk of rel) {
            const p = kk.need / kk.ix.length;
            for (const ix of kk.ix) if (p > hv[ix]) hv[ix] = p;
          }
          for (let t = 0; t < k; t++) {
            // 把启发式概率折算成权重
            const p = hv[t];
            stat.cellGem[t][0] = 1 - p;
            stat.cellGem[t][1] = p;
            stat.perCount[0] *= (1 - p);
            stat.perCount[1] = (stat.perCount[1] || 0) + p;
          }
          compStats.push(stat);
          continue;
        }

        const assign = new Int8Array(k).fill(-1);
        const inc = cells.map(() => []);
        for (const kk of rel) for (const ix of kk.ix) inc[ix].push(kk);

        (function rec(t, gemCount) {
          if (t === k) {
            stat.perCount[gemCount] += 1;
            for (let z = 0; z < k; z++) if (assign[z] === 1) stat.cellGem[z][gemCount] += 1;
            return;
          }
          for (const v of [0, 1]) {
            assign[t] = v;
            let ok = true;
            for (const kk of inc[t]) {
              let done = true, g = 0;
              for (const ix of kk.ix) {
                if (assign[ix] < 0) { done = false; break; }
                if (assign[ix] === 1) g++;
              }
              if (done && g !== kk.need) { ok = false; break; }
            }
            if (ok) rec(t + 1, gemCount + v);
            assign[t] = -1;
          }
        })(0, 0);

        compStats.push(stat);
      }

      // 总数约束：候选区宝钻数 = 地图总数 - 已翻出/已知的宝钻数
      const knownCount = knownGem.reduce((a, b) => a + b, 0);
      const need = gTotal == null ? null : gTotal - knownCount;

      const limit = need == null ? 0 : Math.max(0, need);
      let totalWays = 1;
      if (need != null) {
        if (need < 0) return { probs, approx, impossible: true };
        const prefix = [];
        let cur = new Float64Array(limit + 1);
        cur[0] = 1;
        prefix.push(cur);
        for (const st of compStats) {
          cur = convolve(cur, st.perCount, limit);
          prefix.push(cur);
        }
        const suffix = new Array(compStats.length + 1);
        suffix[compStats.length] = (() => { const a = new Float64Array(limit + 1); a[0] = 1; return a; })();
        for (let c = compStats.length - 1; c >= 0; c--) {
          suffix[c] = convolve(compStats[c].perCount, suffix[c + 1], limit);
        }
        totalWays = prefix[compStats.length][need] || 0;
        if (totalWays === 0) return { probs, approx, impossible: true };

        for (let c = 0; c < compStats.length; c++) {
          const st = compStats[c];
          const others = c === 0 ? suffix[1] : (c === compStats.length - 1 ? prefix[c] : convolve(prefix[c], suffix[c + 1], limit));
          for (let t = 0; t < st.cells.length; t++) {
            let num = 0;
            for (let g = 0; g < st.cellGem[t].length; g++) {
              if (!st.cellGem[t][g]) continue;
              const rest = need - g;
              if (rest < 0 || rest > limit) continue;
              num += st.cellGem[t][g] * (others[rest] || 0);
            }
            probs[st.cells[t]] = num / totalWays;
          }
        }
      } else {
        // 未提供总数：只看局部比例
        for (const st of compStats) {
          let denom = 0;
          for (const v of st.perCount) denom += v;
          for (let t = 0; t < st.cells.length; t++) {
            let num = 0;
            for (let g = 0; g < st.cellGem[t].length; g++) num += st.cellGem[t][g];
            probs[st.cells[t]] = denom ? num / denom : null;
          }
        }
      }
      return { probs, approx };
    }

    /* ---------- 3. 主流程 ---------- */
    deduce();
    let res = analyze();
    let promoted = true;
    for (let pass = 0; pass < 3 && promoted; pass++) {
      promoted = false;
      if (!res.probs) break;
      for (let i = 0; i < total; i++) {
        const p = res.probs[i];
        if (p == null) continue;
        if (p >= 1 - 1e-9 && !knownGem[i]) { knownGem[i] = 1; reason[i] = reason[i] || '结合地图宝钻总数推出必然是宝钻'; promoted = true; }
        else if (p <= 1e-9 && !knownSafe[i]) { knownSafe[i] = 1; reason[i] = reason[i] || '结合地图宝钻总数推出必然无宝钻'; promoted = true; }
      }
      if (promoted) { deduce(); res = analyze(); }
    }
    const probs = res.probs;

    /* ---------- 4. 与玩家 × 标记比对 ---------- */
    const markWrong = [];      // × 标了，但推出来是宝钻
    const markRisky = [];      // × 标了，但完全没有依据（概率不低）
    const gemWrong = [];       // 标了宝钻，但推出必然安全
    for (let i = 0; i < total; i++) {
      if (markedX[i]) {
        if (knownGem[i]) markWrong.push({ r: (i / cols) | 0, c: i % cols, i });
        else if (probs[i] != null && probs[i] > 0.02) markRisky.push({ r: (i / cols) | 0, c: i % cols, i, p: probs[i] });
      }
      if (givenGem[i] && knownSafe[i]) gemWrong.push({ r: (i / cols) | 0, c: i % cols, i });
    }
    // × 标记之间/与已知宝钻的硬矛盾
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
