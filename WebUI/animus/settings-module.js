/* ============================================================
   settings-module.js —— 设置内容（animus/settings-module.js）
   ------------------------------------------------------------
   它只做一件事：把下面那张**表**渲染成 Animus 的四个子页，并维护当前值。
   它不认识 C#、不认识主菜单、不认识游戏：

     数据流（谁调用它，谁负责这一环）
       C# settings.apply   →  AnimusSettings.apply(payload)     写进 current 并重画
       玩家动了控件        →  handlers.changed(payload)          由调用方发给 C#
       C# 落盘后回执       →  再走一次 apply，界面上显示的就是真值

   为什么要有一张表：主菜单页和游戏页都要渲染同一套设置。写两遍 HTML
   必然漂移（改了一边忘了另一边），而"设置能存但读不回来"这类 bug 极难查。
   表在这里，两页共用一份。

   ## 值存的是**物理量**，不是滑杆刻度

   滑杆只是给人"慢 / 快"的直觉。存的是「每字多少毫秒」「音量 0..1」，
   这样 C# 和 JS 拿到就能直接用，中间不需要再解释一次刻度是什么意思。
   ============================================================ */

window.AnimusSettings = (function () {
  'use strict';

  /* ---------- 滑杆区间：改这里等于改"最快/最慢能调到多少" ---------- */
  var SPEED_SLOW_MS = 120;    // 文字速度滑杆 0
  var SPEED_FAST_MS = 8;      // 文字速度滑杆 100
  var AUTO_MIN_MS = 200;      // 自动播放滑杆 0
  var AUTO_MAX_MS = 3000;     // 自动播放滑杆 100
  var BRIGHT_MIN = 0.45;      // 立绘亮度滑杆 0
  var BRIGHT_MAX = 1.55;      // 立绘亮度滑杆 100
  var SAT_MIN = 0;            // 立绘饱和度滑杆 0（完全去色）
  var SAT_MAX = 1.6;          // 立绘饱和度滑杆 100

  /* ============================================================
     出厂默认的那一套主题
     ------------------------------------------------------------
     **第一次打开游戏看到的就是它** —— 剧本 1-1【场景】客厅 / 午后 / 晴，
     故事是从那束光开始的，两个结局收束（5A-3 / 5B-3）也回到同一束光。

     它有两个用处：
       ① 「界面主题」那一行的 def（新装玩家没存过主题时用这个），
          以及 C# 那边 UiSettings.animusTheme 的初值 —— **两处必须一致**。
       ② 最后一道兜底：主题解析链全部落空时用它。
          正常情况下走不到（两边都有白名单夹着）。

     改它要连着改：这里、UiSettings.cs 的 animusTheme 初值。
     （animus.css 里 #animus 那个不带 data-theme 的基础块仍然是"夜"的变量，
       但界面一加载就会写上 data-theme，所以那个块只是给"JS 还没跑"的
       那一瞬间用的，不是默认主题。） */
  var DEFAULT_THEME = 'noon';

  /* ============================================================
     设置表
     ------------------------------------------------------------
     key 必须和 C# 的 UiSettings 字段同名 —— 桥接消息是直接把这两个对象
     互相塞过去的，名字对不上就会静默失效（前端看着好好的，Unity 不认）。
     ============================================================ */
  var ROWS = [
    {
      key: 'volume', page: 'sound', kind: 'range',
      label: '主音量', note: '机器总响度，语音、音乐、音效都乘在它上面。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) { return Math.round(v * 100); },
      fromUi: function (v) { return clampNumber(v / 100, 0, 1); },
      format: function (v) { return Math.round(v * 100) + '%'; }
    },
    {
      key: 'bgmVolume', page: 'sound', kind: 'range',
      label: '音乐音量', note: '背景音乐通道。实际响度 = 主音量 × 本值。调到 0 只静掉音乐，提示音还在。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) { return Math.round(v * 100); },
      fromUi: function (v) { return clampNumber(v / 100, 0, 1); },
      format: function (v) { return Math.round(v * 100) + '%'; }
    },
    {
      key: 'seVolume', page: 'sound', kind: 'range',
      label: '音效音量', note: '翻页、选项、物品等的提示音，乘在总响度上。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) { return Math.round(v * 100); },
      fromUi: function (v) { return clampNumber(v / 100, 0, 1); },
      format: function (v) { return Math.round(v * 100) + '%'; }
    },
    {
      /* ============================================================
        语音通道。**现在还没有语音资源** —— 剧本里只有 BGM 和音效，
        这条滑杆先"把管子接好"：C# 侧 AudioManager 已经为它留了第三个
        AudioSource（场景里没接就自己建一个），等台词语音接进来就有东西可调。

        **口型也从这条通道取幅度**，不跟 BGM / 音效 —— 见 README 的口型那节。

        ⚠ 加设置项是**七处一起改**（漏一处就静默失效）：
          这里 / UiSettings.cs / UiSettingsStore.cs / WebSettingsChannel.cs
          （那个手写的 payload 类）/ AudioManager.cs / animus.css 的 `.ax-rack`
          （列数曾经写死成 3）/ README 的字段表。
          最阴的一条：只在 C# 加、这里没加的话，网页每次发设置都不带这个字段，
          JsonUtility 对缺失的 float 给的是 **0** → 语音音量每次都被写成 0（静音）。
        ============================================================ */
      key: 'voiceVolume', page: 'sound', kind: 'range',
      label: '语音音量', note: '台词语音通道。实际响度 = 主音量 × 本值。调到 0 只静掉人声，音乐和音效还在。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) { return Math.round(v * 100); },
      fromUi: function (v) { return clampNumber(v / 100, 0, 1); },
      format: function (v) { return Math.round(v * 100) + '%'; }
    },
    {
      key: 'textSpeed', page: 'text', kind: 'range',
      label: '文字速度', note: '打字机每个字之间的间隔。右边显示的是「每秒多少字」，比「每字多少毫秒」直观。',
      def: 34, min: 0, max: 100, step: 1,
      toUi: function (v) {
        return clampNumber(Math.round(
          (SPEED_SLOW_MS - v) / (SPEED_SLOW_MS - SPEED_FAST_MS) * 100), 0, 100);
      },
      fromUi: function (v) {
        return Math.round(SPEED_SLOW_MS - (v / 100) * (SPEED_SLOW_MS - SPEED_FAST_MS));
      },
      /* 显示人能读的量：每秒多少字比"每字 34 毫秒"直观得多 */
      format: function (v) { return (v > 0 ? Math.round(1000 / v) : 0) + ' 字/秒'; }
    },
    {
      key: 'autoDelay', page: 'text', kind: 'range',
      label: '自动播放间隔', note: '自动播放模式下，一句话读完后等多久才翻页。',
      def: 900, min: 0, max: 100, step: 1,
      toUi: function (v) {
        return clampNumber(Math.round(
          (v - AUTO_MIN_MS) / (AUTO_MAX_MS - AUTO_MIN_MS) * 100), 0, 100);
      },
      fromUi: function (v) {
        return Math.round(AUTO_MIN_MS + (v / 100) * (AUTO_MAX_MS - AUTO_MIN_MS));
      },
      format: function (v) { return (v / 1000).toFixed(1) + ' 秒'; }
    },
    {
      /* ============================================================
        主题模式：**谁来决定用哪一套配色。**
        ------------------------------------------------------------
        固定      就是下面「界面主题」那一行，玩家自己挑。
        跟随时间  按本机时钟：白天 / 黄昏 / 夜里各一套。
        跟随进度  按**正在读的那一步**的场景光照（剧本每一步都带
                  background 和场景描述，见 AnimusMemory.currentLighting）。
                  这个模式下界面那间屋子的光会跟着剧情走 —— 读到深夜的
                  厨房就是夜·小灯，读到雨声不止就是雨夜。

        为什么单独做成一行而不是把三套主题直接混进选项里：
        「固定」和另外两个是**两种不同的问题**（我挑 / 让机器挑），
        混成六个选项的话，"我上次挑的午后"这个记忆就没地方放了 ——
        切到跟随模式再切回来，得能回到原来那一套。
        ============================================================ */
      key: 'animusThemeMode', page: 'display', kind: 'choice',
      label: '主题模式',
      /* 这一行的说明被拆进了每个选项里（见下面 options 的第三段）——
         详情面板一次只放得下六行，一整段"三种模式各是什么"必然被裁掉。
         现在光标停在哪个按钮上就讲哪个，不指任何按钮就讲现在生效的那个。
         行自己的 note 只当兜底（某个选项没写说明时用）。

         **三个选项的措辞是用户定的，别顺手"改通顺"**：
         「自由挑选你喜欢的主题吧~」「按本机的时间切换主题哦。」
         「和故事里的她一起！」—— 连结尾的 ~ / 。 / ！ 都不一样，
         那是刻意的语气，不是错字。 */
      note: '决定归档系统用哪一套配色。',
      def: 'fixed',
      options: [
        ['fixed', '固定',
          '自由挑选你喜欢的主题吧~'],
        ['time', '跟随时间',
          '按本机的时间切换主题哦。'],
        ['story', '跟随进度',
          '和故事里的她一起！']
      ]
    },
    {
      /* 界面主题。**只有这一项是"选了就改变整个界面"的** ——
         它不通过 C# 作用到 Unity，而是直接改 #animus 上的 data-theme
         （见 applyAnimusTheme）。落盘仍然走 C#（PlayerPrefs），
         所以它在 UiSettings 里也有一个字段。

         四套 = 客厅的四种光（场景需求表里那四张高优先背景）：
           午后 1-1/1-3/2-3 + 两个结局收束   傍晚 1-4/4-2
           夜   2-4/3-1/3-2~3-4（默认）      雨夜 4-1/4-3/5A/5B
         每套的名字和取色依据都写在 animus.css 那四块的开头。

         **这张 options 和 C# 的 UiSettingsStore.AnimusThemes 必须一起改**
         —— 两边对不上就表现成"选了主题，重开又变回去"（那边是权威）。

         主题模式不是 fixed 时这一行**只读**，而且显示的是实际生效的那一套
         （见 renderedTheme），不是这里存着的那一套 —— 否则玩家会以为
         设置没生效。 */
      key: 'animusTheme', page: 'display', kind: 'choice',
      label: '界面主题',
      note: '归档系统自己那四套配色。',
      /* **新装玩家第一次打开游戏看到的就是它**（= DEFAULT_THEME）。
         和 C# 的 UiSettings.animusTheme 初值必须一致。 */
      def: DEFAULT_THEME,
      /* ============================================================
         每套一句，写的是**它的取色依据**（那是哪一场戏的什么光）——
         这些本来躺在 animus.css 那四块主题的开头，只有写代码的人会读，
         搬到这里是为了让玩家也看得到。

         **但不要写场次号。** 第一版照抄了注释里的「1-1 和两个结局收束
         那一束光」「1-4 和 4-2 的夕阳」—— 那是开发者的坐标系，玩家在界面上
         任何地方都看不到"1-1"这种东西，读到只会一脸问号。所以现在说的是
         那场戏在**故事里是什么**（故事开始的那间客厅 / 夕阳染色的餐桌 /
         只开一盏小灯的深夜 / 整夜的雨），场次号留在 CSS 注释里。

         长度也要看：面板一行约 22 个字，一行 ≤22、两行 ≤40。
         ============================================================ */
      options: [
        ['noon', '午后',
          '故事开始和结束时，那间客厅的光：落地窗的白、被晒暖的木地板。'],
        ['evening', '傍晚',
          '夕阳染色的餐桌。满屋都是橙，只有她是冷的。'],
        ['lamp', '夜',
          '只开一盏小灯的深夜。她是你房间里唯一的亮光。'],
        ['rain', '雨夜',
          '整夜的雨。屋里没有灯，光是从窗外冷冷地进来的。']
      ],
      /* 跟随模式下这一行只读，显示的是**算出来的**那一套（见 effectiveValue）。 */
      effective: renderedTheme,
      locked: function () { return (current.animusThemeMode || 'fixed') !== 'fixed'; }
    },
    {
      key: 'fullscreen', page: 'display', kind: 'toggle',
      label: '全屏', note: '切换窗口与全屏。编辑器里不会真正生效 —— 切全屏会把调试视图一起切掉。',
      def: false
    },
    {
      /* 下面三条是**纯前端**的：它们只作用在网页里的立绘上（#oml2d-stage）。
         游戏页没有网页立绘，所以那一页不会出现「立绘」这个子页
         —— 见 settings-module 末尾的 available()。 */
      key: 'portraitVisible', page: 'portrait', kind: 'toggle',
      label: '显示立绘', note: '关掉之后右侧完全让给背景，她不再出现。',
      def: true
    },
    {
      key: 'portraitBrightness', page: 'portrait', kind: 'range',
      label: '立绘亮度', note: '她身上的光。压暗可以让她退进背景里。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) {
        return clampNumber(Math.round((v - BRIGHT_MIN) / (BRIGHT_MAX - BRIGHT_MIN) * 100), 0, 100);
      },
      fromUi: function (v) {
        return BRIGHT_MIN + (v / 100) * (BRIGHT_MAX - BRIGHT_MIN);
      },
      format: function (v) { return Math.round(v * 100) + '%'; }
    },
    {
      key: 'portraitSaturation', page: 'portrait', kind: 'range',
      label: '立绘饱和度', note: '拉到最低是黑白 —— 压在冷白的归档界面上会很显眼。',
      def: 1, min: 0, max: 100, step: 1,
      toUi: function (v) {
        return clampNumber(Math.round((v - SAT_MIN) / (SAT_MAX - SAT_MIN) * 100), 0, 100);
      },
      fromUi: function (v) {
        return SAT_MIN + (v / 100) * (SAT_MAX - SAT_MIN);
      },
      format: function (v) { return Math.round(v * 100) + '%'; }
    }
  ];

  /* 子页。顺序就是导航上档案盘的顺序。
     注意这里**没有** memory —— 记忆序列的内容在 memory-module.js 里注册，
     它的 no / label / order 也写在那里。两个文件各写一份会立刻漂移。

     ## layout：**每一页的表现必须不一样**

     这是参考图里最要紧的一条 —— 物品页是散开的图标 + 引线标注，服装页是
     一个人物剪影，数据库页是一摞斜放的卡片，章节页是一条横贯全屏的绳。
     它们不是"同一个列表换内容"，是四个界面。

     所以这里每一页声明一个 layout，由 CSS 在 .ax-page[data-layout=…] 上分支：

       mixer    调音台 —— 竖排电平条并排（**按行数生成**，有几条通道就几条），像一台混音台
       writer   打字机 —— 上面一个实时预览框，示例文字按当前速度逐字打出来
       screen   屏幕示意 —— 一个代表显示器的框，全屏/窗口在里面切换
       stage    舞台 —— 控件挤到左边一条窄栏，右边整个留给立绘

     code / desc 同时被两处用：第 0 层右侧的预览面板、第 1 层页首的 REC 条。
     写一遍两处都对，写两遍必然漂移。 */
  var PAGES = [
    {
      id: 'sound', no: '03', label: '声音', order: 20, layout: 'mixer',
      code: 'REC · 03 / AUDIO',
      desc: '音频通道的混合比例。主音量作用在整台机器上，分通道只影响音乐与音效两条总线。'
    },
    {
      id: 'text', no: '04', label: '文字', order: 30, layout: 'writer',
      code: 'REC · 04 / TEXT',
      desc: '记忆回放的节奏。文字速度决定每个字的间隔，自动播放间隔决定一句话读完后停多久。'
    },
    {
      id: 'display', no: '05', label: '显示', order: 40, layout: 'screen',
      code: 'REC · 05 / OUTPUT',
      /* 这一页现在有三项：主题模式 / 界面主题 / 全屏。
         原来那句只说全屏（写它的时候这一页确实只有全屏），
         主题那套加进来之后就不成立了 —— 页首的介绍得说明**这一页在管什么**。 */
      desc: '归档系统的配色 —— 谁来决定、现在用哪一套 —— 以及输出方式。' +
            '全屏只在构建出来的版本里真正生效。'
    },
    {
      id: 'portrait', no: '06', label: '立绘', order: 50, layout: 'stage',
      code: 'REC · 06 / SUBJECT',
      desc: '对象的成像参数。这三项只作用在主菜单页那位身上 —— 右边的她就是实时预览，拖着看。'
    }
  ];

  /* ---------- 状态 ---------- */

  /**
   * 当前值。**一开始就按表里的 def 填满**，不能留空对象 ——
   * 空的话第一次 render() 会拿 undefined 去算，读数是 NaN%。
   * （这个坑当场踩过一次：界面上明晃晃一个 NaN%。）
   */
  var current = {};
  ROWS.forEach(function (row) { current[row.key] = row.def; });

  var controls = {};      /* key -> { input, output, row, line, detail } */
  var pageParts = {};     /* pageId -> Animus.createPage 的返回值 + 招牌部件 */
  var built = false;

  /**
   * 给调用方的两个通知。
   *
   *   changed    玩家改了设置（由 boot.js / app.js 填）
   *   rowHovered **光标现在停在哪个控件那一行上**（row.key），不指着任何一行时 null
   *
   * `rowHovered` 是给"她在旁边看着你调"用的：主菜单页拿它让立绘对
   * **正在碰的那一项**做反应（见 boot.js 的 ROW_MOODS）。它和 `changed`
   * 分开是因为两者语义不同 —— 一个是"值变了"，一个是"你看的是哪一项"，
   * 混成一条的话，调用方得自己猜 payload 里那个 key 属于哪种。
   *
   * 不接这个通知的调用方（游戏页的暂停菜单）什么都不用管，不会报错。
   */
  var handlers = {
    changed: null,
    rowHovered: null
  };

  /* 上一次**真的发出去**的行 key。去重用 —— 见 notifyRow。 */
  var hoveredRowKey = null;

  /**
   * 行焦点的唯一出口。
   *
   * **只在"用户真的指到某一行"时发**（mouseenter / focusin），
   * 不在 `focusRow()` 里发 —— 那个函数在建页时也会被调一次
   * （`buildPage` 末尾把第一条摆进详情面板），在那儿发就等于
   * "页面一建好她就先对第一行反应一次"，而那一页的表情还没上场。
   *
   * 去重是必须的：一次点击会连着来 `focusin`（Tab 走到 input）
   * 和 `mouseenter`，不去重就是同一个 key 发两遍，她的表情会重头淡入一次。
   */
  function notifyRow(key) {
    if (key === hoveredRowKey) {
      return;
    }

    hoveredRowKey = key;

    if (typeof handlers.rowHovered === 'function') {
      handlers.rowHovered(key);
    }
  }

  /* ---------- 工具 ---------- */

  function clampNumber(value, min, max) {
    if (value < min) { return min; }
    if (value > max) { return max; }
    return value;
  }

  function rowOf(key) {
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].key === key) { return ROWS[i]; }
    }
    return null;
  }

  function rowsOf(page) {
    return ROWS.filter(function (r) { return r.page === page; });
  }

  /* ============================================================
     光标停在哪个选项上 → 详情面板就讲那一个选项
     ------------------------------------------------------------
     分段选择的一行（主题模式、界面主题）光靠"这一行是干什么的"
     讲不清楚 —— 三个模式各是什么、四套配色各长什么样，都得说出来。
     但详情面板一次只放得下六行，把那几段全塞进 row.note 必然被裁掉
     （用户就是这么发现的：字太长，显示不全）。

     所以把说明**拆到选项上**：options 的第三段就是那一个选项的说明。
        · 光标停在某个按钮上 → 讲那一个
        · 没停在按钮上        → 讲现在生效的那一个（就是"现在是什么"）
     面板里那个大字也跟着走，所以随时看得出讲的是哪一个。
     ============================================================ */
  var hoveredOption = null;      // { row: <行对象>, value: <选项值> } 或 null

  /** 行里某个选项的 [值, 标签, 说明]。 */
  function optionOf(row, value) {
    var hit = null;

    (row.options || []).forEach(function (option) {
      if (option[0] === value) { hit = option; }
    });

    return hit;
  }

  /** 详情面板现在该讲哪个选项：悬停优先，否则讲生效的那个。 */
  function shownOption(row) {
    if (hoveredOption && hoveredOption.row === row) {
      return optionOf(row, hoveredOption.value);
    }

    return optionOf(row, effectiveValue(row));
  }

  /* ============================================================
     "存着的值"和"生效的值"是两件事
     ------------------------------------------------------------
     绝大多数行两者相同。**只有「界面主题」例外**：
     主题模式是「跟随时间 / 跟随进度」时，真正生效的是算出来的那一套，
     而 `current.animusTheme` 里存着的仍然是玩家上次手挑的那一套 ——
     那一份不能丢：切回「固定」时要能回到它。

     （跟随模式**算不出来**时既不换成这一份、也不换成出厂默认，
       而是沿用界面上正在用的那一套 —— 见 renderedTheme 那条链。）

     所以行可以自己声明：
       effective()  现在真正生效的值（默认就是 current 里那个）
       locked()     这一行现在能不能动（默认能）
     列表的选中格、读数、详情面板、第 0 层预览**全部走 effectiveValue** ——
     少了这条，跟随模式下那一行会标着"上次手挑的那套"，
     和界面上真实的样子对不上，看着就像设置没生效。
     ============================================================ */
  function effectiveValue(row) {
    return typeof row.effective === 'function' ? row.effective() : current[row.key];
  }

  function rowLocked(row) {
    return typeof row.locked === 'function' ? !!row.locked() : false;
  }

  /** 某一行当前值的显示文本。列表、详情面板、第 0 层预览都用它。 */
  function formatValue(row) {
    var value = effectiveValue(row);

    if (row.format) { return row.format(value); }

    /* **choice 的取值是字符串，不是布尔。**
       少了这一支，它在详情面板里会掉进下面那句三元运算，
       于是「暖木」被显示成「已开启」—— 看着像排版错，其实是类型错。
       选项表是 [值, 标签] 的二元组（见 ROWS 里的 animusTheme）。 */
    if (row.kind === 'choice') {
      var hit = null;

      (row.options || []).forEach(function (option) {
        if (option[0] === value) { hit = option[1]; }
      });

      return hit || (value == null ? '' : String(value));
    }

    return value ? '已开启' : '已关闭';
  }

  /* ============================================================
     显示侧的效果：立绘的亮度 / 饱和度 / 显示与否
     ------------------------------------------------------------
     走 CSS 变量 + body 上的类，**不直接写 canvas 的内联样式**。
     原因：canvas 是 oh-my-live2d 自己插进来的，库在 resize / 换模型时
     会重写它的 element.style —— 写在内联样式上的 filter 会被抹掉。
     写在我们自己的样式表里、只让 JS 改 :root 上的变量，库就碰不到。
     ============================================================ */
  function applyPortraitEffects() {
    var root = document.documentElement;

    root.style.setProperty('--vn-portrait-brightness',
      String(current.portraitBrightness));
    root.style.setProperty('--vn-portrait-saturation',
      String(current.portraitSaturation));

    document.body.classList.toggle('portrait-hidden', !current.portraitVisible);
  }

  /* ============================================================
     显示侧的效果：Animus 的主题
     ------------------------------------------------------------
     改的是 #animus 上的 data-theme —— CSS 里四块主题变量靠它切换。

     改完必须通知外壳**重读一遍 canvas 用的通道三元组**：
     画布上的东西（卡片）读的是 JS 里缓存的副本，
     不重读就会留在上一套配色里 —— 这个坑踩过一次，
     表现是"换成深色主题之后画布上的东西直接消失了"。
     ============================================================ */

  /* ============================================================
     主题模式：谁来决定用哪一套
     ------------------------------------------------------------
     三件事分开写，各管各的：

       themeFromClock()    时间 → 主题（纯函数，好测）
       themeFromStory()    剧本 → 主题（读 AnimusMemory.currentLighting）
       resolvedTheme()     按**模式**算出"该换成哪一套"，算不出来返回 null
       renderedTheme()     **现在实际在用**的那一套（= 界面上那一套）

     关键在最后两个的区别，以及 null 怎么处理：

       **跟随模式算不出来时，什么都不做 —— 沿用界面上正在用的那一套。**
       不退回某个备选值，因为"算不出来"的正确反应是"别动"，
       不是"换成另一个"：玩家读到雨夜那一段、界面是雨夜，
       这时进度临时拿不到（比如 C# 还没回话），屋子不该突然变个颜色。
       跳一下比不变更糟 —— 那看起来像界面坏了。

       那"一次都还没应用过"（首帧）怎么办？renderedTheme 的链条会落到
       `current.animusTheme`，也就是玩家挑的那一套；新装玩家没存过，
       就是出厂默认 **午后**（见 DEFAULT_THEME）。
     ============================================================ */

  /** 剧本的 `background` 字段 → 主题。三个值一一对应，没有第四个。 */
  var LIGHTING_THEME = {
    day: 'noon',
    evening: 'evening',
    night: 'lamp'
  };

  /**
   * 本机时钟 → 主题。**一张写死的时刻表，不是天气检测。**
   *
   *     06:30–16:30  午后    天亮了，落地窗那束光
   *     16:30–18:30  傍晚    夕阳
   *     18:30–19:30  夜      天黑了、屋里开了灯，但还没下雨
   *     19:30–05:30  雨夜    整夜的雨
   *     05:30–06:30  夜      雨停、天快亮
   *
   * **边界全落在 :30 上，所以按"距零点多少分钟"比。** 按小时比的话
   * 16:30 这种半点边界要么进不去要么多算一小时，得写一堆 hour<16||(hour==16&&min<30)
   * 之类的补丁 —— 分钟是个整数，比这个干净。
   *
   * **雨夜是"约定"，不是"查到的"。** 时钟不知道外面下没下雨，这里做的
   * 只是"夜深到这个点，就当外面在下"这一条人工约定 —— 是美术上的安排，
   * 不是检测结果。所以注释写在这里，免得以后有人以为这一段接了天气。
   * 真正有依据的雨在剧本里（2-5 雨后 / 4-1 雷雨将至 / 4-3 雨声不止…），
   * 那一份归「跟随进度」。
   *
   * 最后一段（19:30 → 次日 05:30）**跨零点**，所以它单独判、而且是
   * "或"的关系：`m >= 19:30 || m < 05:30`。
   */
  function themeFromClock() {
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();

    if (m >= 6 * 60 + 30 && m < 16 * 60 + 30) { return 'noon'; }
    if (m >= 16 * 60 + 30 && m < 18 * 60 + 30) { return 'evening'; }
    if (m >= 18 * 60 + 30 && m < 19 * 60 + 30) { return 'lamp'; }

    /* 整夜的雨：19:30 到次日 05:30 */
    if (m >= 19 * 60 + 30 || m < 5 * 60 + 30) { return 'rain'; }

    return 'lamp';      /* 05:30–06:30：雨停了，天还没亮 */
  }

  /**
   * 剧本现在的场景 → 主题。
   *
   * `rainy` 只在**夜里**才算雨夜：2-2 是「客厅 / 傍晚 / 小雨」，
   * 那是傍晚下小雨，不是雨夜 —— 按雨算的话这一场会变成全冷色的屋子，
   * 而剧本写的是夕阳。所以先看时段，再看天气。
   */
  function themeFromStory() {
    var memory = window.AnimusMemory;

    if (!memory || typeof memory.currentLighting !== 'function') { return null; }

    var lighting = memory.currentLighting();
    if (!lighting) { return null; }

    if (lighting.rainy && lighting.background === 'night') { return 'rain'; }

    return LIGHTING_THEME[lighting.background] || null;
  }

  /**
   * 按**模式**算出该换成哪一套。**算不出来返回 null**（= 别动）。
   *
   * 三种模式各自的来源：
   *   time   本机时钟 —— 永远算得出来，不返回 null
   *   story  剧本现在的场景 —— 可能拿不到（没存档、没剧本、字段不认识）
   *   fixed  玩家挑的那一套 —— 永远有值
   */
  function resolvedTheme() {
    var mode = current.animusThemeMode || 'fixed';

    if (mode === 'time') { return themeFromClock(); }
    if (mode === 'story') { return themeFromStory(); }

    return current.animusTheme || DEFAULT_THEME;
  }

  /** 界面上现在写着的那一套（读 DOM，不另存一份状态 —— 免得两份对不上）。 */
  function onScreenTheme() {
    var root = document.getElementById('animus');
    return (root && root.getAttribute('data-theme')) || '';
  }

  /**
   * **现在实际在用**的那一套。设置页那一行、详情面板、预览都用它。
   *
   * 链条的顺序就是优先级：
   *   ① 模式算得出来 → 用它
   *   ② 算不出来     → **沿用界面上现在这一套**（跟随模式的"别动"）
   *   ③ 还没应用过   → 玩家挑的那一套（新装玩家 = 出厂默认 午后）
   *   ④ 连那个都没有 → DEFAULT_THEME（走不到，纯粹兜底）
   */
  function renderedTheme() {
    return resolvedTheme()
      || onScreenTheme()
      || current.animusTheme
      || DEFAULT_THEME;
  }

  function applyAnimusTheme() {
    var theme = renderedTheme();
    var root = document.getElementById('animus');

    if (root) {
      root.setAttribute('data-theme', theme);
    }

    /* 同一个值也写到 <html> 上：交接那层光 `#handoff-veil` 在 `#animus` 外面，
       读不到 #animus 上的变量。animus.css 里那四个主题块为此挂了 `:root[...]` 那一份。 */
    document.documentElement.setAttribute('data-theme', theme);

    /* 告诉 C#「现在实际生效的是哪一套」。
       Unity 侧的 MosaicReveal 要拿它挑换场景时那片静止光的颜色 ——
       主题模式是 time / story 时，实际生效的这套和设置里存的那个不是一回事，
       所以只能由这边报过去，不能让 C# 自己猜。 */
    if (window.VNBridge && typeof VNBridge.send === 'function') {
      VNBridge.send('ui.theme', { theme: theme });
    }

    if (window.Animus && typeof Animus.refreshTheme === 'function') {
      Animus.refreshTheme();
    }
  }

  /* ---- 跟随模式下要自己重算 ----
     时间那一套会跨过段界（玩家开着菜单从 16:59 坐到 17:01），
     进度那一套会在剧情往前走之后变。两种都用一个很轻的定时器兜住：
     一分钟看一次，**只在算出来的结果和界面上现在这套不一样时才动 DOM**，
     所以常态下它什么也不做。

     为什么不挂事件：进度要在剧情推进时通知 —— 那是记忆模块的事，
     让它反过来依赖设置模块会把两边绑死。一分钟的粒度对"屋子的光"
     这件事足够（它不是读数，是一个氛围）。 */
  var THEME_POLL_MS = 60000;
  var themeTimer = null;

  function ensureThemePoll() {
    if (themeTimer || typeof window.setInterval !== 'function') { return; }

    themeTimer = window.setInterval(function () {
      var mode = current.animusThemeMode || 'fixed';
      if (mode === 'fixed') { return; }

      var root = document.getElementById('animus');
      if (!root || root.getAttribute('data-theme') === renderedTheme()) { return; }

      applyAnimusTheme();
      /* 设置页开着的话那一行也要跟着换（它显示的是实际生效的那一套） */
      render();
    }, THEME_POLL_MS);
  }

  /* ============================================================
     渲染
     ============================================================ */

  function buildRow(row, list) {
    var line = document.createElement('div');
    line.className = 'ax-row';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'ax-row-label';
    labelWrap.textContent = row.label;

    var output = document.createElement('div');
    output.className = 'ax-row-value';

    var input;

    if (row.kind === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = String(row.min);
      input.max = String(row.max);
      input.step = String(row.step || 1);

      /* 用 input 而不是只等 change：拖滑杆要实时生效，
         change 要等松手才触发，调文字速度时完全没有手感。 */
      input.addEventListener('input', function () { onControlChanged(row, input); });
      input.addEventListener('change', function () { onControlChanged(row, input); });
    } else if (row.kind === 'choice') {
      /* 分段选择：一排小按钮，选中那个是位置信号色。
         比下拉框好 —— 选项少的时候一眼能看全，而且点一下就换。 */
      input = document.createElement('div');
      input.className = 'ax-choice';

      row.options.forEach(function (option) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'ax-choice-item';
        button.textContent = option[1];
        button.setAttribute('data-value', option[0]);

        button.addEventListener('click', function (event) {
          event.stopPropagation();
          if (rowLocked(row)) { return; }          /* 只读行：点了不动 */
          if (current[row.key] === option[0]) { return; }
          current[row.key] = option[0];
          render();
          onControlChanged(row, input);
        });

        /* 指到某一个选项 → 详情面板换成它那一段（见 hoveredOption 那段）。
           focus 也要挂：键盘 Tab 走过去时同样要讲那一个。 */
        function showThisOption() {
          hoveredOption = { row: row, value: option[0] };
          detailOf(row);
        }

        button.addEventListener('mouseenter', showThisOption);
        button.addEventListener('focus', showThisOption);

        input.appendChild(button);
      });
    } else {
      input = document.createElement('button');
      input.type = 'button';
      input.className = 'ax-switch';

      input.addEventListener('click', function (event) {
        event.stopPropagation();
        input.classList.toggle('on');
        onControlChanged(row, input);
      });
    }

    line.appendChild(labelWrap);
    line.appendChild(input);
    line.appendChild(output);
    list.appendChild(line);

    controls[row.key] = { input: input, output: output, row: row, line: line };

    /* 光标进到这一行 → 右侧详情面板换成这一条的说明。
       用 mouseenter 而不是 mouseover：mouseover 在行内的子元素之间
       移动也会冒泡触发，滑杆一拖就刷几十次详情。

       **进这一行先把"悬停的选项"清掉**：不然从上一行的某个按钮滑到
       这一行时，面板还留着上一行那个选项的说明。 */
    line.addEventListener('mouseenter', function () {
      hoveredOption = null;
      focusRow(row);
      notifyRow(row.key);
    });
    line.addEventListener('focusin', function () {
      focusRow(row);
      notifyRow(row.key);
    });

    /* 离开这一行：选项的悬停结束，面板回到"现在生效的那一个"。 */
    line.addEventListener('mouseleave', function () {
      if (!hoveredOption || hoveredOption.row !== row) { return; }
      hoveredOption = null;
      detailOf(row);
    });
  }

  /**
   * 把某一行变成"焦点行"：列表里标一下，右侧详情面板换成它。
   *
   * 详情面板是 AC2 子页三列布局的右列。中文说明放这儿就不用挤在
   * 9vw 的标签列里换三行 —— 那正是上一版最难看的地方。
   */
  function focusRow(row) {
    ROWS.forEach(function (r) {
      var c = controls[r.key];
      if (c) { c.line.classList.toggle('focused', r.key === row.key); }
    });

    detailOf(row);
  }

  function detailOf(row) {
    var control = controls[row.key];
    if (!control) { return; }

    /* 分段选择：讲的是**某个选项**，不是这一行 —— 大字就是那个选项的名字，
       小字是它自己的说明（见 hoveredOption 那段）。选项没写说明时退回行说明。 */
    var option = row.kind === 'choice' ? shownOption(row) : null;

    Animus.setDetail(control.detail, {
      title: row.label,
      /* **走 formatValue，不要在这里再抄一遍那句三元。**
         这行原来是手抄的 `current[key] ? '已开启' : '已关闭'`，
         于是 choice 那一行（界面主题）在详情面板里显示成「已开启」，
         而左边列表里显示的是「暖木」—— 同一个值两种说法。
         一个公式写两遍必然漂移，这个仓库里已经栽过好几次了。 */
      value: option ? option[1] : formatValue(row),
      note: (option && option[2]) || row.note || '',
      id: 'PARAM · ' + row.key
    });
  }

  function buildPage(page, host) {
    /* 页首的"档案记录"条、以及"列表 + 详情"容器，都由 Animus.createPage
       统一搭好（见那边的注释）—— 两个模块各搭一遍必然会有一边忘了。 */
    var parts = Animus.createPage(page, host);
    var rows = rowsOf(page.id);

    // CSS 按这个属性分支出四种完全不同的版式
    parts.root.setAttribute('data-layout', page.layout || 'plain');
    pageParts[page.id] = parts;

    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'ax-empty';
      empty.textContent = '这一段记录里没有可调的参数。';
      parts.list.appendChild(empty);
      return;
    }

    buildStageBlock(page, parts);

    rows.forEach(function (row) {
      buildRow(row, parts.list);
      controls[row.key].detail = parts.detail;
    });

    /* 指针离开**整块列表**才算"不再指着任何一行" ——
       不挂在每一行的 mouseleave 上：在两行之间移动时先 mouseleave 再
       mouseenter，那样她的表情会在两行的表情之间闪一次默认值。
       挂在列表容器上，A → B 就是干脆的一次切换。 */
    parts.list.addEventListener('mouseleave', function () {
      notifyRow(null);
    });

    // 默认把第一条摆进详情面板：空着会让人以为右边坏了
    focusRow(rows[0]);
  }

  /* ============================================================
     每一页的"招牌部件"
     ------------------------------------------------------------
     四种版式共用同一批行（buildRow 出来的原子），
     但每一页在上面多放一个**只属于这一页**的部件。
     参考图里物品页和服装页的差别主要就来自这个东西。
     ============================================================ */
  function buildStageBlock(page, parts) {
    /* 插在页首记录条**和**内容列之间 —— 不能 appendChild。
       createPage 已经把 cols 建好了，appendChild 会落到它后面，
       招牌部件就跑到列表底下去了。这个坑当场踩过一次。 */
    function insert(node) {
      parts.root.insertBefore(node, parts.list.parentNode);
    }

    if (page.layout === 'mixer') {
      /* 调音台：每条音量通道一根竖直电平条，横着并排。
         它们不是控件，是**仪表** —— 拖滑杆时条子跟着涨，
         这一页从此就不是"几行滑杆"了。

         **按 rowsOf(page.id) 生成，不写死条数** —— 加一条通道
         （语音就是这么加的）这里一行都不用改；
         CSS 那边也是自适应的（`.ax-rack` 用 grid-auto-flow）。 */
      var rack = document.createElement('div');
      rack.className = 'ax-rack';
      parts.rack = [];

      rowsOf(page.id).forEach(function (row) {
        var ch = document.createElement('div');
        ch.className = 'ax-chan';

        var bar = document.createElement('div');
        bar.className = 'ax-chan-bar';
        bar.appendChild(document.createElement('i'));

        var name = document.createElement('div');
        name.className = 'ax-chan-name';
        name.textContent = row.label;

        ch.appendChild(bar);
        ch.appendChild(name);
        rack.appendChild(ch);
        parts.rack.push({ row: row, fill: bar.firstChild });
      });

      insert(rack);
    }

    if (page.layout === 'writer') {
      /* 打字机：一段示例台词按**当前速度**逐字打出来。
         这一页调的就是节奏，光看「29 字/秒」感受不到 ——
         得让它当场打给你看。 */
      var box = document.createElement('div');
      box.className = 'ax-writer';

      var who = document.createElement('div');
      who.className = 'ax-writer-who';
      who.textContent = '皖萱';

      var line = document.createElement('div');
      line.className = 'ax-writer-line';

      box.appendChild(who);
      box.appendChild(line);
      insert(box);

      parts.writer = line;
    }

    if (page.layout === 'screen') {
      /* 屏幕示意：一个代表显示器的框，里面的窗口随全屏开关涨缩。
         比一行「全屏 已关闭」直观得多。 */
      var frame = document.createElement('div');
      frame.className = 'ax-screen';

      var win = document.createElement('div');
      win.className = 'ax-screen-win';
      var label = document.createElement('span');
      label.textContent = '窗口';
      win.appendChild(label);

      frame.appendChild(win);
      insert(frame);

      parts.screenWin = win;
      parts.screenLabel = label;
    }
  }

  /** 值变了之后把招牌部件同步一遍。 */
  function syncStage(pageId) {
    var parts = pageParts[pageId];
    if (!parts) { return; }

    if (parts.rack) {
      parts.rack.forEach(function (entry) {
        var row = entry.row;
        var pct = row.kind === 'range'
          ? parseInt(controls[row.key].input.value, 10)
          : (current[row.key] ? 100 : 0);
        entry.fill.style.height = pct + '%';
      });
    }

    if (parts.screenWin) {
      var on = !!current.fullscreen;
      parts.screenWin.classList.toggle('full', on);
      parts.screenLabel.textContent = on ? '全屏' : '窗口';
    }
  }

  /* ============================================================
     打字机预览
     ============================================================ */

  var WRITER_SAMPLE = '独居久了以后，房间会长出一种很奇怪的静。';
  var writerTimer = null;

  function startWriter() {
    var parts = pageParts.text;
    if (!parts || !parts.writer) { return; }

    window.clearTimeout(writerTimer);

    var text = WRITER_SAMPLE;
    var at = 0;
    parts.writer.textContent = '';

    function tick() {
      if (at > text.length) {
        // 停一会儿再从头打 —— 一直循环才能一边拖滑杆一边看效果
        writerTimer = window.setTimeout(startWriter, 1600);
        return;
      }

      parts.writer.textContent = text.slice(0, at);
      at++;
      writerTimer = window.setTimeout(tick, Math.max(1, current.textSpeed));
    }

    tick();
  }

  /** 把 current 刷到所有控件上。 */
  function render() {
    ROWS.forEach(function (row) {
      var control = controls[row.key];
      if (!control) { return; }

      /* 用的是**生效值**，不是存着的值 —— 见 effectiveValue 那段。 */
      var value = effectiveValue(row);
      var locked = rowLocked(row);

      if (row.kind === 'range') {
        control.input.value = String(row.toUi(value));
        control.output.textContent = row.format(value);
      } else if (row.kind === 'choice') {
        // 分段选择：只标出选中那一格，读数栏显示它的名字
        var items = control.input.querySelectorAll('.ax-choice-item');
        var label = '';

        for (var i = 0; i < items.length; i++) {
          var on = items[i].getAttribute('data-value') === value;
          items[i].classList.toggle('on', on);
          /* 只读时按钮真的 disabled —— 光标、键盘、无障碍三处一起对，
             比只加个 pointer-events: none 靠谱。 */
          items[i].disabled = locked;
          if (on) { label = items[i].textContent; }
        }

        control.input.classList.toggle('locked', locked);
        control.output.textContent = label;
      } else {
        control.input.classList.toggle('on', !!value);
        control.output.textContent = value ? '已开启' : '已关闭';
      }

      /* 详情面板里那个大字也要跟着走。不更新的话，拖滑杆时左边读数在变、
         右边那个大数字却停在旧值上 —— 那是"看起来对但其实过期"，最坏的一种。 */
      if (control.line && control.line.classList.contains('focused')) {
        detailOf(row);
      }
    });

    /* 招牌部件跟着值走：电平条、屏幕里的窗口。 */
    PAGES.forEach(function (page) { syncStage(page.id); });
  }

  /* ============================================================
     数据进出
     ============================================================ */

  function onControlChanged(row, input) {
    if (row.kind === 'range') {
      current[row.key] = row.fromUi(parseInt(input.value, 10));
    } else if (row.kind === 'choice') {
      // 值在点击时就写进 current 了，这里不用再读一遍 DOM
    } else {
      current[row.key] = input.classList.contains('on');
    }

    /* 再渲染一次。滑杆的整数刻度换算回物理量往往落在两个刻度之间，
       这一步让读数显示的是**真正生效的值**，而不是滑杆位置暗示的值。
       因为换算是稳定的（物理量 → 刻度 → 物理量 是不动点），不会把滑杆弹来弹去。 */
    render();

    if (row.page === 'portrait') {
      applyPortraitEffects();
    }

    if (row.key === 'animusTheme') {
      applyAnimusTheme();
    }

    emitChanged();
  }

  function snapshot() {
    var payload = {};
    Object.keys(current).forEach(function (key) { payload[key] = current[key]; });
    return payload;
  }

  function emitChanged() {
    if (typeof handlers.changed === 'function') {
      handlers.changed(snapshot());
    }
  }

  /**
   * 从 C# 同步。
   * 字段缺失就保持原值 —— 这样以后加新设置项时，旧版 C# 发来的消息
   * 不会把新字段清成 0。
   */
  function apply(next) {
    if (!next) { return; }

    ROWS.forEach(function (row) {
      var value = next[row.key];

      if (row.kind === 'toggle') {
        if (typeof value === 'boolean') { current[row.key] = value; }
        return;
      }

      /* 分段选择存的是字符串。**只接受表里列过的值** ——
         存档被手改成别的字符串时，界面不该跟着一起坏。 */
      if (row.kind === 'choice') {
        var ok = typeof value === 'string' && row.options.some(function (o) { return o[0] === value; });
        if (ok) { current[row.key] = value; }
        return;
      }

      if (typeof value === 'number' && isFinite(value)) {
        current[row.key] = clampNumber(value, row.fromUi(row.min), row.fromUi(row.max));
      }
    });

    applyPortraitEffects();
    applyAnimusTheme();

    if (built) { render(); }
  }

  function resetToDefaults() {
    ROWS.forEach(function (row) { current[row.key] = row.def; });

    /* **两个"应用到界面"都得叫一遍。**
       这里原来只叫了 applyPortraitEffects()，漏了 applyAnimusTheme() ——
       于是「恢复默认」把 animusTheme 改回了它自己的默认值并发给 C# 存下来，
       但屏幕上的主题一点没变，要重开一次才生效。
       "改了状态但没同步到界面"是最难发现的一类 bug：状态是对的、存档是对的，
       只有画面是旧的。加设置项的时候记得回头看这里一眼。 */
    applyPortraitEffects();
    applyAnimusTheme();

    if (built) { render(); }
    emitChanged();
  }

  /* ============================================================
     注册
     ------------------------------------------------------------
     每个子页注册成一个 Animus 模块。build 里只建自己那几行 ——
     延迟到玩家真的切过去才建。
     ============================================================ */
  function registerAll() {
    PAGES.forEach(function (page) {
      Animus.register({
        id: page.id,
        no: page.no,
        label: page.label,
        order: page.order,
        /* code / desc 同时被两处用：
             第 0 层右侧的预览面板（"这一页是什么"）
             第 1 层页首的 REC 记录条
           写一遍两处都对，写两遍必然漂移。 */
        code: page.code,
        desc: page.desc,

        /* 第 0 层预览面板里那几行读数：光标停在这一格就能看出
           "进去之后有什么、现在是什么值"。 */
        preview: function () {
          return rowsOf(page.id).map(function (row) {
            return [row.label, formatValue(row)];
          });
        },

        /* 第 1 层底栏除了「返回」之外还多一颗。 */
        actions: [{ id: 'reset', label: '恢复默认' }],

        /* 立绘那几项只作用在**网页里的**立绘上，而游戏页没有网页立绘 ——
           所以那一页在游戏页不该出现。判据用 DOM 上的标记（主菜单页才有的
           #menu-layer），不用 MenuCharacter 那个全局 —— 脚本加载顺序一变它就没了。 */
        available: function () {
          return page.layout !== 'stage' || !!document.getElementById('menu-layer');
        },

        build: function (host) {
          built = true;
          buildPage(page, host);
          render();
          applyPortraitEffects();
        },

        refresh: function () {
          /* 这一页刚被打开（或者切回来）——**"光标停在某一行"这件事重新归零**。
             不清的话：上一次进这一页最后停在「文字速度」那一行，
             退出去再进来、又指向同一行时，notifyRow 会把它当成"没变化"而
             一声不吭，调用方那边却已经把行焦点清掉了 —— 于是她对这一行
             没有反应。这类"去重状态比实际活得久"的坑，表现都是"偶尔没反应"。 */
          hoveredRowKey = null;

          render();

          /* 切到文字页就把打字机打开，切走就停 ——
             它有自己的 setTimeout 循环，不停会一直在后台烧。 */
          if (page.layout === 'writer') {
            startWriter();
          } else {
            window.clearTimeout(writerTimer);
          }
        }
      });
    });
  }

  registerAll();

  /* 跟随时钟那一套要自己会跨段界，所以起一个很轻的轮询（见 ensureThemePoll）。 */
  ensureThemePoll();

  return {
    handlers: handlers,
    pages: PAGES,
    rows: ROWS,
    apply: apply,
    resetToDefaults: resetToDefaults,
    get: snapshot,
    /** 调用方想在别处（比如底栏）加一个"恢复默认"时用得上。 */
    refresh: render,

    /**
     * 重新算一遍该用哪套主题并应用。
     *
     * **入口打开归档界面时该调一次**（和 AnimusMemory.warmUp 并列）：
     * 「跟随进度」那一套的依据是"现在读到哪一步了"，而玩家可能刚打完一段
     * 剧情才按的 Esc —— 光靠一分钟一次的轮询，最坏要等一分钟屋子才换光。
     */
    refreshTheme: applyAnimusTheme,
    /** 现在实际生效的那一套（跟随模式下和「界面主题」里存的不一定一样）。 */
    renderedTheme: renderedTheme
  };
})();
