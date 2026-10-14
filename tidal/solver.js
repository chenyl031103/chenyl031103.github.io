/* =====================================================================
   潮汐秘境 · 残局分析器（界面层）
   棋盘状态：-1 未翻开 / 0-8 已翻开数字 / 'G' 钻石 / 'X' × 标记
   ===================================================================== */
(() => {
  'use strict';

  // 各尺寸的钻石总数由活动固定，不可更改
  const GEM_TOTAL = { 8: 20, 10: 30, 12: 45 };
  /* 截图识别有两个引擎：
     · 本机识别（vision.js，零依赖模板匹配）—— 秒级、不联网、不花额度，默认优先
     · 服务器识别（api/parse-board）—— 本机没认准时兜底；只有服务版有 */
  const OCR_SERVER_ON = window.TIDAL_OCR !== false;   // 静态托管版把 window.TIDAL_OCR 设为 false
  const HAS_LOCAL_VISION = !!(window.TidalVision && typeof window.TidalVision.recognize === 'function');
  const OCR_MODE = String(window.TIDAL_OCR_MODE || '').toLowerCase();   // 'local' | 'server' | 'off'
  const LOCAL_OCR = HAS_LOCAL_VISION && OCR_MODE !== 'server' && OCR_MODE !== 'off';
  const SERVER_OCR = OCR_SERVER_ON && OCR_MODE !== 'local' && OCR_MODE !== 'off';
  const OCR_ENABLED = LOCAL_OCR || SERVER_OCR;

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


  let MODAL_REFRESH = null;   // 当前弹窗的"重新打开"函数（切语言时用它把弹窗内容一起刷新）

  /* ---------- 语言（中/英）：静态文案走 data-i18n，动态文案走 t() ---------- */
  const I18N = {
    zh: {
      'doc.title': '《弹壳特攻队》-潮汐秘境计算器',
      'brand.name': '潮汐秘境计算器',
      'brand.tag': '填好残局 → 棋盘上直接标出哪格是钻石、哪格可以标 ×',
      'nav.ocr': '截图识别',
      'nav.help': '使用说明',
      'nav.game': '游戏模式',
      'nav.game.tip': '随便玩玩：潮汐秘境 / 扫雷',
      'map.size': '地图尺寸',
      'palette.label': '单击涂',
      'palette.select': '选中',
      'palette.select.tip': '单击格子只是选中它（不改内容）',
      'palette.x.tip': '点格子标上 / 取消 ×',
      'palette.clear.tip': '单击格子清除',
      'palette.gem.tip': '标记钻石',
      'palette.tip': '单击格子弹取值卡；也可以直接按键盘：0-8 数字、Enter 钻石、X 标×、Delete 清除、方向键移动 · 右键快速标钻石',
      'tools.tip': '调格子大小（自动按屏幕适配）',
      'tools.auto': '自动',
      'tools.auto.tip': '恢复自动适配屏幕',
      'tools.fs': '全屏',
      'tools.fs.tip': '整个工具区全屏（手机上格子更大好点）',
      'chip.left': '剩余宝石',
      'chip.ticketsUnit': '票',
      'chip.costUnit': '钻石',
      'chip.tickets': '用票',
      'chip.cost': '已用钻石',
      'chip.perGem': '平均',
      'chip.perGemUnit': '票/宝石',
      'chip.filled': '已填',
      'chip.cells': '格',
      'rec.label': '建议点击',
      'rec.auto': '自动提示',
      'rec.auto.tip': '录入一个格子后自动提示下一个推荐格（点 0 展开一片时可以关掉，逐个点选）',
      'vb.gem': '钻石',
      'vb.safe': '不是钻石',
      'vb.unknown': '待定',
      'vb.markSafe': '把可确认的格标上 ×',
      'vb.undo': '撤销',
      'vb.frames': '核对完成',
      'vb.frames.tip': '识别导入的格子核对完了：一键去掉金框/红框提示（格子内容不动，可撤销）',
      'vb.undo.tip': '撤销上一步改动（Ctrl+Z）',
      'vb.clear': '重置',
      'vb.clear.tip': '重置整个棋盘（会二次确认；可撤销）',
      'credit.by': '潮汐秘境计算器 · 海出品',
      'credit.wx': '公众号',
      'rb.opened': '翻开的',
      'rb.is': '是：',
      'rec.gem': '钻石',
      'advice.empty': '先把残局填进来，或点右上角「随机玩一盘」体验一下。',
      'advice.full': '棋盘已填满，没有未翻开的格子了。',
      'advice.noclue0': function (w, why) { return '这张图还没开过：先点 ' + w + why + ' —— 翻开后再把盘面抄进来（或直接截图识别）'; },
      'advice.noclue': function (w, why) { return '还没有数字线索：先点 ' + w + why + '，翻开后把翻开的数字/钻石填进来'; },
      'advice.center9': function (r, c) { return '9×9 范围的中心格（' + r + '行' + c + '列）'; },
      'advice.center': function (r, c) { return '棋盘中心（' + r + '行' + c + '列）'; },
      'advice.cell': function (r, c) { return r + '行' + c + '列'; },
      'advice.open3': function (n) { return '，这格周围 3×3 里有 ' + n + ' 格没翻开'; },
      'advice.gem': function (p, why) { return '先点开 ' + p + ' —— 必定是钻石（' + why + '）'; },
      'advice.gemTail': '由数字推出',
      'advice.safe': function (p, why) { return '没有能确定的钻石；先翻开 ' + p + '（必定不是钻石，可扩开线索）—— ' + why; },
      'advice.needClue': '还没有数字线索：先把已翻开的格子和钻石填进来。',
      'advice.gamble': function (hi, hp, why, lo) { return '推不出确定格子：想赌分翻 ' + hi + '（含钻石 ' + hp + '%' + why + '），想探线索翻 ' + lo; },
      'advice.dig': function (hi, hp, why, safe) { return '没有能确定的钻石：想挖钻石就点 ' + hi + '（含钻石 ' + hp + '%' + why + '）；想稳一点先翻开 ' + safe + '（必定不是钻石，可扩开线索）'; },
      'advice.safeSuffix': function (p, q) { return p + '（' + q + '%）'; },
      'advice.dash': '—',
      'gb.left': '剩余', 'gb.mines': '颗雷', 'gb.found': '已找到钻石', 'gb.opened': '已翻开',
      'gb.marks': '× 标记', 'gb.wrong': '其中标错', 'gb.wrongUnit': '个',
      'gb.restart': '重开一局', 'gb.switch': '换玩法', 'gb.quit': '退出游戏',
      'ocr.title': '截图识别 · 自动填入棋盘',
      'ocr.none': '这个版本没有截图识别',
      'ocr.drop1': '1. 把截图拖进来 / 粘贴 / 选文件',
      'ocr.dropHere': '拖到这里，或 <b>Ctrl+V</b> 粘贴，或',
      'ocr.chooseFile': '选择文件',
      'ocr.changeImg': '换一张',
      'ocr.size1': '2. 确认这张图是哪一档地图',
      'ocr.sizeFootAuto': '默认「自动」判尺寸，认不准时再手动指定。',
      'ocr.go1': '3. 开始识别',
      'ocr.go': '识别并填入棋盘（自动判尺寸）',
      'ocr.goN': function (n) { return '识别并填入（' + n + '×' + n + '）'; },
      'ocr.cancel': '取消识别',
      'ocr.waitPick': '先把截图拖进来或粘贴',
      'ocr.ready': '图片已就绪 —— 点「识别并填入」就行',
      'ocr.recognizing': '识别中… 正在本机识别（不用服务器）',
      'ocr.switchServer': '本机没认准，改用服务器识别…',
      'ocr.previewTitle': '识别结果 · 先看网格对没对齐',
      'ocr.previewH4': '对照预览：红线要正好压在格缝上',
      'ocr.nudgeTip': '红线偏了：直接拖预览图四角的黄点框住棋盘外框（松手自动重算）；也可以用下面的按钮每次挪 1/4 格。',
      'ocr.applyH4': '没问题就填进棋盘',
      'ocr.apply': '应用到棋盘',
      'ocr.back': '换一张重来',
      'ocr.applyTip': '填进去以后每格都能再手动改；识别没把握的格子会带红框提醒。',
      'ocr.crossH4': '和游戏里的计数对一下',
      'ocr.applyDone': '已填进棋盘，逐格核对一下吧',
      'ocr.weakTitle': '这次没读出内容',
      'ocr.badTitle': '识别结果可能不对',
      'ocr.failTitle': '本机没能认出棋盘',
      'game.chooserTitle': '游戏模式',
      'game.tidalH4': '💎 潮汐秘境',
      'game.tidalDesc': '从空盘开始玩、不限次数。<b>双击</b>翻开格子，<b>单击</b>标 × 做记号（× = "这里没有钻石"）；数字是周围 8 格的钻石数，把钻石全找出来。',
      'game.mineH4': '🚩 扫雷',
      'game.mineDesc': '<b>单击</b>翻开、<b>右键或长按</b>循环标记（🚩 → ❓ → 无）、<b>双击</b>已翻开的数字格可以快速翻开周围；第一次点击保证安全，翻开所有不是雷的格子就通关。',
      'game.gemsUnit': function (n) { return n + ' 颗钻石'; },
      'game.minesUnit': function (n) { return n + ' 颗雷'; },
      'game.adviceMine': '单击翻开 · 右键或长按循环标记（🚩 → ❓ → 无）· 双击数字格快速翻开周围 · 数字 = 周围 8 格的雷数',
      'game.adviceTidal': '双击翻开（不限次数）· 单击标 × 做记号 · 数字 = 周围 8 格的钻石数',
      'game.winMine': '通关了！',
      'game.loseMine': '踩到雷了',
      'game.winTidal': '钻石全找出来了！',
      'game.again': '再来一局',
      'game.quitToastMine': '已退出扫雷',
      'game.quitToast': '已退出游戏模式',
      'reset.armed': '再点一次确认重置',
      'reset.done': '已重置棋盘 · 可撤销',
      'reset.empty': '棋盘本来就是空的',
      'ocr.crossOk': function (a, b, c) { return '截图里写着 <b>' + a + '/' + b + '</b>（已收集/总数）：识别出 <b>' + c + '</b> 颗钻石、总数 ' + b + ' —— 两边对得上，交叉核对通过。'; },
      'ocr.crossSize': function (a, b, nx, tot) { return '<b>尺寸可能选错了</b>：截图里写的是 ' + a + '/' + b + '，而 ' + nx + '×' + nx + ' 的总数应该是 ' + tot + '。请核对地图档位后重新识别。'; },
      'ocr.crossBad': function (a, b, c) { return '截图里写着 <b>' + a + '/' + b + '</b>，但识别出 <b>' + c + '</b> 颗钻石，两者不一致 —— 可能有格子读错了，重点核对钻石格（金框）。'; },
      'ocr.doneAuto': function (nx, filled, miss, un) { return '识别完成（自动判定 ' + nx + '×' + nx + '）：读出 ' + filled + ' 格，未翻开 ' + miss + ' 格' + (un ? '，' + un + ' 处待核对' : ''); },
      'ocr.constrained': function (n) { return '；其中 ' + n + ' 处按盘面约束复核过（红框，照着游戏画面确认一下）'; },
      'ocr.doneLocal': function (ms, nx, miss) { return '本机识别完成（' + ms + ' 毫秒，自动判定 ' + nx + '×' + nx + '），还有 ' + miss + ' 个没翻开的格子'; },
      'ocr.unopenedMsg': function (w) { return '这张图还没开过：先点 ' + w; },
      'ocr.unopenedToast': function (w) { return '没开过的图：先点 ' + w; },
      'game.nameTidal': '潮汐秘境', 'game.nameMine': '扫雷',
      'game.level1': '初级', 'game.level2': '中级', 'game.level3': '高级',
      'game.barTidal': function (n2, g) { return '潮汐秘境 · ' + n2 + '×' + n2 + ' · 共 ' + g + ' 颗钻石（不限次数）'; },
      'game.barMine': function (name, r, c, m) { return '扫雷 · ' + name + ' ' + r + '×' + c + ' · 共 ' + m + ' 颗雷'; },
    },
    en: {
      'doc.title': 'Survivor.io · Tidal Realm Solver',
      'brand.name': 'Tidal Realm Solver',
      'brand.tag': 'Fill in the board → it marks which cells are gems and which are safe',
      'nav.ocr': 'Screenshot OCR',
      'nav.help': 'Help',
      'nav.game': 'Play mode',
      'nav.game.tip': 'Just for fun: Tidal Realm / Minesweeper',
      'map.size': 'Map size',
      'palette.label': 'Click to paint',
      'palette.select': 'Select',
      'palette.select.tip': 'Clicking a cell only selects it (no change)',
      'palette.x.tip': 'Toggle × mark',
      'palette.clear.tip': 'Click a cell to clear it',
      'palette.gem.tip': 'Mark as gem',
      'palette.tip': 'Click a cell to open the value card; or use keys: 0-8 digit, Enter gem, X mark, Delete clear, arrows move · right-click = gem',
      'tools.tip': 'Cell size (auto-fits the screen by default)',
      'tools.auto': 'Auto',
      'tools.auto.tip': 'Back to auto-fit',
      'tools.fs': 'Fullscreen',
      'tools.fs.tip': 'Fullscreen the whole tool area',
      'chip.left': 'Gems left',
      'chip.ticketsUnit': 'tickets',
      'chip.costUnit': 'diamonds',
      'chip.tickets': 'Tickets',
      'chip.cost': 'Diamonds spent',
      'chip.perGem': 'avg',
      'chip.perGemUnit': 'tickets/gem',
      'chip.filled': 'Filled',
      'chip.cells': 'cells',
      'rec.label': 'Suggested',
      'rec.auto': 'Auto-hint',
      'rec.auto.tip': 'After entering a value, hint the next suggested cell (turn off when opening a big 0 area)',
      'vb.gem': 'gems',
      'vb.safe': 'safe',
      'vb.unknown': 'undecided',
      'vb.markSafe': 'Mark all certain-safe as ×',
      'vb.undo': 'Undo',
      'vb.undo.tip': 'Undo last change (Ctrl+Z)',
      'vb.frames': 'Checked',
      'vb.frames.tip': 'Done checking the imported cells: hide the gold/red frames (board contents unchanged, undoable)',
      'vb.clear': 'Reset',
      'vb.clear.tip': 'Clear the whole board (undoable)',
      'credit.by': 'Tidal Realm Solver · by Hai',
      'credit.wx': 'WeChat',
      'rb.opened': 'Cell',
      'rb.is': 'is:',
      'rec.gem': 'GEM',
      'advice.empty': 'Fill in the board first, or try "Play mode" at the top right.',
      'advice.full': 'Board is full — no unrevealed cells left.',
      'advice.noclue0': function (w, why) { return 'Fresh map: start with ' + w + why + ' — then copy the board in (or use screenshot OCR).'; },
      'advice.noclue': function (w, why) { return 'No number clues yet: start with ' + w + why + ', then fill in what you revealed.'; },
      'advice.center9': function (r, c) { return 'the center of the 9×9 area (R' + r + 'C' + c + ')'; },
      'advice.center': function (r, c) { return 'the board center (R' + r + 'C' + c + ')'; },
      'advice.cell': function (r, c) { return 'R' + r + 'C' + c; },
      'advice.open3': function (n) { return ', ' + n + ' of its 3×3 neighbours are unrevealed'; },
      'advice.gem': function (p, why) { return 'Open ' + p + ' — it must be a gem (' + why + ')'; },
      'advice.gemTail': 'from the numbers',
      'advice.safe': function (p, why) { return 'No certain gem; open ' + p + ' first (definitely safe, expands clues) — ' + why; },
      'advice.needClue': 'No clues yet: fill in the revealed numbers and gems first.',
      'advice.gamble': function (hi, hp, why, lo) { return 'Nothing certain: gamble on ' + hi + ' (' + hp + '% gem' + why + '), or explore ' + lo; },
      'advice.dig': function (hi, hp, why, safe) { return 'No certain gem: dig ' + hi + ' (' + hp + '% gem' + why + '); or play safe and open ' + safe + ' (definitely no gem, expands clues)'; },
      'advice.safeSuffix': function (p, q) { return p + ' (' + q + '%)'; },
      'advice.dash': '—',
      'gb.left': 'Mines left', 'gb.mines': '', 'gb.found': 'Gems found', 'gb.opened': 'Opened',
      'gb.marks': '× marks', 'gb.wrong': 'wrong', 'gb.wrongUnit': '',
      'gb.restart': 'Restart', 'gb.switch': 'Change mode', 'gb.quit': 'Quit',
      'ocr.title': 'Screenshot OCR · auto-fill the board',
      'ocr.none': 'This build has no OCR',
      'ocr.drop1': '1. Drop / paste / pick a screenshot',
      'ocr.dropHere': 'Drop it here, or <b>Ctrl+V</b>, or',
      'ocr.chooseFile': 'Choose file',
      'ocr.changeImg': 'Change image',
      'ocr.size1': '2. Map size',
      'ocr.sizeFootAuto': 'Defaults to Auto; pick a size manually only if the auto-detect looks wrong.',
      'ocr.go1': '3. Recognize',
      'ocr.go': 'Recognize & fill in (auto size)',
      'ocr.goN': function (n) { return 'Recognize & fill in (' + n + '×' + n + ')'; },
      'ocr.cancel': 'Cancel',
      'ocr.waitPick': 'Drop or paste a screenshot first',
      'ocr.ready': 'Image ready — just hit Recognize',
      'ocr.recognizing': 'Recognizing on this device (no server)…',
      'ocr.switchServer': 'Local recognition failed, trying the server…',
      'ocr.previewTitle': 'Result · check the grid alignment',
      'ocr.previewH4': 'The red lines should sit right on the grid seams',
      'ocr.nudgeTip': 'If the lines are off, drag the yellow corner dots on the preview to frame the board (re-runs on release); or nudge with the buttons below (1/4 cell per step).',
      'ocr.applyH4': 'Looks right → fill the board',
      'ocr.apply': 'Apply to board',
      'ocr.back': 'Pick another image',
      'ocr.applyTip': 'Every cell stays editable afterwards; uncertain cells get a red frame.',
      'ocr.crossH4': 'Cross-check with the in-game counter',
      'ocr.applyDone': 'Filled in — verify the cells',
      'ocr.weakTitle': 'Nothing was read',
      'ocr.badTitle': 'The result may be wrong',
      'ocr.failTitle': 'Could not find the board',
      'game.chooserTitle': 'Play mode',
      'game.tidalH4': '💎 Tidal Realm',
      'game.tidalDesc': 'Start from an empty board with unlimited digs. <b>Double-click</b> to reveal, <b>single click</b> to mark × ("no gem here"). Numbers count the gems in the 8 neighbours — find them all.',
      'game.mineH4': '🚩 Minesweeper',
      'game.mineDesc': '<b>Click</b> to reveal, <b>right-click / long-press</b> to cycle marks (🚩 → ❓ → none), <b>double-click</b> a number to open around it. The first click is always safe.',
      'game.gemsUnit': function (n) { return n + ' gems'; },
      'game.minesUnit': function (n) { return n + ' mines'; },
      'game.adviceMine': 'Click to reveal · right-click/long-press to cycle marks · double-click a number to open around it · number = mines in the 8 neighbours',
      'game.adviceTidal': 'Double-click to reveal (unlimited) · single click marks × · number = gems in the 8 neighbours',
      'game.winMine': 'Cleared!',
      'game.loseMine': 'Boom — you hit a mine',
      'game.winTidal': 'All gems found!',
      'game.again': 'Play again',
      'game.quitToastMine': 'Minesweeper closed',
      'game.quitToast': 'Play mode closed',
      'reset.armed': 'Click again to confirm',
      'reset.done': 'Board reset · undoable',
      'reset.empty': 'Board was already empty',
      'ocr.crossOk': function (a, b, c) { return 'The screenshot says <b>' + a + '/' + b + '</b> (collected/total) and we read <b>' + c + '</b> gems with total ' + b + ' — cross-check passed.'; },
      'ocr.crossSize': function (a, b, nx, tot) { return '<b>Wrong map size?</b> The screenshot says ' + a + '/' + b + ' but a ' + nx + '×' + nx + ' map has ' + tot + '. Please re-check the size and recognize again.'; },
      'ocr.crossBad': function (a, b, c) { return 'The screenshot says <b>' + a + '/' + b + '</b> but we read <b>' + c + '</b> gems — mismatch; double-check the gem cells (gold frames).'; },
      'ocr.doneAuto': function (nx, filled, miss, un) { return 'Done (auto-detected ' + nx + '×' + nx + '): ' + filled + ' cells read, ' + miss + ' unrevealed' + (un ? ', ' + un + ' to verify' : ''); },
      'ocr.constrained': function (n) { return '; ' + n + ' re-checked against board constraints (red frames)'; },
      'ocr.doneLocal': function (ms, nx, miss) { return 'Recognized on-device in ' + ms + ' ms (auto ' + nx + '×' + nx + '), ' + miss + ' unrevealed cells left'; },
      'ocr.unopenedMsg': function (w) { return 'Fresh map: start with ' + w; },
      'ocr.unopenedToast': function (w) { return 'Fresh map: start with ' + w; },
      'game.nameTidal': 'Tidal Realm', 'game.nameMine': 'Minesweeper',
      'game.level1': 'Easy', 'game.level2': 'Medium', 'game.level3': 'Hard',
      'game.barTidal': function (n2, g) { return 'Tidal Realm · ' + n2 + '×' + n2 + ' · ' + g + ' gems (unlimited digs)'; },
      'game.barMine': function (name, r, c, m) { return 'Minesweeper · ' + name + ' ' + r + '×' + c + ' · ' + m + ' mines'; },
    },
  };
  let LANG = 'zh';
  try { LANG = localStorage.getItem('tidal_lang') === 'en' ? 'en' : 'zh'; } catch (e) { LANG = 'zh'; }
  function t(key) {
    const dict = I18N[LANG] || I18N.zh;
    let v = dict[key];
    if (v === undefined) v = I18N.zh[key];
    if (typeof v === 'function') return v.apply(null, Array.prototype.slice.call(arguments, 1));
    return v === undefined ? key : v;
  }
  function setLang(next) {
    LANG = next === 'en' ? 'en' : 'zh';
    try { localStorage.setItem('tidal_lang', LANG); } catch (e) {}
    applyLang();
  }
  function applyLang() {
    document.documentElement.setAttribute('lang', LANG === 'en' ? 'en' : 'zh-CN');
    document.title = t('doc.title');
    for (const el2 of document.querySelectorAll('[data-i18n]')) el2.textContent = t(el2.dataset.i18n);
    for (const el2 of document.querySelectorAll('[data-i18n-title]')) el2.title = t(el2.dataset.i18nTitle);
    const bz = document.getElementById('btn-lang-zh'), be = document.getElementById('btn-lang-en');
    if (bz) bz.classList.toggle('is-on', LANG === 'zh');
    if (be) be.classList.toggle('is-on', LANG === 'en');
    const cb = document.getElementById('btn-clear');
    if (cb && !cb.classList.contains('is-armed')) {
      const lab = cb.querySelector('[data-i18n="vb.clear"]');
      if (lab) lab.textContent = t('vb.clear');
    }
    if (MODAL_REFRESH && el.modal && !el.modal.hidden) MODAL_REFRESH();   // 开着的弹窗一起换语言
    if (!S.game && S.grid && S.grid.length) analyze();   // 动态文案（建议条/结论条）重绘
  }

  const OCR_SERVICE = resolveOcrService();
  const DOUBLE_MS = 340;   // 两次按下间隔小于此值算「双击」（涂色笔刷下双击 = 弹取值卡）

  /* 服务器识别的候选地址（按序尝试）：
     · 服务版：同源 api/parse-board
     · 静态版：构建时写入的隧道地址（?ocr= 可临时覆盖）
     本地识别能用时不走这里；本地失败才作为兜底。 */
  function serverOcrUrls() {
    const out = [];
    if (OCR_MODE !== 'local' && /^https?:$/.test(location.protocol)) out.push('api/parse-board');
    if (OCR_SERVICE) out.push(OCR_SERVICE.replace(/\/+$/, '') + '/api/parse-board');
    return out.filter((u, i) => out.indexOf(u) === i);
  }

  // 页脚上方的相关链接：静态版列出「带识别」的网址，服务版列出「静态版」网址
  const OCR_FALLBACK = 'http://chenyl.free.idcfengye.com/';
  const GATEWAY_URL = 'https://chenyl031103.github.io';
  // 页脚不再列"相关网址"：现在主要入口就是 chenyl031103.github.io/tidal（静态版自带本机识别）
  function renderSiteLinks() {}

  const $ = (s) => document.querySelector(s);
  const el = {
    board: $('#board'),
    boardScroll: $('#board-scroll'),
    boardShell: $('#board-shell'),
    stage: $('#stage'),
    cellMinus: $('#cell-minus'),
    cellPlus: $('#cell-plus'),
    cellAuto: $('#cell-auto'),
    boardFs: $('#board-fs'),
    sizeSeg: $('#size-seg'),
    gemTotalText: $('#gem-total-text'),
    gemLeft: $('#gem-left'),
    recRow: $('#rec-row'),
    recChips: $('#rec-chips'),
    cbAutoNext: $('#cb-auto-next'),
    ticketsUsed: $('#tickets-used'),
    perGem: $('#per-gem'),
    diamondsUsed: $('#diamonds-used'),
    filled: $('#filled-count'),
    cellTotal: $('#cell-total'),
    palette: $('#palette'),
    advice: $('#advice'),
    adviceText: $('#advice-text'),
    revealBar: $('#reveal-bar'),
    rbTarget: $('#rb-target'),
    rbValues: $('#rb-values'),
    rbHint: $('#rb-hint'),
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
    cursorManual: false,  // 选中框是否被用户"亲手点过"（没点过就一直吸附在推荐格上）
    pressBackup: null,    // 记录按下前的值，供双击时回滚
    // 手动格子大小（px）：0 = 自动适配屏幕；非 0 时固定该尺寸（localStorage 记忆）
    manualCell: (() => { const v = Number(localStorage.getItem('tidal_cell_px') || 0); return Number.isFinite(v) && v > 0 ? v : 0; })(),
    history: [],          // 撤销栈：每项是「那一步之前」的盘面快照
    histBase: null,       // 本次操作开始前的快照，抬手时才入栈（拖动连涂算一步）
    autoNext: true,       // 录入后自动跳到下一个推荐格（可在建议条上关掉）
    importTimer: null,
    importPreviewUrl: null,
    ocrBlob: null,        // 待识别的图片（送服务器的压缩版）
    ocrFile: null,        // 原图（本机识别用，清晰度更好）
    localFail: null,      // 本机识别失败的原因（用于给出针对性提示）
    shotSize: 8,          // 识别时确认的地图尺寸
    ocrCanceled: false,
    pasteBound: false,
  };

  /* ---------- 工具 ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const coord = (r, c) => (LANG === 'en' ? `R${r + 1}C${c + 1}` : `${r + 1}行${c + 1}列`);

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
    // 手动模式：用户点过「格子大小 −/+」，固定尺寸（棋盘放不下就滚动），不再自动缩放
    if (S.manualCell) {
      const cell = clamp(S.manualCell, 14, 120);
      el.board.style.setProperty('--gap', gap + 'px');
      el.board.style.setProperty('--cell', cell + 'px');
      el.board.style.setProperty('--font', Math.round(cell * 0.54) + 'px');
      renderAuxLines();        // 手动调格子大小也要把辅助虚线摆过去（原来这里直接 return，虚线留在旧位置）
      return cell;
    }
    const cs = getComputedStyle(el.boardScroll);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    const availW = Math.max(180, el.boardScroll.clientWidth - padX - 2);
    let cell = Math.floor((availW - gap * (cols - 1)) / cols);

    const rect = el.boardScroll.getBoundingClientRect();
    // 下方留给建议条 + 结论条，取值条浮在格子旁边（fixed 定位，不占文档流）
    const pal = document.querySelector('.palette');
    const below = (pal ? pal.offsetHeight + 10 : 0) +          // 笔刷栏（手机上会换成两行）
                  (el.advice ? el.advice.offsetHeight : 30) +
                  (document.querySelector('#rec-row') && !document.querySelector('#rec-row').hidden
                    ? document.querySelector('#rec-row').offsetHeight : 0) +
                  (document.querySelector('.verdict-bar') ? document.querySelector('.verdict-bar').offsetHeight : 48) + 96;
    const availH = Math.max(160, Math.max(window.innerHeight * 0.5, window.innerHeight - rect.top - below - padY) - 0);
    const byH = Math.floor((availH - gap * (rows - 1)) / rows);
    if (byH > 0) cell = Math.min(cell, byH);

    // 默认就让整盘完整放下（手机也一样）：宁可格子小一点，也不出现横向滚动。
    // 想放大就用右下角「格子大小 ＋」——手动模式保持尺寸，放不下时才滚动。
    const minCell = cols >= 24 ? 22 : (window.innerWidth <= 640 ? 16 : 34);   // 手机上"整盘放下"优先，桌面维持原来的 34px 下限
    const applyCell = (v) => {
      el.board.style.setProperty('--gap', gap + 'px');
      el.board.style.setProperty('--cell', v + 'px');
      el.board.style.setProperty('--font', Math.round(v * 0.54) + 'px');
    };
    cell = clamp(cell, minCell, 78);
    applyCell(cell);
    // 自纠：算完之后若仍出现横向滚动（常见于纵向滚动条刚出现、可用宽度又少了十几像素），
    // 按多出来的宽度再缩一次（最多两轮）——手机端保证整盘放得下
    for (let k = 0; k < 2; k++) {
      const over = el.boardScroll.scrollWidth - el.boardScroll.clientWidth;
      if (over <= 1) break;
      const next = clamp(cell - (Math.floor(over / cols) + 1), minCell, 78);
      if (next === cell) break;
      cell = next;
      applyCell(cell);
    }
    renderAuxLines();          // 格子尺寸变了，辅助虚线要跟着摆
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
    if (!S.auxObserver && typeof ResizeObserver !== 'undefined') {
      S.auxObserver = new ResizeObserver(() => renderAuxLines());
      S.auxObserver.observe(el.board);
    }
    if (el.cellTotal) el.cellTotal.textContent = rows * cols;
    fitBoard();
    renderAuxLines();
    paint();
  }

  /**
   * 棋盘辅助虚线：把棋盘三等分（12×12 → 4+4+4，即 4×4 的九宫格）。
   * 用"格子的实际位置"算线位，所以和格子大小、间距无关，窗口缩放后也准。
   */
  function renderAuxLines() {
    const { rows, cols } = S;
    if (!el.board) return;
    let aux = el.board.querySelector('.aux-lines');
    if (!aux) {
      aux = document.createElement('div');
      aux.className = 'aux-lines';
      aux.setAttribute('aria-hidden', 'true');
      el.board.appendChild(aux);
    }
    aux.textContent = '';
    if (rows < 6 || cols < 6) return;
    const at = (r, c) => S.nodes[r * cols + c];
    const boundX = (k) => {                    // 第 k 列左边界的 x（px，相对棋盘左上角）
      if (k <= 0) return 0;
      if (k >= cols) return el.board.clientWidth;
      const a = at(0, k - 1), b = at(0, k);
      const ae = a.offsetLeft + a.offsetWidth;
      return ae + (b.offsetLeft - ae) / 2;
    };
    const boundY = (k) => {
      if (k <= 0) return 0;
      if (k >= rows) return el.board.clientHeight;
      const a = at(k - 1, 0), b = at(k, 0);
      const ae = a.offsetTop + a.offsetHeight;
      return ae + (b.offsetTop - ae) / 2;
    };
    // 12×12：分成九块（每块 4×4，即三等分）；8×8 / 10×10：只画一个"十字"从中间分开
    const nine = cols >= 12 && rows >= 12;
    const outerC = nine ? Math.max(1, Math.round(cols / 3)) : Math.floor(cols / 2);
    const outerR = nine ? Math.max(1, Math.round(rows / 3)) : Math.floor(rows / 2);
    const xs = nine ? [outerC, cols - outerC] : [outerC];
    const ys = nine ? [outerR, rows - outerR] : [outerR];
    for (const k of xs) {
      if (k <= 0 || k >= cols) continue;
      const i = document.createElement('i');
      i.className = 'aux-v';
      i.style.left = boundX(k) + 'px';
      aux.appendChild(i);
    }
    for (const k of ys) {
      if (k <= 0 || k >= rows) continue;
      const i = document.createElement('i');
      i.className = 'aux-h';
      i.style.top = boundY(k) + 'px';
      aux.appendChild(i);
    }
  }

  function newGrid(rows, cols) {
    return Array.from({ length: rows }, () => new Array(cols).fill(-1));
  }

  function paint() {
    const { rows, cols, grid } = S;
    // 游戏模式下不叠加任何分析标记（否则会把上一次分析的结果画到游戏盘上）
    const res = S.game ? null : S.result;
    const hasClue = boardHasClue();
    const showProb = hasClue && parseFloat(getComputedStyle(el.board).getPropertyValue('--cell')) >= 26;
    // 概率画在"没有数字线索的格子"上（未翻开且不是数字/钻石/×）：概率本身就只是这些格子的性质
    const isClue = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) isClue[r * cols + c] = 1;
      }
    }
    const clueLess = (i) => !isClue[i];
    // 选中框跟住推荐格：只要用户没亲手点过别的格子（且「自动提示」开着），
    // 选中框就始终停在"建议点击"的那一格上，和闪烁框重合。
    if (!S.game && S.autoNext && !S.cursorManual && res) {
      const h = pickHotCell(res);
      if (h >= 0) S.cursor = h;
    }

    // 金色闪烁 = "这格最可能是钻石"：依次取
    //   ① 已经能确定的钻石（直接去挖）② 概率最高的那一格（赌一把的靶子）
    // 空盘/还没线索时退化成"第一手点哪"（棋盘中心）。
    // 注意：不闪"必定安全"的格子 —— 那种格子是"稳着探线索"用的，和目标用户预期不符。
    let hot = -1;
    if (!S.game && S.autoNext) {          // 关掉「自动提示」＝不再闪烁提示框（建议仍在下方文字里）
      if (res) hot = pickHotCell(res);
      // 兜底（概率全 0 / 没有候选）：还是给个"第一手"——棋盘中心
      if (hot < 0) hot = Math.round((rows - 1) / 2) * cols + Math.round((cols - 1) / 2);
    }

    let filled = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const node = S.nodes[i];
        if (!node) continue;
        const v = grid[r][c];
        if (v !== -1 && !(typeof v === 'number' && !Number.isFinite(v))) filled++;   // NaN 不算已填

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
          cls += ' n' + v; text = String(v);      // 0 也显示（灰色，最不显眼）
        }
        if (i === hot) {
          cls += ' is-hot';
          // 闪烁颜色跟着"这一格现在的概率档位"走：高=红、中=黄、低=蓝（和格子里的百分比标签同色系）
          let tier = 'mid';
          if (v === 'G' || (res && res.knownGem && res.knownGem[i])) tier = 'hi';
          else if (res && res.probs && res.probs[i] != null) {
            const p = res.probs[i];
            const pct = Math.round(p * 100);
            tier = (p >= 0.995 || pct >= 67) ? 'hi' : (p <= 0.005 || pct < 33) ? 'lo' : 'mid';
          }
          node.dataset.hot = tier;
        } else if (node.dataset.hot) node.dataset.hot = '';
        if (S.aiCells.has(i)) cls += ' is-ai';
        if (S.unsure.has(i)) cls += ' is-unsure';
        if (S.awaiting === i) cls += ' awaiting';

        // 结论用「符号」表达，不再画框：绿 √ = 必定是钻石，红 × = 工具推导的「不是钻石」提示，蓝 × = 自己打上的「不是钻石」
        let badge = '';
        let content = null;   // 覆盖格子内容（隐藏格才用）
        if (res) {
          const marked = v === 'X';
          if (marked) {
            // 自己标了 ×（= 已确认没钻石），而且推导也支持 → 就是蓝叉，不再加东西
            if (res.knownGem && res.knownGem[i]) { cls += ' say-conflict'; badge = '!'; }
          } else if (res.knownGem && res.knownGem[i] && v !== 'G') {
            cls += ' say-gem';
            content = '<svg class="tileico tile-full" aria-hidden="true"><use href="#uw-tile-check"/></svg>';
          } else if (res.knownSafe && res.knownSafe[i]) {
            // 工具推导"必定不是钻石"：不画 X，直接按概率格显示 0%（蓝瓦片 + 角标）
            cls += ' say-prob prob-lo';
            badge = '0%';
          } else if (res.probs && res.probs[i] != null && showProb && clueLess(i)) {
            const p = res.probs[i];
            // 分档以「显示出来的整数百分比」为准，避免出现"显示33%却是低概率蓝色"这种不一致
            const pct = Math.round(p * 100);
            const near1 = p >= 0.995, near0 = p <= 0.005;
            cls += ' say-prob ' + (near1 || (!near0 && pct >= 67) ? 'prob-hi' : (near0 || pct < 33) ? 'prob-lo' : 'prob-mid');
            badge = near1 ? '≈1' : near0 ? '≈0' : pct + '%';
          }
          if (res.pick && res.pick.i === i) cls += ' pick';
          if (S.cursor === i) cls += ' cursor';
        }

        if (node.className !== cls) node.className = cls;
        // 潮汐秘境用素材图标画格子（未翻开/数字/钻石/×），扫雷模式保持原来的方块风
        // 扫雷模式保持原来的方块风；潮汐秘境（含它的游戏模式）用素材图标
        const art = artReady() && (!S.game || S.game.kind !== 'mine') ? cellArt(v) : null;
        const key = content ? 'v:' + content : (art || text || (typeof v === 'string' ? v : ''));
        if (node.dataset.k !== key) {
          node.dataset.k = key;
          node.innerHTML = content ? content
            : art ? art
            : v === 'G' ? '<svg class="tileico tile-gem" aria-hidden="true"><use href="#uw-gem"/></svg>'
            : v === 'X' ? '<svg class="tileico tile-fill" aria-hidden="true"><use href="#uw-tile-x"/></svg>'
            : v === 'D' ? '<svg class="tileico tile-gem" aria-hidden="true"><use href="#uw-gem"/></svg>'
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
    if (el.filled) el.filled.textContent = filled;
    S.filledCount = filled;
    updateCostChips(grid);
  }

  /* 潮汐秘境的格子画法：用 sweeper-icons.js 注入的 uw-* 精灵（和游戏原画同风格） */
  // 精灵注入后才有 #uw-gem；没有（例如 Node 测试）就退回原来的画法
  function artReady() { return typeof document !== 'undefined' && !!document.getElementById('uw-gem'); }
  // 素材叉（不带瓦片）：颜色由 CSS 的 --mk-* 决定 —— 工具推导的提示是红叉（素材默认色），
  // 自己打上的是蓝叉（.is-marked）
  function markXIco(extra) { return `<svg class="tileico mark-x ${extra || ''}" aria-hidden="true"><use href="#uw-mark-x"/></svg>`; }  // 拿不到这个符号时（老缓存的 sweeper-icons.js / Node 测试）退回灰色 ×
  function hasMarkX() { return typeof document !== 'undefined' && !!document.getElementById('uw-mark-x'); }
  function cellArt(v) {
    const full = (id) => `<svg class="tileico tile-full" aria-hidden="true"><use href="#${id}"/></svg>`;
    const flat = (id) => `<svg class="tileico tile-full" aria-hidden="true"><use href="#uw-flat"/><use href="#${id}"/></svg>`;
    if (v === -1) return full('uw-tile-unk');                  // 没翻开
    if (v === 'X') {                                           // 玩家自己打上的 ×：空心描边 X（点击确认态）
      return `<svg class="tileico tile-full is-marked" aria-hidden="true"><use href="#uw-tile-x-marked"/></svg>`;
    }
    if (v === 'G' || v === 'D') return flat('uw-gem');         // 钻石（已翻开底 + 钻石）
    if (typeof v === 'number' && v >= 0 && v <= 8) {
      // 数字：原画瓦片底 + 文字数字 —— 字重/配色跟笔刷栏那一排一致
      // （原画数字字形自带黑色投影，在 34~44px 的格子上又粗又糊，不用它）
      return `<svg class="tileico tile-full" aria-hidden="true"><use href="#uw-flat"/></svg>`
        + `<span class="v-num">${v}</span>`;
    }
    return null;                                               // 其他（扫雷的 F/Q/B/H 等）交给原来的画法
  }

  /* ---------- 分析 ---------- */
  /**
   * 金色闪烁/建议的目标格：
   *   ① 已经能确定是钻石的格 → 直接去挖；
   *   ② 否则取概率最高的格；概率并列时优先"未打开 3×3 的正中心"
   *      （周围 9 格全没翻开 → 翻一下最多能带出 9 格新线索，比在角落里瞎点强）；
   *   ③ 再没有就取并列组里求解器排最后的那个（保持和建议条一致）；
   *   ④ 概率全为 0 / 盘上没线索 → 返回 -1（空盘由调用方退回"棋盘中心"）。
   */
  function pickHotCell(res) {
    if (!res) return -1;
    if (res.pick && res.pick.type === 'gem' && res.pick.i != null) return res.pick.i;
    const und = res.undecided || [];
    if (!und.length) return -1;
    let maxP = 0;
    for (const u of und) if (u.p > maxP) maxP = u.p;
    if (!(maxP > 0)) return -1;
    const cands = und.filter((u) => u.p >= maxP - 1e-9);
    const midR = (S.rows - 1) / 2, midC = (S.cols - 1) / 2;
    // 在"没翻开"的格子里挑点下去收益最大的：
    //   ① 3×3 里没翻开的格数最多 —— "3×3 正中心"（9 格全没开）只是它的特例；
    //      中局往往没有整片没开的地方，所以退一步取"周围没开的最多"那格，
    //      比角落/边缘格更可能一翻带出好几格新线索。
    //   ② 其次看 5×5 里没翻开的格数；③ 再按离棋盘中心近。
    const openedCount = (r, c, rad) => {
      let n = 0;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= S.rows || cc >= S.cols) continue;
          if (S.grid[rr][cc] === -1) n++;               // -1 = 还没翻开（数字/钻石/× 都算已定）
        }
      }
      return n;
    };
    let best = -1, bestScore = -Infinity;
    for (const u of cands) {
      const o3 = openedCount(u.r, u.c, 1);
      const o5 = openedCount(u.r, u.c, 2);
      // 用"取整后的正中那格"作参照，空盘时结果稳定落在棋盘中心，不会因浮点并列乱跳
      const score = o3 * 1000 + o5 * 10 - (Math.abs(u.r - Math.round(midR)) + Math.abs(u.c - Math.round(midC)));
      if (score > bestScore) { bestScore = score; best = u.i; }
    }
    if (best >= 0) return best;
    return cands[cands.length - 1].i;
  }

  // 盘上有没有数字线索（没有任何数字时求解器给不出建议，只能提示"第一手点哪"）
  function boardHasClue() {
    for (let r = 0; r < S.rows; r++) {
      for (let c = 0; c < S.cols; c++) {
        const v = S.grid[r][c];
        if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) return true;
      }
    }
    return false;
  }

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
    // 再算一遍「不信任 ×」，用来发现标错的 × 和数字证明不了的 ×；
    // 盘上没有 × 标记时两次结果完全相同，直接复用省一半计算
    const hasMarks = (() => {
      for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) if (S.grid[r][c] === 'X') return true;
      return false;
    })();
    S.resultNoMarks = hasMarks ? window.TidalSolver.solve(Object.assign({}, base, { trustMarks: false })) : res;
    S.result = res;
    paint();
    renderPanels(res);
    updateUndoBtn();
    updateFramesBtn();
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

  // 这格周围 3×3 里"没翻开"的格数（用来解释"为什么点这格"）
  function openAround3(r, c) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= S.rows || cc >= S.cols) continue;
        if (S.grid[rr][cc] === -1) n++;
      }
    }
    return n;
  }

  /** 一行建议条（始终显示在棋盘下方） */
  function adviceLine(res) {
    const c = res.counts;
    if (S.filledCount === 0 || !boardHasClue()) {
      // 空盘 / 还没有数字线索：求解器给不出建议，直接告诉他第一手点哪（和闪烁同一格）
      const idx = pickHotCell(res);
      const r0 = idx >= 0 ? ((idx / S.cols) | 0) : Math.round((S.rows - 1) / 2);
      const c0 = idx >= 0 ? (idx % S.cols) : Math.round((S.cols - 1) / 2);
      const cr = r0 + 1, cc = c0 + 1;
      const isCenter = r0 === Math.round((S.rows - 1) / 2) && c0 === Math.round((S.cols - 1) / 2);
      const where = isCenter
        ? (S.rows >= 9 ? t('advice.center9', cr, cc) : t('advice.center', cr, cc))
        : t('advice.cell', cr, cc);
      const o3 = openAround3(r0, c0);
      const why = o3 >= 6 ? t('advice.open3', o3) : '';
      return {
        kind: 'safe',
        text: S.filledCount === 0 ? t('advice.noclue0', where, why) : t('advice.noclue', where, why),
      };
    }
    if (c.hiddenCells === 0) return { kind: '', text: t('advice.full') };
    const pick = res.pick;
    if (!pick) return { kind: '', text: t('advice.needClue') };
    if (pick.type === 'gem') {
      return { kind: 'gem', text: t('advice.gem', coord(pick.r, pick.c), pick.why || t('advice.gemTail')) };
    }
    if (pick.type === 'safe') {
      const hiIdx = pickHotCell(res);
      const hi = hiIdx >= 0 ? (res.undecided || []).find((u) => u.i === hiIdx) : null;
      if (hi && hi.p > 0) {
        const o3 = openAround3(hi.r, hi.c);
        const why = o3 >= 6 ? t('advice.open3', o3) : '';
        return { kind: 'warn', text: t('advice.dig', coord(hi.r, hi.c), Math.round(hi.p * 100), why, coord(pick.r, pick.c)) };
      }
      return { kind: 'safe', text: t('advice.safe', coord(pick.r, pick.c), pick.why || t('advice.gemTail')) };
    }
    // 赌的目标要和金色闪烁用同一格（并列时优先"未打开 3×3 的正中心"）
    const hiIdx = pickHotCell(res);
    const hi = (hiIdx >= 0 && (res.undecided || []).find((u) => u.i === hiIdx)) || pick;
    // 注意比下标、别比对象（pick 是展开出来的新对象，引用永远不会相等）
    const lo = (hi.i === pick.i) ? (pick.alt || (res.undecided || [])[0]) : pick;
    const o3 = openAround3(hi.r, hi.c);
    const why = o3 >= 6 ? t('advice.open3', o3) : '';
    return {
      kind: 'warn',
      text: t('advice.gamble', coord(hi.r, hi.c), Math.round(hi.p * 100), why,
        lo ? t('advice.safeSuffix', coord(lo.r, lo.c), Math.round(lo.p * 100)) : t('advice.dash')),
    };
  }

  /** 推荐坐标 chips 已按要求去掉（"下面建议点击的那些坐标去掉"）；保留空实现，调用点不用改 */
  function renderRecChips(res) {
    if (el.recRow) el.recRow.hidden = true;
    return;
  }
  function renderRecChipsOld(res) {
    if (!el.recRow || !el.recChips) return;
    const cands = [];
    if (res && !S.game) {
      if (res.certainGems && res.certainGems.length) {
        for (const g of res.certainGems.slice(0, 6)) cands.push({ i: g.i, r: g.r, c: g.c, p: 1, gem: true });
      } else if (res.undecided && res.undecided.length) {
        const sorted = res.undecided.slice().sort((a, b) => b.p - a.p || a.i - b.i);
        for (const u of sorted.slice(0, 6)) cands.push({ i: u.i, r: u.r, c: u.c, p: u.p });
      }
    }
    if (!cands.length) { el.recRow.hidden = true; el.recChips.innerHTML = ''; return; }
    el.recRow.hidden = false;
    el.recChips.innerHTML = cands.map((x) =>
      `<button class="rec-chip${x.gem ? ' is-gem' : ''}${S.cursor === x.i ? ' is-on' : ''}" data-i="${x.i}" type="button">`
      + `(${x.r + 1},${x.c + 1}) ${x.gem ? t('rec.gem') : Math.round(x.p * 100) + '%'}</button>`).join('');
  }

  function renderPanels(res) {
    const c = res.counts;
    el.vbGem.textContent = c.certainGems;
    el.vbSafe.textContent = c.certainSafe;
    el.vbUnknown.textContent = c.undecided;

    /* 建议条 */
    const adv = adviceLine(res);
    el.adviceText.textContent = adv.text;
    el.advice.className = 'advice' + (adv.kind ? ' is-' + adv.kind : '');
    renderRecChips(res);

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
    if (mode === 'erase' || S.brush === 'hide') v = -1;               // 右键 / 清除笔刷 → 清除为未翻开
    else if (S.brush === 'X') v = S.grid[r][c] === 'X' ? -1 : 'X';    // 单击 = 切换 ×（与游戏一致）
    else v = S.brush === 'G' ? 'G' : Number(S.brush);
    if (!(v === -1 || v === 'X' || v === 'G' || (typeof v === 'number' && Number.isFinite(v)))) v = -1;  // 兜底：绝不让 NaN 进棋盘
    if (S.grid[r][c] === v && !S.aiCells.has(i)) return;
    S.grid[r][c] = v;
    S.aiCells.delete(i);
    S.unsure.delete(i);
    analyze();
  }

  /* ---------- 取值卡：选择这一格翻出来是什么（单击格子弹出） ---------- */
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
    S.cursor = i;   // 光标同步到这格：高亮只出现在一个格子上，不会出现"两个框"
    el.rbTarget.textContent = coord(r, c);
    const btns = [];
    for (let v = rng.min; v <= rng.max; v++) {
      btns.push('<button class="rb-btn" data-val="' + v + '" type="button" title="' + (v === 0 ? '空白（0）' : '数字 ' + v) + '">' + v + '</button>');
    }
    btns.push('<button class="rb-btn rb-gem" data-val="G" type="button" title="钻石"><svg class="ico"><use href="#ico-gem"/></svg></button>');
    btns.push('<button class="rb-btn" data-val="X" type="button" title="× 标记">×</button>');
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
    positionRevealBar();
  }

  /* 把取值卡挪到正在取值那一格的旁边：优先格子下方，放不下换上方，再不行夹在视口内；小箭头对准格子 */
  function positionRevealBar() {
    if (S.awaiting < 0 || el.revealBar.hidden) return;
    const node = S.nodes[S.awaiting];
    if (!node) return;
    const cell = node.getBoundingClientRect();
    const bar = el.revealBar.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 14, pad = 8;   // 与格子的距离留一点空，不贴脸
    const below = cell.bottom + gap + bar.height <= vh - pad;   // 下方放得下才放下面
    let top = below ? cell.bottom + gap : cell.top - bar.height - gap;
    if (top < pad) top = pad;
    if (top + bar.height > vh - pad) top = Math.max(pad, vh - bar.height - pad);
    let left = cell.left + cell.width / 2 - bar.width / 2;      // 水平居中对齐该格
    left = Math.max(pad, Math.min(left, vw - bar.width - pad));
    el.revealBar.style.left = Math.round(left) + 'px';
    el.revealBar.style.top = Math.round(top) + 'px';
    // 小箭头：贴近格子那一侧，水平对准格子中心（并夹在卡片范围内）
    el.revealBar.classList.toggle('arrow-top', below);
    el.revealBar.classList.toggle('arrow-bottom', !below);
    const ax = Math.round(cell.left + cell.width / 2 - left - 6);
    el.revealBar.style.setProperty('--arrow-x', Math.max(12, Math.min(ax, Math.round(bar.width - 24))) + 'px');
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
    mark();                       // 这整段算一步（起点＝第一次按下之前）
    S.grid[r][c] = v;
    S.aiCells.delete(i);
    S.unsure.delete(i);
    closeRevealBar();
    analyze();
    settle();
    autoAdvance();
  }

  /**
   * 录入后自动跳到"下一个推荐格"（可在建议条上关掉）：
   * 跳到新推荐格并直接弹出取值卡，连续录入不用点来点去。
   */
  function autoAdvance() {
    if (!S.autoNext || S.game) return;
    if (S.awaiting >= 0) return;                 // 用户已经在别的格子上取值了
    const res = S.result;
    if (!res) return;
    const next = pickHotCell(res);
    if (next < 0 || next === S.cursor) return;
    S.cursor = next;
    paint();
    try { S.nodes[next].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    // 不自动弹取值卡：点下方数字/×/钻石 才是主输入方式（弹窗留着双击用）
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
    S.cursorManual = false;                                   // 盘面变了：选中框重新吸附到推荐格
    const top = S.history[S.history.length - 1];
    if (top && sameSnap(top, base)) return false;             // 与上一步起点相同，去重
    S.history.push(base);
    if (S.history.length > HIST_MAX) S.history.shift();
    updateUndoBtn();
    persist();
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

  // 「核对完成」：识别导入的框（金=识别填的，红=待核对）核对完了一键清掉（§18.3 问题 B-2）
  function updateFramesBtn() {
    const b = $('#btn-clear-frames');
    if (b) b.hidden = !(S.aiCells.size || S.unsure.size);
  }

  function clearFrames() {
    if (!S.aiCells.size && !S.unsure.size) return;
    mark();
    S.aiCells.clear();
    S.unsure.clear();
    analyze();
    settle();
    toast(LANG === 'en' ? 'Frames cleared — board unchanged.' : '识别框已清除（格子内容没动，可撤销）', 'gold');
  }

  function undo() {
    // 取值栏开着：这一步还没定下来，先当「取消这次翻开」
    if (S.awaiting >= 0) { closeRevealBar(); return true; }
    settle();
    if (!S.history.length) { toast('没有可撤销的操作'); updateUndoBtn(); return false; }
    const s = S.history.pop();
    S.rows = s.rows; S.cols = s.cols;
    S.gemTotal = s.gemTotal;
    setGemTotalDisplay();
    if (el.sizeSeg) el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.rows));
    S.grid = s.grid.map((row) => row.slice());
    S.aiCells = new Set(s.ai);
    S.unsure = new Set(s.unsure);
    buildBoard();
    analyze();
    persist();
    toast(LANG === 'en' ? 'Undone' : '已撤销上一步');
    return true;
  }

  /* ---------- 盘面持久化：刷新 / 微信切后台被系统回收后，自动恢复 ---------- */
  const STATE_KEY = 'tidal_state_v1';
  const STATE_V = 1;
  const STATE_HIST_MAX = 40;      // 只带最近若干步撤销记录，够用又省空间
  let persistTimer = null;

  function persistNow() {
    persistTimer = null;
    if (S.game) return;                                     // 游戏模式的盘面不覆盖计算器存档
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        v: STATE_V, at: Date.now(),
        rows: S.rows, cols: S.cols, gemTotal: S.gemTotal,
        grid: S.grid,
        ai: Array.from(S.aiCells),
        unsure: Array.from(S.unsure),
        history: S.history.slice(-STATE_HIST_MAX),
      }));
    } catch (e) { /* 无痕模式 / 配额满：静默放弃，不影响使用 */ }
  }

  /** 盘面改动后调用；拖动连涂时最多 0.5 秒写一次盘 */
  function persist() {
    if (S.game) return;
    if (persistTimer) return;
    persistTimer = setTimeout(persistNow, 500);
  }

  /** 页面要走了（刷新 / 切后台）立刻落盘，别等节流 */
  function persistFlush() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistNow();
  }

  /** 启动时读档；成功返回 true（坏档/旧版本静默丢弃） */
  function restoreState() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || d.v !== STATE_V) return false;
    if (!(d.rows === d.cols && [8, 10, 12].indexOf(d.rows) >= 0)) return false;
    if (!Array.isArray(d.grid) || d.grid.length !== d.rows) return false;
    for (const row of d.grid) {
      if (!Array.isArray(row) || row.length !== d.cols) return false;
      for (const x of row) {
        const ok = x === -1 || x === 'G' || x === 'X' || x === 'D'
          || (typeof x === 'number' && x >= 0 && x <= 8);
        if (!ok) return false;
      }
    }
    S.rows = d.rows; S.cols = d.cols;
    S.gemTotal = Number.isFinite(d.gemTotal) ? d.gemTotal : GEM_TOTAL[d.rows];
    S.grid = d.grid.map((row) => row.slice());
    S.aiCells = new Set(Array.isArray(d.ai) ? d.ai : []);
    S.unsure = new Set(Array.isArray(d.unsure) ? d.unsure : []);
    S.history = Array.isArray(d.history) ? d.history : [];
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

      // 双击 = 打开取值卡（可选路径：手机想用弹窗选值时用它；平时直接点下方数字更快）
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
      S.cursorManual = true;   // 亲手点过 → 先停在他点的格子上（填完值再回到推荐格）
      if (S.brush === 'select') {
        // 选中笔刷：单击只选中这一格（不改内容，也不弹窗）—— 之后点下方数字 / 按键盘都能快速填入
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
    if (el.recChips) {
      el.recChips.addEventListener('click', (e) => {
        const b = e.target.closest('.rec-chip');
        if (!b) return;
        const i = Number(b.dataset.i);
        if (!Number.isFinite(i) || i < 0) return;
        S.cursor = i;
        openRevealBar(i);
      });
    }
    if (el.cbAutoNext) {
      el.cbAutoNext.addEventListener('change', () => {
        S.autoNext = !!el.cbAutoNext.checked;
        toast(S.autoNext ? '已开启：录入后自动提示下一个推荐格' : '已关闭自动提示', '');
        paint();          // 立刻生效：关掉就不再闪烁提示框

      });
    }

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
    // 页面滚动 / 窗口变化时，取值条跟着目标格子走
    window.addEventListener('resize', () => { if (S.awaiting >= 0) positionRevealBar(); });
    window.addEventListener('scroll', () => { if (S.awaiting >= 0) positionRevealBar(); }, true);

    // 笔刷
    el.palette.addEventListener('click', (e) => {
      const b = e.target.closest('.brush');
      if (!b) return;
      const val = b.dataset.brush;
      if (val == null) return;              // 撤销/重置这类动作按钮：只管自己的 click，不改笔刷
      S.brush = val;
      el.palette.querySelectorAll('.brush').forEach((x) => x.classList.toggle('is-on', x === b));
      // 点下方数字 / × / 钻石 = 立刻填进"当前目标格"（选中的格子；还没选就填推荐那格），
      // 不用再"先点格子、再从弹窗里选一遍"。之后这个笔刷保持选中，可以直接连着点别的格子刷。
      if (S.game || val === 'select') return;
      const target = S.cursor >= 0 ? S.cursor : pickHotCell(S.result);
      if (target < 0) return;
      const v = val === 'hide' ? -1 : (val === 'G' || val === 'X') ? val : Number(val);
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      const r = (target / S.cols) | 0, c = target % S.cols;
      mark();
      S.grid[r][c] = v;
      S.aiCells.delete(target);
      S.unsure.delete(target);
      S.cursor = target;
      closeRevealBar();
      paint();
      analyze();
      settle();
      autoAdvance();
    });

    // 尺寸
    el.sizeSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      setSize(Number(b.dataset.size));
    });

    // 一键把推导出的「必定不是钻石」格标上 ×
    // 语言：中文 / EN
    const bz = $('#btn-lang-zh'), be = $('#btn-lang-en');
    if (bz) bz.addEventListener('click', () => setLang('zh'));
    if (be) be.addEventListener('click', () => setLang('en'));

    // 顶栏
    $('#btn-help').addEventListener('click', openHelp);
    $('#btn-shot-open').addEventListener('click', openShotModal);
    // 重置：点第一次变成"再点一次确认"，3 秒没点就还原（防误触）
    let resetArmed = 0;
    const clearBtn = $('#btn-clear');
    const resetLabel = () => {
      const lab = clearBtn.querySelector('[data-i18n="vb.clear"]') || clearBtn;
      lab.textContent = resetArmed ? t('reset.armed') : t('vb.clear');
    };
    clearBtn.addEventListener('click', () => {
      const now = Date.now();
      if (!resetArmed || now - resetArmed > 3000) {
        resetArmed = now;
        clearBtn.classList.add('is-armed');
        resetLabel();
        setTimeout(() => {
          if (resetArmed && Date.now() - resetArmed >= 3000) { resetArmed = 0; clearBtn.classList.remove('is-armed'); resetLabel(); }
        }, 3200);
        return;
      }
      resetArmed = 0;
      clearBtn.classList.remove('is-armed');
      resetLabel();
      if (S.game) { S.game = null; updateGameBar(); }
      mark();
      clearAll();
      toast(settle() ? t('reset.done') : t('reset.empty'));
    });
    $('#btn-undo').addEventListener('click', undo);
    const framesBtn = $('#btn-clear-frames');
    if (framesBtn) framesBtn.addEventListener('click', clearFrames);
    const wxBtn = $('#btn-wx');
    if (wxBtn) {
      wxBtn.addEventListener('click', () => {
        const id = 'chenyl031103';
        const done = () => toast((LANG === 'en' ? 'Copied WeChat ID: ' : '已复制公众号：') + id, 'gold');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(done, () => fallback());
        } else fallback();
        function fallback() {
          try {
            const ta = document.createElement('textarea');
            ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            done();
          } catch (e) { toast('公众号：' + id, 'gold'); }
        }
      });
    }
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
      // 只有"真在输入文字"的控件才忽略快捷键 —— 勾选框（如「自动提示」）和按钮不该让键盘失灵
      const tt = e.target;
      const typing = tt && (tt.tagName === 'TEXTAREA' ||
        (tt.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file)$/i.test(tt.type || 'text')) ||
        tt.isContentEditable);
      if (typing) return;
      if (!el.modal.hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!S.game) undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (S.game) return;                 // 游戏模式下不响应填值快捷键

      const cols = S.cols, rows = S.rows;
      const setCell = (v) => {
        if (S.cursor < 0) {
          // 和"点下面那排数字"一致：还没选就落到推荐格（没有再退回棋盘中心）
          const h = pickHotCell(S.result);
          S.cursor = h >= 0 ? h : Math.floor(rows / 2) * cols + Math.floor(cols / 2);
        }
        const r = (S.cursor / cols) | 0, c = S.cursor % cols;
        mark();
        S.grid[r][c] = v;
        S.aiCells.delete(S.cursor);
        S.unsure.delete(S.cursor);
        paint();
        analyze();
        settle();
        closeRevealBar();
        autoAdvance();
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
      // 焦点在面板按钮（笔刷/撤销/重置等，格子和格子本身除外）上时，Enter/空格按原生行为走，
      // 免得"按一下既触发按钮又填一格"
      if (k === 'Enter' && tt && tt.tagName === 'BUTTON' && !tt.classList.contains('cell')) return;
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

    // 格子大小手动调节（− / ＋ / 自动）与棋盘全屏
    const currentCellPx = () => parseFloat(getComputedStyle(el.board).getPropertyValue('--cell')) || 42;
    const setManualCell = (px) => {
      S.manualCell = px ? clamp(px, 14, 120) : 0;
      try {
        if (S.manualCell) localStorage.setItem('tidal_cell_px', String(S.manualCell));
        else localStorage.removeItem('tidal_cell_px');
      } catch (e) {}
      if (el.cellAuto) el.cellAuto.classList.toggle('is-on', !S.manualCell);
      fitBoard();
      paint();
      if (S.awaiting >= 0) positionRevealBar();
    };
    if (el.cellMinus) el.cellMinus.onclick = () => setManualCell((S.manualCell || currentCellPx()) - 2);
    if (el.cellPlus) el.cellPlus.onclick = () => setManualCell((S.manualCell || currentCellPx()) + 2);
    if (el.cellAuto) {
      el.cellAuto.classList.toggle('is-on', !S.manualCell);
      el.cellAuto.onclick = () => setManualCell(0);
    }
    if (el.boardFs) el.boardFs.onclick = () => {
      // 全屏整个工具栏+棋盘区域（含笔刷栏、取值卡、提示弹窗都在里面，全屏下功能完整）
      const stage = el.stage || document.querySelector('.stage');
      if (!document.fullscreenElement) {
        if (stage && stage.requestFullscreen) stage.requestFullscreen().catch(() => showToast('当前浏览器不支持全屏'));
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', () => {
      const on = !!document.fullscreenElement;
      if (el.boardFs) el.boardFs.textContent = on ? '退出全屏' : '全屏';
      setTimeout(() => { fitBoard(); paint(); if (S.awaiting >= 0) positionRevealBar(); }, 80);
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
    setGemTotalDisplay();
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
    persist();          // 清空也算一次盘面变化（刷新后是空盘，不会把清掉的旧盘恢复回来）
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
    1: { name: '初级', lv: 1, rows: 9, cols: 9, mines: 10 },
    2: { name: '中级', lv: 2, rows: 16, cols: 16, mines: 40 },
    3: { name: '高级', lv: 3, rows: 16, cols: 30, mines: 99 },
  };

  function openGameChooser() { openModalWith(gameChooserHtml, openGameChooser); }
  function gameChooserHtml() {
    const tidalBtns = TIDAL_SIZES
      .map((n) => `<button class="ghost-btn sm" data-play="tidal" data-arg="${n}" type="button">${n}×${n} · ${t('game.gemsUnit', GEM_TOTAL[n])}</button>`)
      .join('');
    const mineBtns = Object.keys(MINE_LEVELS)
      .map((k) => {
        const lv = MINE_LEVELS[k];
        return `<button class="ghost-btn sm" data-play="mine" data-arg="${k}" type="button">${t('game.level' + k)} ${lv.rows}×${lv.cols} · ${t('game.minesUnit', lv.mines)}</button>`;
      })
      .join('');
    return `
      <div class="modal-head">
        <h3>${t('game.chooserTitle')}</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>${t('game.tidalH4')}</h4>
          <p>${t('game.tidalDesc')}</p>
          <div class="modal-actions">${tidalBtns}</div>
        </section>
        <section>
          <h4>${t('game.mineH4')}</h4>
          <p>${t('game.mineDesc')}</p>
          <div class="modal-actions">${mineBtns}</div>
        </section>
      </div>`;
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
    setGemTotalDisplay();
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
        else if (g.marks[i]) {
          // 两套玩法的标记图标不一样：扫雷是 🚩/❓，潮汐秘境是 ×（"这里没有钻石"）
          grid[r][c] = isMineMode ? (g.marks[i] === 'question' ? 'Q' : 'F') : 'X';
        }
        else if (isMineMode) grid[r][c] = 'H';    // 扫雷：没翻开的格子显示 ■
      }
    }
    S.grid = grid;
    S.aiCells.clear();
    S.unsure.clear();
    document.body.classList.toggle('is-mine-game', isMineMode);
    paint();
    updateGameBar();
    setAdvice(isMineMode ? t('game.adviceMine') : t('game.adviceTidal'));
  }

  const gameFlagCount = (g) => Object.keys(g.marks).filter((k) => g.marks[k] === 'flag').length;

  /** 状态栏：玩法标题 + 剩余雷数（或已找到钻石）+ 已翻开 + 计时 */
  function updateGameBar() {
    const bar = $('#game-bar');
    if (bar) bar.hidden = !S.game;
    document.body.classList.toggle('is-game', !!S.game);
    const g = S.game;
    if (!g) {
      stopGameClock();
      const banner0 = $('#game-banner');
      if (banner0) banner0.hidden = true;
      if (BASE_TITLE) document.title = BASE_TITLE;
      return;
    }
    const isMine = g.kind === 'mine';
    const show = (id, on) => { const node = $(id); if (node) node.hidden = !on; };
    const title = $('#gb-title');
    if (title) {
      title.textContent = isMine
        ? t('game.barMine', t('game.level' + g.level), g.rows, g.cols, g.count)
        : t('game.barTidal', g.rows, g.gems);
    }
    // 棋盘正上方的「正在玩」横幅 + 浏览器标签标题，让人一眼知道在玩哪个
    const banner = $('#game-banner');
    if (banner) {
      banner.hidden = false;
      $('#game-banner-name').textContent = isMine
        ? `🚩 正在玩：扫雷（${g.name} ${g.rows}×${g.cols}）`
        : `💎 正在玩：潮汐秘境（${g.rows}×${g.cols}）`;
      $('#game-banner-sub').textContent = isMine
        ? `${g.count} 颗雷 · 单击翻开、右键或长按插旗、双击数字格快速翻开周围`
        : `${g.gems} 颗钻石 · 双击翻开一格、单击标 × 做记号，数字 = 周围钻石数`;
    }
    document.title = isMine ? `扫雷 · ${g.name}（${g.rows}×${g.cols}）— 潮汐秘境计算器` : `潮汐秘境 ${g.rows}×${g.cols} — 潮汐秘境计算器`;
    const hint = $('#gb-hint');
    if (hint) hint.textContent = isMine
      ? '单击翻开 · 右键或长按循环标记 🚩/❓ · 双击数字格快速翻开周围 · 第一次点击保证安全'
      : t('game.adviceTidal');
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
      // 潮汐秘境不是扫雷：双击只翻开这一格，不做 0 区域的连锁展开
      //（真实玩法里每翻一格就是一次探索，不会连带翻开一片）
      g.opened.add(i);
    }
    renderGame();
    if (g.found.size >= g.gems) { g.over = 'shown'; return endGame(true); }
  }

  function endGame(win) {
    const g = S.game;
    if (!g) return;
    const isMine = g.kind === 'mine';
    const secs = g.t0 ? Math.round((Date.now() - g.t0) / 1000) : 0;
    const title = isMine ? (win ? t('game.winMine') : t('game.loseMine')) : t('game.winTidal');
    const lines = isMine
      ? (LANG === 'en'
        ? [`${t('game.level' + g.level)} ${g.rows}×${g.cols}, ${g.count} mines. Time <b>${fmtClock(secs)}</b>, opened <b>${g.opened.size}</b> cells, flags <b>${gameFlagCount(g)}</b>.`,
           win ? 'All safe cells opened — well played.' : 'The mine you hit is revealed, along with the others — compare to see where the read went wrong.']
        : [`${g.name} ${g.rows}×${g.cols}，${g.count} 颗雷。用时 <b>${fmtClock(secs)}</b>，翻开 <b>${g.opened.size}</b> 格，插旗 <b>${gameFlagCount(g)}</b> 个。`,
           win ? '全部安全格都翻开了，漂亮。' : '踩到的那颗雷已经露出来了，其他雷也一并显示，可以对照看看哪里判断错了。'])
      : (LANG === 'en'
        ? [`${g.rows}×${g.cols}, ${g.gems} gems. Opened <b>${g.opened.size}</b> cells — every gem found.`,
           g.wrong ? `${g.wrong} × marks were on actual gems.` : 'And not a single × was wrong.']
        : [`${g.rows}×${g.cols}，共 ${g.gems} 颗钻石。一共翻开 <b>${g.opened.size}</b> 格，钻石全找齐了。`,
           g.wrong ? `中间有 ${g.wrong} 个 × 标在了钻石上（标错了）。` : '而且一个 × 都没标错。']);
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
        <button class="ghost-btn" id="btn-game-again" type="button">${t('game.again')}</button>
        <button class="ghost-btn sm" id="btn-game-other" type="button">${t('gb.switch')}</button>
        <button class="ghost-btn sm" id="btn-game-quit" type="button">${t('gb.quit')}</button>
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
    toast(kind === 'mine' ? t('game.quitToastMine') : t('game.quitToast'), 'gold');
  }

  /* ---------- 主题：与统计中心共用 localStorage 的 theme 键 ---------- */
  function updateThemeIcon(t) {
    const btn = $('#theme-toggle');
    if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
  }

  function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';   // 默认深色（护眼），可在右上角切换
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
  function openModal(html) { MODAL_REFRESH = null; el.modalBox.innerHTML = html; el.modal.hidden = false; }
  function closeModal() { el.modal.hidden = true; MODAL_REFRESH = null; }
  function openModalWith(render, reshow) {
    MODAL_REFRESH = reshow || (() => openModalWith(render, reshow));
    el.modalBox.innerHTML = render();
    el.modal.hidden = false;
  }

  const HELP_SECTIONS = {
    zh: `
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
            <li><b>最快的方式</b>：点一下格子选中它 → <b>点下方那一排数字 / × / 💎</b> 就直接填进去了（填完会自动跳到下一个推荐格，连续抄盘不用来回点）。</li>
            <li><b>连着刷多个格子</b>：先点下方数字 / × / 💎 选好笔刷，再连着点格子，一路刷下去（点「选中」恢复正常）。</li>
            <li><b>键盘</b>：<b>0~8</b> 填数字 · <b>Enter</b> 填钻石 · <b>X</b> 填 × · <b>Delete</b> 清除 · <b>方向键</b>换格子 · <b>Ctrl+Z</b> 撤销</li>
            <li><b>想要弹窗选值</b>：双击格子，格子旁边会弹出取值卡，里面还会提示这格"只能填几到几"。</li>
            <li><b>想快速标钻石</b>：右键格子（手机长按）；填错了按 <b>Ctrl+Z</b> 撤销</li>
            <li><b>格子太小/太大</b>：棋盘右下角「格子大小 −/＋」可手动调（会记住），点「自动」恢复按屏幕适配；点「全屏」让棋盘铺满整个屏幕。</li>
            <li><b>选中框会自动跟着建议格</b>（和闪烁框重合）：你没亲手点别的格子时，它一直停在"该点的那格"上，点下方数字就能一路填下去。</li>
            <li>一整盘抄不完也没关系，先把<b>已经翻开的数字</b>和<b>已经翻出的钻石</b>填上就够用了。</li>
          </ul>
        </section>
        <section>
          <h4>2 · 看棋盘上的符号</h4>
          <ul>
            <li><span class="lg-dot lg-dot-gem">√</span><b>绿色 √ ＝ 这格是钻石</b>，直接去翻它</li>
            <li><span class="lg-dot lg-dot-safe">×</span><b>灰色 × ＝ 这格不是钻石</b>，可以放心</li>
            <li><b>格子中央的百分比</b>＝推不出来时的概率，仅供参考；<b>颜色分三档</b>：<b style="color:#d93a2b">红色＝高概率</b>（值得赌）、<b style="color:#b3770a">琥珀色＝中等</b>、<b style="color:#2f7fbf">蓝色＝低概率</b>（先别碰）</li>
            <li><b>概率只受"与它 3×3 邻域相交的数字"影响</b>：算法会枚举与这格相关的所有数字线索的全部合法摆法，统计这格含钻的比例（组与组互相独立）；远处的数字不影响它。</li>
            <li><b>数字颜色</b>按大小渐变：<b style="color:#8a97a5">0 灰</b> → <b style="color:#3d7fc1">2 蓝</b> → <b style="color:#2f9e5f">4 绿</b> → <b style="color:#e0871f">6 橙</b> → <b style="color:#d02b2b">8 红</b>，笔刷和取值卡里的数字同色</li>
            <li><b>辅助虚线</b>：12×12 分成九块、8×8 / 10×10 画一个十字，方便分区数钻石</li>
          </ul>
        </section>
        <section>
          <h4>3 · 照着棋盘下面那行字做</h4>
          <p>它会直接告诉你下一步点哪一格，例如：<b>「先点开 5行4列 —— 必定是钻石」</b>，照着点就行；棋盘上闪烁的那一格就是它。</p>
        </section>
        <section>
          <h4>填错了怎么办</h4>
          <p>工具会自动检查。哪个数字和周围对不上，上方会提示「N 处数字对不上」，下面「当前盘面」里会列出具体是哪一格，改掉它就好。</p>
        </section>
        <section>
          <h4>关注公众号</h4>
          <p>工具的更新、活动攻略和反馈入口都发在公众号：<b>chenyl031103</b>（点页脚那行也能复制微信号）。用着有问题、想加功能，在公众号里说一声就行。</p>
        </section>`,
    en: `
        <section>
          <h4>0 · Try a game first (optional)</h4>
          <p>Hit <b>Play mode</b> at the top right to play around. Two modes, three map sizes each:</p>
          <ul>
            <li><b>Tidal Realm</b> (double-click to reveal, single click marks ×): start from an empty board, unlimited digs; numbers count the gems in the 8 neighbours — find every gem 💎.</li>
            <li><b>Minesweeper</b> (click to reveal, right-click / long-press to flag 🚩): the classic; the first click is always safe, open every non-mine cell to win.</li>
          </ul>
        </section>
        <section>
          <h4>1 · Copy the board from the game</h4>
          <ul>
            <li><b>Fastest way</b>: click a cell to select it → click a <b>number / × / 💎 below the board</b> to fill it in (it then jumps to the next suggested cell automatically).</li>
            <li><b>Paint many cells</b>: pick a number / × / 💎 first, then keep clicking cells (choose "Select" to stop).</li>
            <li><b>Keyboard</b>: <b>0-8</b> digit · <b>Enter</b> gem · <b>X</b> mark · <b>Delete</b> clear · <b>arrows</b> move · <b>Ctrl+Z</b> undo</li>
            <li><b>Value popup</b>: double-click a cell to open the value card next to it (it also shows the valid range for that cell).</li>
            <li><b>Quick gem mark</b>: right-click a cell (long-press on mobile); <b>Ctrl+Z</b> to undo.</li>
            <li><b>Cell size</b>: use −/＋ at the bottom right of the board (remembered); "Auto" fits the screen; "Fullscreen" fills the screen.</li>
            <li><b>The selection follows the suggested cell</b> (same cell as the flash): unless you click another cell yourself, it always sits on "the next one to open", so you can just keep clicking the numbers below.</li>
            <li>You don't need the whole board — the <b>revealed numbers</b> and <b>found gems</b> are enough.</li>
          </ul>
        </section>
        <section>
          <h4>2 · Reading the board</h4>
          <ul>
            <li><span class="lg-dot lg-dot-gem">√</span><b>Green √ = this cell is a gem</b> — go dig it</li>
            <li><span class="lg-dot lg-dot-safe">×</span><b>Grey × = no gem here</b> — safe</li>
            <li><b>Percentage in a cell</b> = its gem probability when nothing is certain; <b>three colour tiers</b>: <b style="color:#d93a2b">red = high</b> (worth a gamble), <b style="color:#b3770a">amber = medium</b>, <b style="color:#2f7fbf">blue = low</b> (leave it)</li>
            <li><b>Probability only depends on the numbers whose 3×3 area overlaps the cell</b>: the solver enumerates every valid arrangement of those clues (groups are independent); far-away numbers have no effect.</li>
            <li><b>Digit colours</b> ramp with the value: <b style="color:#8a97a5">0 grey</b> → <b style="color:#3d7fc1">2 blue</b> → <b style="color:#2f9e5f">4 green</b> → <b style="color:#e0871f">6 orange</b> → <b style="color:#d02b2b">8 red</b></li>
            <li><b>Auxiliary dashed lines</b>: 12×12 is split into nine 4×4 blocks, 8×8 / 10×10 get a centre cross.</li>
          </ul>
        </section>
        <section>
          <h4>3 · Follow the advice line</h4>
          <p>It tells you the next cell to click, e.g. <b>"Open R5C4 — must be a gem"</b>; the flashing cell on the board is the same one.</p>
        </section>
        <section>
          <h4>If something is wrong</h4>
          <p>The tool checks the board automatically: contradictory numbers are reported at the top, and the board list below shows exactly which cells are off — fix them there.</p>
        </section>
        <section>
          <h4>Follow us</h4>
          <p>Updates, event guides and feedback all go to our WeChat official account: <b>chenyl031103</b> (click the footer line to copy the ID).</p>
        </section>`,
  };

  function openHelp() {
    openModalWith(helpHtml, openHelp);
  }
  function helpHtml() {
    const ocrNote = OCR_ENABLED
      ? ''
      : (LANG === 'en'
        ? '<section><h4>No OCR in this build</h4><p>This build has no backend, so screenshot OCR is unavailable; manual entry still has everything. The OCR-enabled site link is in the "Screenshot OCR" dialog.</p></section>'
        : '<section><h4>这个版本没有截图识别</h4><p>静态托管版没有后端，所以不提供截图识别；手动填写可以用全部功能。想用截图识别，点右上角的<b>「截图识别」</b>按钮，里面有两个带识别功能的网址。</p></section>');
    return `
      <div class="modal-head">
        <h3>${t('nav.help')}</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        ${HELP_SECTIONS[LANG]}
        ${ocrNote}
        <section>
          <h4>${LANG === 'en' ? 'Current board' : '当前盘面'}</h4>
          <div class="detail">${S.detailHtml || '<p class="card-desc">' + (LANG === 'en' ? 'Board is still empty.' : '棋盘还是空的。') + '</p>'}</div>
        </section>
      </div>`;
  }

  /* ---------- 截图识别 ---------- */
  // 顶部"钻石"小标签（总数由地图尺寸固定；截图里读到的计数只用于交叉核对）
  function setGemTotalDisplay() {
    if (el.gemTotalText) el.gemTotalText.textContent = S.gemTotal == null ? '—' : S.gemTotal;
  }

  /* 成本统计：1 票 = 开出（翻到）一格"有内容"的格子（数字或钻石）；× 和没翻开的不算。
     游戏里 1 票 = 1500 钻石，所以"已用钻石 = 票数 × 1500"。 */
  const TICKET_COST = 1500;
  function updateCostChips(grid) {
    const { rows, cols } = S;
    let gems = 0, tickets = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (v === 'G' || v === 'D') { gems++; tickets++; }
        else if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) tickets++;
      }
    }
    const total = Number.isFinite(S.gemTotal) ? S.gemTotal : null;
    if (el.gemLeft) el.gemLeft.textContent = total == null ? '—' : String(Math.max(0, total - gems));
    if (el.ticketsUsed) el.ticketsUsed.textContent = String(tickets);
    if (el.diamondsUsed) el.diamondsUsed.textContent = (tickets * TICKET_COST).toLocaleString('en-US');
    // 平均票/宝石：用票数 ÷ 已找到的钻石数（没找到钻石时显示 —）
    if (el.perGem) el.perGem.textContent = gems > 0 ? (tickets / gems).toFixed(2) : '—';
  }

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
    const tip = LANG === 'en' ? (LOCAL_OCR ? 'on-device, about 1s' : 'usually 10-60s') : (LOCAL_OCR ? '本机识别，一般 1 秒内' : `按 ${sizeLabel} 识别，通常十几秒，忙的时候要一分钟`);
    const line = (s) => `${LANG === 'en' ? 'Recognizing… ' + s + 's' : '识别中… 已用 ' + s + 's'}`
      + (S.ocrStage ? ` · ${S.ocrStage}` : `（${tip}）`);
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
    S.shotSize = 0;      // 0 = 自动判尺寸（默认）
    S.ocrBlob = null;
    S.ocrFile = null;
    showShotModal();
  }

  /** 画截图弹窗（切语言时会重画一次；重画时不动 S 里已选好的图片） */
  function showShotModal() {
    openModalWith(shotModalHtml, showShotModal);
    bindShotModal();
  }

  function shotModalHtml() {
    return `
      <div class="modal-head">
        <h3>${t('ocr.title')}</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>${t('ocr.drop1')}</h4>
          <div class="dropzone" id="dropzone">
            <svg class="ico"><use href="#ico-image"/></svg>
            <span>${t('ocr.dropHere')}</span>
            <button class="btn sm" id="btn-shot" type="button">${t('ocr.chooseFile')}</button>
            <input type="file" id="shot-file" accept="image/*" hidden>
          </div>
          <div class="pick-row" id="pick-row" hidden>
            <img class="pick-thumb" id="pick-thumb" alt="">
            <span class="pick-meta"><b id="pick-name"></b><i id="pick-info"></i></span>
            <button class="btn sm" id="btn-ocr-clear" type="button">${t('ocr.changeImg')}</button>
          </div>
        </section>
        <section>
          <h4>${t('ocr.size1')}</h4>
          <div class="seg seg-sm" id="shot-size-seg">
            <button class="seg-btn" data-size="0" type="button">自动</button>
            <button class="seg-btn" data-size="8" type="button">8×8</button>
            <button class="seg-btn" data-size="10" type="button">10×10</button>
            <button class="seg-btn" data-size="12" type="button">12×12</button>
          </div>
          <p class="card-foot">${t(LOCAL_OCR ? 'ocr.sizeFootAuto' : 'ocr.sizeFootAutoServer')}</p>
        </section>
        <section>
          <h4>${t('ocr.go1')}</h4>
          <div class="go-row">
            <button class="btn" id="btn-ocr-go" type="button" disabled>${t('ocr.go')}</button>
            <button class="btn" id="btn-ocr-cancel" type="button" hidden>${t('ocr.cancel')}</button>
            <span class="import-status" id="import-status">${t('ocr.waitPick')}</span>
          </div>
        </section>
      </div>`;
  }

  function bindShotModal() {
    const seg = $('#shot-size-seg');
    const markSize = () => {
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.shotSize));
      const go = $('#btn-ocr-go');
      if (go && S.ocrBlob) go.textContent = S.shotSize ? t('ocr.goN', S.shotSize) : t('ocr.go');
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
    $('#btn-ocr-go').addEventListener('click', () => { if (S.ocrBlob) recognize(S.ocrFile || S.ocrBlob); });
    $('#btn-ocr-cancel').addEventListener('click', () => {
      S.ocrCanceled = true;
      stopImportClock();
      setGoState(false);
      setImportStatus(LANG === 'en' ? 'Cancelled — hit Recognize again.' : '已取消。可以重新点「开始识别」。', '');
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
    S.ocrFile = null;
    if (S.importPreviewUrl) { try { URL.revokeObjectURL(S.importPreviewUrl); } catch (e) {} S.importPreviewUrl = null; }
    setGoState(false);
    const go = $('#btn-ocr-go');
    if (go) go.textContent = t('ocr.go');
    setImportStatus(t('ocr.waitPick'), '');
  }

  /** 接住一张图片：只显示文件名/大小，等用户确认尺寸后手动开始 */
  async function acceptShot(file) {
    if (!file) return;
    if (S.importTimer) { toast(LANG === 'en' ? 'Recognizing — wait or hit Cancel' : '正在识别中，等它完成或点「取消识别」', 'warn'); return; }
    if (!/^image\//.test(file.type || '')) { setImportStatus(LANG === 'en' ? 'Not an image file' : '这个文件不是图片', 'err'); return; }
    S.ocrCanceled = false;
    const shrunk = await shrinkImage(file, 1000);   // 宽度上限：实测 1000px 最稳（见函数注释）
    S.ocrBlob = shrunk.blob;
    S.ocrFile = file;                               // 本机识别用原图（清晰度优先）

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
    if (go) { go.disabled = false; go.textContent = S.shotSize ? t('ocr.goN', S.shotSize) : t('ocr.go'); }
    setGoState(false);
    setImportStatus(t('ocr.ready'), '');
  }

  /** 本机识别（vision.js 模板匹配）：不用服务器、秒级返回；返回结构与服务端一致 */
  async function recognizeLocal(file, forceN) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('图片打不开（换个格式试试）'));
        im.src = url;
      });
      // 画进 canvas 时把总像素压到 ~450 万以内（手机内存安全；棋盘定位需要原始清晰度，尽量不缩）
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const k = Math.min(1, Math.sqrt(4500000 / Math.max(1, w * h)));
      if (k < 1) { w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      const id = cx.getImageData(0, 0, w, h);
      const t0 = performance.now();
      const r = window.TidalVision.recognize(id, forceN ? { forceN } : {});   // 尺寸优先本地判定，再和用户选的档位核对
      r.localMs = Math.round(performance.now() - t0);
      if (!r.image) r.image = id;   // 旋转识别时 vision 会带回旋转后的图，预览必须用它（坐标才一致）
      return r;
    } finally {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
  }

  /** 服务器识别：POST 拿任务号 + 轮询取结果（长请求会被公网网关掐断） */
  async function recognizeViaServer(blob, size) {
    const urls = serverOcrUrls();
    if (!urls.length) { const e = new Error('没有可用的服务器识别地址'); e.netErr = true; throw e; }
    let lastErr = null;
    for (const base of urls) {
      try {
        return await serverJob(base, blob, size);
      } catch (e) {
        lastErr = e;
        if (!(e && e.netErr)) throw e;   // 业务性错误（尺寸不符等）不换地址重试
      }
    }
    throw lastErr || new Error('服务器识别失败');
  }

  async function serverJob(base, blob, size) {
    const fd = new FormData();
    fd.append('image', blob, 'shot.jpg');
    fd.append('rows', String(size));
    fd.append('cols', String(size));
    const post = async (u, opt) => {
      try { return await fetch(u, opt); }
      catch (e) { const er = new Error('连不上识别服务'); er.netErr = true; throw er; }
    };
    const resp = await post(base, { method: 'POST', body: fd });
    const posted = await resp.json().catch(() => null);
    if (!resp.ok || !posted) throw new Error((posted && posted.error) || `服务返回 ${resp.status}`);
    if (!posted.ok) throw new Error(posted.error || '上传失败');
    const jobId = posted.jobId;
    if (!jobId) throw new Error('服务没有返回任务号');

    let data = null;
    const poll = base.replace(/\/parse-board$/, '') + '/parse-board/';
    for (let i = 0; i < 150; i++) {          // 最长约 5 分钟
      await new Promise((r) => setTimeout(r, 2000));
      if (S.ocrCanceled) return null;
      const r2 = await post(poll + encodeURIComponent(jobId));
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
    if (S.ocrCanceled) return null;
    if (!data) throw new Error('识别超时（超过 5 分钟没有结果）');
    return data;
  }

  /** 识别结果预览 + 网格微调（本地识别专用；网格对不齐时不用重截图） */
  let ocrPrev = null;   // { image: ImageData, grid: {x0,y0,cellX,cellY,n,base}, data }

  function ocrPreviewHtml() {
    return `
      <div class="modal-head">
        <h3>${t('ocr.previewTitle')}</h3>
        <button class="modal-close" data-close type="button">✕</button>
      </div>
      <div class="rules">
        <section>
          <h4>${t('ocr.previewH4')}</h4>
          <div class="ocr-prev"><canvas id="ocr-prev-canvas" width="620" height="420"></canvas></div>
          <div class="ocr-stats" id="ocr-prev-stats"></div>
          <div class="nudge-row">
            <button class="btn sm" data-nudge="x:-1" type="button">← 左移</button>
            <button class="btn sm" data-nudge="x:1" type="button">右移 →</button>
            <button class="btn sm" data-nudge="y:-1" type="button">↑ 上移</button>
            <button class="btn sm" data-nudge="y:1" type="button">下移 ↓</button>
            <button class="btn sm" data-nudge="w:-1" type="button">格宽 −</button>
            <button class="btn sm" data-nudge="w:1" type="button">格宽 ＋</button>
            <button class="btn sm" data-nudge="r:0" type="button">复位</button>
          </div>
          <p class="card-foot">${t('ocr.nudgeTip')}</p>
        </section>
        <section id="ocr-cross-sec" hidden>
          <h4>${t('ocr.crossH4')}</h4>
          <p class="card-foot" id="ocr-cross"></p>
        </section>
        <section>
          <h4>${t('ocr.applyH4')}</h4>
          <div class="go-row">
            <button class="btn" id="btn-ocr-apply" type="button">${t('ocr.apply')}</button>
            <button class="btn sm" id="btn-ocr-back" type="button">${t('ocr.back')}</button>
          </div>
          <p class="card-foot">${t('ocr.applyTip')}</p>
        </section>
      </div>`;
  }

  function ocrDrawPreview(freezeView) {
    const cv = $('#ocr-prev-canvas');
    if (!cv || !ocrPrev) return;
    const { image, grid, data } = ocrPrev;
    const cols = data.cols, rows = data.rows, cells = data.cells;
    let sx, sy, scale, sw, sh, W, H;      // 注意：sw/sh/W/H 要在两支里都赋值，后面 drawImage 用得到（挪进 if 分支会白屏）
    if (freezeView && freezeView.scale) {
      // 拖四角期间固定取景，避免"每动一下取景跟着变"导致手感漂移
      sx = freezeView.sx; sy = freezeView.sy; scale = freezeView.scale;
      W = freezeView.W; H = freezeView.H;
      sw = W / scale; sh = H / scale;
      cv.width = W; cv.height = H;
    } else {
      const pad = 0.05 * grid.n * Math.max(grid.cellX, grid.cellY);
      sx = Math.max(0, grid.x0 - pad); sy = Math.max(0, grid.y0 - pad);
      sw = Math.min(image.width - sx, grid.n * grid.cellX + 2 * pad);
      sh = Math.min(image.height - sy, grid.n * grid.cellY + 2 * pad);
      scale = Math.min(cv.width / sw, cv.height / sh);
      W = Math.max(40, Math.round(sw * scale)); H = Math.max(40, Math.round(sh * scale));
      cv.width = W; cv.height = H;
      ocrPrev.view = { sx, sy, scale, W: cv.width, H: cv.height };
    }
    const g = cv.getContext('2d');
    const tmp = document.createElement('canvas');
    tmp.width = image.width; tmp.height = image.height;
    tmp.getContext('2d').putImageData(image, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.drawImage(tmp, sx, sy, sw, sh, 0, 0, W, H);
    const X = (v) => (v - sx) * scale, Y = (v) => (v - sy) * scale;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,70,70,.95)';
    const bx = X(grid.x0), by = Y(grid.y0);
    const bw = grid.n * grid.cellX * scale, bh = grid.n * grid.cellY * scale;
    for (let k = 0; k <= grid.n; k++) {
      const x = X(grid.x0 + k * grid.cellX), y = Y(grid.y0 + k * grid.cellY);
      g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + bh); g.stroke();
      g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw, y); g.stroke();
    }
    const dot = Math.max(1.5, Math.min(grid.cellX, grid.cellY) * scale * 0.15);
    const cols2 = { gem: '#f0a830', x: '#7fd6f0', num: '#4ecb7a', blank: '#7f93a8' };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = cells[r][c];
        let col = cols2.blank;
        if (v === 9) col = cols2.gem;
        else if (v === 10) col = cols2.x;
        else if (typeof v === 'number' && v >= 0) col = cols2.num;
        g.fillStyle = col;
        g.beginPath();
        g.arc(X(grid.x0 + (c + 0.5) * grid.cellX), Y(grid.y0 + (r + 0.5) * grid.cellY), dot, 0, Math.PI * 2);
        g.fill();
      }
    }
    const gh = $('#ocr-cross');
    if (gh) gh.innerHTML = ocrPrev.crossCheck || '';
    const gsec = $('#ocr-cross-sec');
    if (gsec) gsec.hidden = !ocrPrev.crossCheck;
    const st = $('#ocr-prev-stats');
    if (st) {
      const unsureN = (data.unsure || []).length;
      const gemN = cells.flat().filter((v) => v === 9).length;
      const filled = cells.flat().filter((v) => v !== -1).length;
      st.textContent = `${rows}×${cols} · 读出 ${filled} 格 · 钻石 ${gemN} 颗`
        + ` · 未翻开 ${rows * cols - filled} 格${unsureN ? ` · ${unsureN} 处待核对` : ''}`;
    }
    // 四角黄点：可直接拖拽框住棋盘外框（松手重算）。位置存画布像素，供 pointer 命中
    const cn = grid.n;
    ocrPrev.corners = [
      [grid.x0, grid.y0],
      [grid.x0 + cn * grid.cellX, grid.y0],
      [grid.x0, grid.y0 + cn * grid.cellY],
      [grid.x0 + cn * grid.cellX, grid.y0 + cn * grid.cellY],
    ].map(([ix, iy]) => [X(ix), Y(iy)]);
    const cr = Math.max(4, Math.min(9, Math.min(grid.cellX, grid.cellY) * scale * 0.16));
    g.fillStyle = 'rgba(255,214,0,.95)';
    g.strokeStyle = 'rgba(70,50,0,.6)';
    g.lineWidth = 1.5;
    for (const [qx, qy] of ocrPrev.corners) {
      g.beginPath(); g.arc(qx, qy, cr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  /** 预览图四角拖拽：拖动黄点直接框住棋盘外框，松手用新网格重新识别 */
  function bindOcrCornerDrag(cv) {
    let drag = -1;
    let dragView = null;
    const toImg = (e) => {
      const box = ocrPrev;
      if (!box || !box.view) return null;
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const px = (e.clientX - r.left) * (cv.width / r.width);
      const py = (e.clientY - r.top) * (cv.height / r.height);
      return { px, py, x: box.view.sx + px / box.view.scale, y: box.view.sy + py / box.view.scale };
    };
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      const box = ocrPrev;
      if (!box || !box.corners) return;
      const p = toImg(e);
      if (!p) return;
      let k = -1, bd = 1e9;
      box.corners.forEach(([qx, qy], idx) => {
        const d = Math.hypot(p.px - qx, p.py - qy);
        if (d < bd) { bd = d; k = idx; }
      });
      if (k < 0 || bd > 24) return;                      // 没点到黄点：不拦截，交给普通点击
      drag = k;
      dragView = box.view;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const box = ocrPrev;
      const p = toImg(e);
      if (!box || !p) return;
      const g = box.grid, n = g.n, minC = 6;
      const rightEdge = g.x0 + n * g.cellX, botEdge = g.y0 + n * g.cellY;
      if (drag === 0) {                                  // 左上
        g.x0 = Math.max(0, Math.min(p.x, rightEdge - minC * n));
        g.y0 = Math.max(0, Math.min(p.y, botEdge - minC * n));
      } else if (drag === 1) {                           // 右上
        g.cellX = (Math.max(g.x0 + minC * n, p.x) - g.x0) / n;
        g.y0 = Math.max(0, Math.min(p.y, botEdge - minC * n));
      } else if (drag === 2) {                           // 左下
        g.x0 = Math.max(0, Math.min(p.x, rightEdge - minC * n));
        g.cellY = (Math.max(g.y0 + minC * n, p.y) - g.y0) / n;
      } else {                                           // 右下
        g.cellX = (Math.max(g.x0 + minC * n, p.x) - g.x0) / n;
        g.cellY = (Math.max(g.y0 + minC * n, p.y) - g.y0) / n;
      }
      ocrDrawPreview(dragView);                          // 拖动中先把红线挪到新位置（取景不动）
      e.preventDefault();
    });
    const end = () => {
      if (drag < 0) return;
      drag = -1;
      dragView = null;
      ocrReRun();                                        // 松手后用新网格重新识别
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
  async function ocrReRun() {
    const box = ocrPrev;
    if (!box) return;
    setImportStatus(LANG === 'en' ? 'Re-running with the adjusted grid…' : '正在按微调后的网格重算…', 'busy');
    try {
      const r = window.TidalVision.recognize(box.image, { grid: box.grid });
      ocrPrev = { image: box.image, grid: box.grid, data: r };
      ocrDrawPreview();
      setImportStatus(LANG === 'en' ? 'Done — check the red lines' : '微调完成，看看红线对齐了吗', '');
    } catch (e) {
      setImportStatus('微调失败：' + String((e && e.message) || e).slice(0, 60), 'err');
    }
  }

  function openOcrPreview(data) {
    const g0 = data.debug.grid;
    ocrPrev = {
      image: data.image,
      grid: { x0: g0.x0, y0: g0.y0, cellX: g0.cellX, cellY: g0.cellY, n: g0.n,
        base: { x0: g0.x0, y0: g0.y0, cellX: g0.cellX, cellY: g0.cellY } },
      data,
    };
    delete data.image;
    // 交叉核对：截图里的「已收集/总数」vs 识别结果（钻石数、地图总数）
    const gc = data.gemCounter;
    const gemInBoard = data.cells.flat().filter((v) => v === 9).length;
    const fixedTotal = GEM_TOTAL[data.rows] || 0;
    if (!gc) ocrPrev.crossCheck = '';
    else if (gc.right !== fixedTotal) {
      ocrPrev.crossCheck = t('ocr.crossSize', gc.left, gc.right, data.rows, fixedTotal);
    } else if (gc.left === gemInBoard) {
      ocrPrev.crossCheck = t('ocr.crossOk', gc.left, gc.right, gemInBoard);
    } else {
      ocrPrev.crossCheck = t('ocr.crossBad', gc.left, gc.right, gemInBoard);
    }
    openModal(ocrPreviewHtml());
    const box = $('.modal-box');
    if (box) {
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-nudge]');
        if (b) {
          const g = ocrPrev && ocrPrev.grid;
          if (!g) return;
          const [k, d] = b.dataset.nudge.split(':');
          const num = Number(d) || 0;
          if (k === 'x') g.x0 += num * g.cellX * 0.25;
          else if (k === 'y') g.y0 += num * g.cellY * 0.25;
          else if (k === 'w') { const f = 1 + 0.02 * num; g.cellX *= f; g.cellY *= f; }
          else if (k === 'r') { g.x0 = g.base.x0; g.y0 = g.base.y0; g.cellX = g.base.cellX; g.cellY = g.base.cellY; }
          ocrReRun();
          return;
        }
        if (e.target.closest('#btn-ocr-apply')) {
          const d = ocrPrev && ocrPrev.data;
          ocrPrev = null;
          if (!d) return;
          setImportStatus(t('ocr.applyDone'), '');
          try { applyResult(d, 'local'); }
          catch (err) { setImportStatus(String((err && err.message) || err).slice(0, 90), 'err'); toast('没能填进棋盘，看弹窗提示', 'warn'); }
          return;
        }
        if (e.target.closest('#btn-ocr-back')) { ocrPrev = null; openShotModal(); }
      });
    }
    const cvp = $('#ocr-prev-canvas');
    if (cvp) bindOcrCornerDrag(cvp);
    ocrDrawPreview();
  }

  /** 把识别结果填进棋盘（本地/服务器两条路共用），并按需提示核对 */
  function applyResult(data, how) {
    const size = S.shotSize || 0;      // 0 = 自动档（按识别出来的尺寸填）
    const { rows, cols, cells } = data;
    if (!rows || !cols || !Array.isArray(cells) || cells.length !== rows) throw new Error('识别结果格式不正确');
    if (size && rows !== size) {
      throw new Error(`识别出来是 ${rows}×${cols}，和你选的 ${size}×${size} 不一致 —— 请核对后重选尺寸再识别`);
    }

    mark();   // 整次识别算一步：识别错了可以一键退回识别前的盘面
    S.rows = rows; S.cols = cols;
    el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === rows));
    S.gemTotal = GEM_TOTAL[rows];      // 钻石总数由尺寸固定（截图里的计数只用来交叉核对，见预览面板）
    setGemTotalDisplay();

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
    // 几乎没读出东西：弱模型会把整张盘面都当成空格，这种"成功"必须拦住。
    // 本机识别按它自己的 thin 判定（真实残局常常大半没翻开，用覆盖率卡会误报）
    let filledN = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (S.grid[r][c] !== -1) filledN++;
    const cov = (typeof data.coverage === 'number') ? data.coverage : null;
    const unopened = data.unopened === true;   // 整盘都没翻开：不是识别失败，是"还没开过的图"
    const weak = unopened ? false : (how === 'local'
      ? (filledN === 0 || data.thin === true)
      : (filledN === 0 || data.thin === true || filledN < Math.max(6, Math.round(rows * rows * 0.05)) || (cov != null && cov < 0.6)));
    const missN = rows * cols - filledN;   // 没读出的空格（未翻开 + 空著）
    if (unopened) {
      const cr = Math.round((rows - 1) / 2) + 1, cc = Math.round((cols - 1) / 2) + 1;
      const where = rows >= 9 ? t('advice.center9', cr, cc) : t('advice.center', cr, cc);
      setImportStatus(t('ocr.unopenedMsg', where), '');
      toast(t('ocr.unopenedToast', where), 'gold');
    } else if (weak) {
      setImportStatus('识别完成，但几乎没有读出内容，请重试或手工填写。', 'err');
      openModal(`
        <div class="modal-head">
          <h3>这次没读出内容</h3>
          <button class="modal-close" data-close type="button">✕</button>
        </div>
        <div class="rules">
          <section>
            <p>${rows}×${rows} 一共 ${rows * cols} 格，这次只读出 <b>${filledN}</b> 个已翻开的格子${cov != null ? `（逐格只报回 ${data.reported}/${data.total} 格）` : ''}。</p>
            <p>${how === 'local'
              ? '本机识别没定位到棋盘 —— 多半是截图里棋盘不完整（被裁掉边框/被挡住），或者格子小、图太糊。'
              : '说明识图服务没看清盘面，把大部分格子当成空的了。常见原因是图片太小太糊，或者换了不擅长看密集小字的识图模型。'}</p>
            <p>建议：<b>用清晰的整屏截图重试</b>${how === 'local' ? '（棋盘四周的边框要拍全）' : ''}；还是不行就对照截图手工填写 —— 手工填的盘面分析结果一样准确。</p>
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
      const tip = how === 'local'
        ? t('ocr.doneLocal', data.localMs || 0, rows, missN)
        : null;
      toast(tip || (unsureN ? `识别完成，${unsureN} 处红框请重点核对` : '识别完成，请核对带红框的格子'), 'gold');
      if (how === 'local') {
        const consN = (data.debug && data.debug.constrained) ? data.debug.constrained.length : 0;
        setImportStatus(t('ocr.doneAuto', rows, filledN, missN, unsureN) + (consN ? t('ocr.constrained', consN) : ''), '');
      }
    }
  }

  /** 识别入口：本机优先 → 失败再问服务器（静态版会提示手动填写） */
  async function recognize(file) {
    const size = S.shotSize || 0;      // 0 = 自动判尺寸
    startImportClock(`${size}×${size}`);
    setGoState(true);

    try {
      let data = null, how = '';
      if (LOCAL_OCR) {
        // 先让浏览器画一帧"识别中"，本机识别是同步计算（约 1 秒）。
        // 只等 setTimeout，不用 rAF —— 后台标签页里 rAF 可能一直不触发
        await new Promise((r) => setTimeout(r, 30));
        try {
          data = await recognizeLocal(file || S.ocrBlob);
          how = 'local';
        } catch (e) {
          S.localFail = e;
          const urls = serverOcrUrls();
          if (!urls.length) throw e;
          setImportStatus(t('ocr.switchServer'), 'busy');
        }
        // 本机判定不可靠时（没走外框定位/读得太少），按用户选的档位再对一次格 ——
        // 他对着游戏看得最准；判定可靠时不覆盖，尺寸对不上会直接提示他去改档位
        const autoWeak = data && (data.thin === true || !data.debug || !data.debug.grid || data.debug.grid.src !== 'frame');
        if (autoWeak && data.rows !== size) {
          try {
            const d2 = await recognizeLocal(file || S.ocrBlob, size);
            if (d2 && d2.rows === size && !d2.thin) {
              d2.note = `已按你选的 ${size}×${size} 重新对格`;
              data = d2;
            }
          } catch (e2) { /* 保持第一次的结果，交给下面的尺寸不一致提示 */ }
        }
        if (S.ocrCanceled) return;
      }
      if (!data) {
        data = await recognizeViaServer(S.ocrBlob || file, size || S.rows);
        how = how || 'server';
        if (!data) return;    // 被取消
      }
      // 尺寸对不上时不硬填，给预览面板让用户微调/重新对格
      const sizeBad = size && data.rows !== size;
      // 本机识别：默认直接填盘（自动判尺寸）；只有"认不准"（thin / 定位没走外框 / 尺寸不符）才给预览
      const needPreview = how === 'local' && data.image && data.debug && data.debug.grid &&
        (data.thin === true || data.debug.grid.src !== 'frame' || sizeBad);
      if (needPreview) {
        stopImportClock();
        setImportStatus(t('ocr.previewTitle'), '');
        openOcrPreview(data);
        return;
      }
      applyResult(data, how);
    } catch (err) {
      stopImportClock();
      const msg = String((err && err.message) || err);
      const isNetErr = (err && err.netErr) || (err && err.name === 'TypeError') || /Failed to fetch|NetworkError|load failed/i.test(msg);
      const localFail = LOCAL_OCR && S.localFail === err;
      setImportStatus(
        isNetErr
          ? '连不上识别服务：当前页面可能是静态托管打开的（识别需要服务器）。手动填写不受影响。'
          : msg.slice(0, 90),
        'err'
      );
      toast(isNetErr ? '连不上识别服务（识别需要服务器版）' : '识别失败，看看弹窗里的提示', 'warn');
      // 本机识别失败时给一条可操作的出路：重试 / 去服务器版 / 手工填
      if (localFail) {
        const svc = OCR_SERVICE || OCR_FALLBACK;
        openModal(`
          <div class="modal-head"><h3>本机没能认出棋盘</h3>
            <button class="modal-close" data-close type="button">✕</button></div>
          <div class="rules">
            <section>
              <p>这次本机识别没定位到棋盘（${msg.slice(0, 60)}）。多半是截图<b>没把棋盘拍全</b>，或者格子太小、图太糊。</p>
              <ul>
                <li>截图时<b>把整个棋盘连边框一起截进来</b>（别裁掉四周），尽量用原图不要转发压缩过的图</li>
                <li>确认上面选的档位和截图一致，然后<b>再识别一次</b></li>
                <li>也可以点右上角「截图识别」旁边那个按钮换一张更清晰的图</li>
              </ul>
              <p>实在认不出来也没关系：<b>手动把已翻开的数字和钻石填进棋盘</b>，分析结果一样准确。</p>
              <p class="card-foot">需要时也可以用服务器识别（更慢、要联网）：<a class="btn sm" href="${svc}" target="_blank" rel="noopener">${svc}</a></p>
            </section>
          </div>`);
      }
    } finally {
      S.localFail = null;
      setGoState(false);
      const go = $('#btn-ocr-go');
      if (go) go.textContent = S.shotSize ? t('ocr.goN', S.shotSize) : t('ocr.go');
    }
  }

  /* ---------- 启动 ---------- */
  let BASE_TITLE = '';

  function init() {
    BASE_TITLE = document.title;
    initTheme();
    // 静态托管版：隐藏截图识别入口；两种版本都在页脚上方列出对应网址
    renderSiteLinks();
    S.grid = newGrid(S.rows, S.cols);
    const restored = restoreState();          // 有存档就恢复上次的盘面 + 撤销栈
    setGemTotalDisplay();
    el.sizeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === S.rows));
    el.palette.querySelectorAll('.brush').forEach((b) => b.classList.toggle('is-on', b.dataset.brush === S.brush));
    buildBoard();
    bind();
    bindPasteOnce();   // 任何位置按 Ctrl+V 都能直接开始识别
    if (artReady()) document.body.classList.add('use-tile-art');   // 有素材精灵：格子底色/边框交给图标
    applyLang();       // 静态文案按语言刷一遍（内部会 analyze）
    analyze();
    updateUndoBtn();
    if (restored) toast('已恢复上次的盘面', 'gold');
    // 版面变化（笔刷栏换行、页内滚动条出现/消失、手机地址栏收起、旋转屏幕）后重算格子大小，
    // 保证整盘放得下始终成立；手动调过格子大小就不动（尊重用户选择）
    const scheduleFit = () => { if (fitTimer) return; fitTimer = setTimeout(() => { fitTimer = null; if (!S.manualCell) fitBoard(); }, 120); };
    window.fitTimer = null;
    window.addEventListener('resize', scheduleFit);
    window.addEventListener('orientationchange', scheduleFit);
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(scheduleFit); ro.observe(document.body); if (el.boardScroll) ro.observe(el.boardScroll); }
    window.addEventListener('pagehide', persistFlush);                       // 刷新 / 关闭：立刻落盘
    document.addEventListener('visibilitychange', () => { if (document.hidden) persistFlush(); });   // 切后台被回收前落盘
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
