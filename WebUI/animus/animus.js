/* ============================================================
   animus.js —— Animus Desktop 的外壳（animus/animus.js）
   ------------------------------------------------------------
   这一层只做五件事：

     1. 生成自己的 DOM（两个页面共用一份，不能写进任何一页的 HTML）
     2. 画那条索引绳，并把"文件夹节点"**挂在绳上**
     3. 管模块（记忆序列 / 声音 / 文字 / 显示 / 立绘）的注册与切页
     4. 右上角那块读数、扫描 / 失同步动效、Esc / ↑↓
     5. 给每个页面发"列表 + 详情"两个容器（AC2 的三列布局）

   它**不认识**设置、不认识剧情、不认识 C#。内容全部由注册进来的模块
   自己往容器里塞，这样以后加"物品栏""数据库"不用动这个文件一行。

   ## 隐喻：**归档**，不是基因

   AC2 那套界面的底子是"翻阅血脉档案"，所以它画的是双螺旋。
   **我们没有那条线** —— 剧本里没有血缘、没有遗传、没有族谱，
   硬套只会让人以为要讲这个。

   剧本自己的词是**归档**（4-1：「说是要给自己的『调查样本』做归档」）。
   所以这里画的是一根**索引绳**：只有一根、会荡，样本卡挂在上面。

   ## 和上一版的关键差别

   上一版的导航是"等距竖排的方块 + 旁边一条螺旋"。那本质上还是一个选项卡
   列表，绳子只是背景图案。

   现在：**节点挂在绳上**。节点的横坐标由绳在该高度的相位算出来
   （nodeXAt），所以绳一荡，节点就跟着左右游走 —— 它真的挂在绳上，
   而不是"贴在旁边"。标签留在原地，用引线连过去。

   换页时还有一段**亮弧沿着绳从旧节点跑到新节点**。
   那是那套界面的招牌动作：光标在绳上移动，而不是"选项卡被点亮"。
   ============================================================ */

window.Animus = (function () {
  'use strict';

  /* ============================================================
     可调参数 —— 绳和节点的样子只改这一段
     ============================================================ */
  var CFG = {
    /* 绳的中轴在导轨里的横向位置（占导轨宽的比例） */
    helixX: 0.34,
    /* 绳的摆幅（占导轨宽）。节点挂在绳上，所以这个值同时决定
       "节点会左右游走多少" —— 太小就不像绳，太大会撞到标签。 */
    amplitude: 0.17,
    /* 从顶到底荡几个来回。
       旧的 3.4 是给双螺旋用的（要拧够圈数才像 DNA）—— 一根绳拧 3.4 圈
       就是弹簧了。0.9 是"两端拉住、中间荡开"的一段弧。
       节点挂在绳上，所以这个值也决定各节点横向散开的程度。 */
    turns: 0.9,
    spinSeconds: 34,      /* 荡一个周期的秒数（比旧链条慢，绳比螺旋重） */
    sampleStep: 2.5,      /* 采样步长（像素） */

    /* ---- 相机 ---- */

    /* 场景比取景框上下各多出多少（占取景框高的比例）。
       相机最多滑这么多，再滑就会露出绳的断头。

       这个值和下面两个是一组，改一个要重算另外两个：
       可见范围 = [o/(1+2o), 1−o/(1+2o)]，而**最远的节点会落在 0.5+span 上**，
       所以要让它留在画面里就得  span ≤ 1 − o/(1+2o) − 0.5。
       o=0.32 时上限 0.305；o=0.15 时 0.385。从 10 个文件夹那版开始
       我们要塞 7 个，所以把 o 降到 0.15 换来更大的可用 span。 */
    overscan: 0.15,
    /* 相机滑动 + 推近的时长 */
    camMs: 640,
    /* 推近幅度：滑动过程中镜头往前压一点再收回。
       纯平移看不出"推近"，加这一下才有镜头感。 */
    zoomBump: 0.055,
    /* 节点在**场景**坐标系里的纵向范围。不铺满整个场景是刻意的：
       两头空出来的那截绳就是"空间还在延伸"，相机也才有地方可滑。

       但 span **不能太大**，这是硬约束不是审美 —— 见上面 overscan 的注释。
       参考图里的桌面有十个左右的条目，我们（含动作瓦片）是 5~7 个，
       所以 span 按 7 个排：0.36 / 6 ≈ 每格 0.06 的场景高。
       条目再变多的话要么调小行高，要么调小 overscan。 */
    nodeTopU: 0.335,
    nodeSpanU: 0.33,

    /* 标签的横向位置（占导轨宽的比例）。22vw 的 60% = 13.2vw，
       和 animus.css 里 .ax-node-text 的 left 必须一致。 */
    labelX: 0.60,

    /* 换页时亮弧从旧节点跑到新节点要多久 */
    travelMs: 480,
    /* 开场时同步率从 0 数到目标值要多久 */
    syncCountMs: 1400,

    /* ---- 进入 / 离开一个文件夹 ----
       进入时镜头往前压这么多再收住 —— 那是"推门进去"的那一下。 */
    enterZoom: 0.14,
    enterMs: 560,

    /* ---- 背景那一层大绳（"你一直在这个空间里"）---- */
    space: {
      x: 0.40,          /* 中轴（占视口宽） */
      amplitude: 0.20,  /* 摆幅（占视口宽） */
      turns: 0.55,      /* 从顶到底荡几个来回 */
      spinSeconds: 44,  /* 比导航绳慢得多：它是环境，不该抢戏 */
      cordAlpha: 0.26,
      step: 6           /* 采样步长（像素）。它只是氛围，不用画细 */
    }
  };

  /* 配色只有三样：灰（绳）/ 金（位置信号）/ 雪青（数据，只用在极小的字上）。
     参考图里是白的空间 + 灰的骨架 + **砖红**的位置信号；我们换成**她光环的金**
     —— 砖红是"系统在标记你"，金是"她在看着你"，这套界面要的是后者。
     绳用青色是我上一版的想当然，它让界面读起来像科技面板而不是那套界面。 */
  /* ============================================================
     canvas 的颜色 —— **必须从主题变量读，不能写死**
     ------------------------------------------------------------
     CSS 里那套颜色是 rgb()/rgba() 字符串，canvas 要的是
     "34,48,58" 这种裸三元组，拼不出字符串，所以主题块里额外给了
     --ax-ink-rgb / --ax-mark-rgb / --ax-cyan-rgb 三个通道变量。

     踩过的坑：一开始这三个是写死的，结果换成深色主题之后
     **绳和卡片直接看不见了** —— 画布上的东西留在了上一套配色里，
     而组件规则全都换过去了，从代码上完全看不出来。

     readTheme() 在 open() 里调一次。**主题变了要重新调** ——
     现在没有换主题的界面，所以只有这一处。
     ============================================================ */
  var INK = '34,48,58';
  var MARK = '142,26,23';
  var CYAN = '46,158,188';

  function readTheme() {
    if (!el.root) { return; }

    var cs = window.getComputedStyle(el.root);
    var ink = cs.getPropertyValue('--ax-ink-rgb').trim();
    var mark = cs.getPropertyValue('--ax-mark-rgb').trim();
    var cyan = cs.getPropertyValue('--ax-cyan-rgb').trim();

    if (ink) { INK = ink; }
    if (mark) { MARK = mark; }
    if (cyan) { CYAN = cyan; }
  }

  /* ============================================================
     模块注册表
     ------------------------------------------------------------
     { id, no, label, order, code, desc, available(), build(host), refresh(page) }
       · available 决定它出不出现在导航里
       · build(host) 收到的是**页面壳**：{ root, list, detail }（见 createPage）
     ============================================================ */
  var modules = [];
  var shown = [];
  var activeId = null;
  var activeIndex = -1;
  var built = {};

  var el = {};
  var rafId = 0;
  var startedAt = 0;
  var isOpen = false;

  /** 当前这一屏的框架，由 open() 传进来。 */
  var frame = {
    kicker: '记 忆 归 档',
    title: '设置',
    modules: null,
    rows: [],
    sync: null,
    actions: [],
    hint: '',
    /* 第 0 层根那里 Esc 提示语写什么（主菜单是"关闭"，游戏页也是"关闭"）。
       只在**栈为空**的时候用得上 —— 一旦进了文件夹，提示语一律是"返回"，
       因为那时 Esc 真的只是退一层。见 backLabel()。 */
    escLabel: '返回'
  };

  /** 同步率：真实值（0..1 或 null）与"正在显示的"值分开存 */
  var syncTarget = null;
  var syncShown = 0;
  var syncCountFrom = 0;
  var syncCountAt = 0;
  var lastTip = -1;
  var SEGMENTS = 18;

  /** 换页时那段亮弧 */
  var travel = null;      /* { fromU, toU, at } */

  /* ============================================================
     层级
     ------------------------------------------------------------
     **这是整套界面的骨架，不是"页面切换"。**

       第 0 层  Animus 桌面 —— 选文件夹。左导轨 + 右侧预览面板。
       第 1 层  子页       —— 每个文件夹**自己的界面**，完全接管画面。

     进入靠确认（点击 / 回车），出来靠返回（Esc / 底栏的返回）。
     两条路径都要走镜头：进去是推近，出来是拉回。

     上一版把两层压成了一层（导轨常驻、右边换内容），读起来是"选项卡"。
     这两层差别极大：桌面是一摞瓦片，章节页是一条横贯全屏的绳 ——
     它们不是同一个界面的两种内容，是两个界面。
     ============================================================ */
  var level = 0;
  var highlightIndex = 0;

  /* ============================================================
     导航栈：桌面**可以套桌面**
     ------------------------------------------------------------
     参考图里就是这样：
       桌面 → 物品 → 武器 / 补给品 / 物品 / 服装 → 具体一件
       桌面 → 数据库 → 地点 / 人物 / 概念
     设置也一样：「选项」是一格瓦片，进去之后才是 声音/文字/显示/立绘。

     所以不是固定的"两层"，而是一个**栈**：进去压一层、返回弹一层。
     栈里存"进去之前那一屏长什么样"，返回时原样恢复
     （包括光标停在原来那一格上）。
     ============================================================ */
  var stack = [];

  /* ============================================================
     面包屑的第一段（左下角那行「◆ …」）
     ------------------------------------------------------------
     **玩家的世界里没有 "Animus" 这个词。**
     参考作品那边写的是「ANIMUS桌面」，我们照搬过一版 —— 那是**别人的品牌名**，
     放在这个甜味的故事里串味。这里的规矩：左下角用**这一套界面自己的名字**，
     也就是顶栏那个 kicker（「记 忆 归 档」），同一个界面上两处说法必须一致。

     它和后面几段（设置 / 声音 / …）拼成一条路径：
         记忆归档  ›  设置  ›  声音
     ============================================================ */
  var BREADCRUMB_ROOT = '记忆归档';

  /** 面包屑的路径。第 0 项永远是这一层容器自己的名字。 */
  var path = [BREADCRUMB_ROOT];

  /* ============================================================
     相机
     ------------------------------------------------------------
     绳是一个**比取景框大的固定场景**，切子页不是"换一屏界面"，而是
     镜头沿绳滑过去、把选中的节点送到对焦线上。

     这一组值每帧由 now 现算，不留累加状态（和别处同一个规矩）：
       panFrom/panTo/panAt  —— 从哪滑到哪、什么时候开始的
     ============================================================ */
  var cam = {
    panFrom: 0,
    panTo: 0,
    panNow: 0,
    at: 0,
    activeU: 0.5
  };

  var handlers = {
    action: null,
    esc: null,
    closed: null,
    page: null,
    /* 章节跳跃：模块点中某一章时发出来，由调用方决定怎么跳
       （主菜单发 menu.chapter，游戏里发 story.jump）。 */
    chapter: null,

    /* 光标现在指着哪一格（参数是模块 id），不指着任何一格时发 null。
       ------------------------------------------------------------
       主菜单页拿它去切右侧立绘的表情（见 boot.js 的 Animus.handlers.hover）。

       为什么这个出口必须在外壳上：桌面上那一摞瓦片是**外壳**画的，
       模块（记忆 / 声音 / 文字 / 显示 / 立绘那几页）根本不知道第 0 层有几格、
       光标停在哪一格上。而且鼠标划过和键盘 ↑↓ 走的是同一条高亮路径 ——
       两处各写一遍，迟早有一处漏掉。

       只在**用户真的动了**的时候发（划过 / ↑↓ / 指针离开导轨 / 关闭界面）。
       —— **"进入某一格"不发**（原来说"进入子页"也发一条 null），
       理由见 enterFolder 里那一段：那条 null 会让调用方把她的脸打回默认，
       于是"进子页"变成了"顺便回默认表情"。 */
    hover: null
  };

  /* 上一次**真的发出去**的 hover id。去重用 —— 见 pushHover。 */
  var hoveredId = null;

  /**
   * 悬停状态的**唯一出口**：通知外面"光标现在指着哪一格"（null = 不指着任何一格）。
   *
   * 两件事都放在这一个函数里，因为它们必须同时成立：
   *
   * 1. **没有调用方接就什么都不做。** 游戏页的暂停菜单没人接
   *    （那一页没有网页立绘），不该因此抛错。
   *
   * 2. **同一个 id 不重复发。** 去重必须在"发出去"这一层做，
   *    **不能拿 highlightIndex 代替**：开场那一格（`open()` 里的 `highlight(0)`）
   *    已经让 `highlightIndex = 0` 了，而那时候是**故意没发**的（见 handlers.hover）——
   *    拿 highlightIndex 当依据的话，「鼠标第一次划到最上面那一格」就永远不发，
   *    表现是"那一格看着是高亮的，她却没换表情"。
   *    去重还挡住 mousemove 的连发：不去重就是每动一个像素换一次表情，
   *    库那边每收到一次都要重头淡入一遍，看着一直在抖，控制台也会刷屏。
   */
  function pushHover(id) {
    if (id === hoveredId) {
      return;
    }

    hoveredId = id;

    if (typeof handlers.hover === 'function') {
      handlers.hover(id);
    }
  }

  /**
   * 子页通知：进了哪一页（`id`），或者"子页结束了"（`null`）。
   *
   * **进出必须对称。** 原来只有 enterFolder 里那一句 `handlers.page(id)`，
   * 「出来」没有对应的通知 —— 于是调用方只能知道"进去了"，不知道"出来了"，
   * 任何"进去时改了什么、出来要改回去"的东西都会留在里面那套状态上
   * （主菜单页的立绘姿态就是这么用的：进了「立绘」页她上台放大，
   * 退回来得收回基准位）。
   *
   * `null` 对现有调用方是安全的：游戏页（app.js）那边只认 'memory' / 'chapters'，
   * 判断天然忽略 null。
   */
  function notifyPage(id) {
    if (typeof handlers.page === 'function') {
      handlers.page(id);
    }
  }

  /* ============================================================
     工具
     ============================================================ */

  function make(tag, className, parent) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (parent) { parent.appendChild(node); }
    return node;
  }

  function clampNumber(v, min, max) {
    if (v < min) { return min; }
    if (v > max) { return max; }
    return v;
  }

  function smoothstep(t) {
    var x = clampNumber(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function easeOutCubic(t) {
    var p = 1 - clampNumber(t, 0, 1);
    return 1 - p * p * p;
  }

  /** 两头慢、中间快。相机的滑动用它 —— 匀速平移看起来像在"滚列表"。 */
  function easeInOutCubic(t) {
    var x = clampNumber(t, 0, 1);
    return x < 0.5
      ? 4 * x * x * x
      : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  /* ============================================================
     建 DOM（只建一次）
     ------------------------------------------------------------
     一次建好而不是每次开关重建：立绘和 #stage 都在同一个文档里，
     反复插入删除大块 DOM 会让旁边的东西重排 —— 会看到立绘"抖一下"。
     ============================================================ */
  function build() {
    if (el.root) {
      return;
    }

    el.root = make('div', '', document.body);
    el.root.id = 'animus';

    el.plate = make('div', 'ax-plate', el.root);

    make('div', 'ax-backdrop', el.plate);

    make('div', 'ax-grid', el.plate);
    make('div', 'ax-dots', el.plate);

    /* 空间层：铺满全屏的一层淡绳。
       "无论你在哪个子页面，背景里总能看到绳的局部在缓慢摆动" ——
       这一层就是那句话。画在所有内容下面。 */
    el.space = make('canvas', 'ax-space', el.plate);
    el.spaceCtx = el.space.getContext('2d');

    /* 数据流：几条往下淌的细线。随机参数在 buildStream() 里生成。 */
    el.stream = make('div', 'ax-stream', el.plate);
    buildStream();

    make('div', 'ax-vignette', el.plate);

    make('div', 'ax-corner tl', el.plate);
    make('div', 'ax-corner tr', el.plate);
    make('div', 'ax-corner bl', el.plate);
    make('div', 'ax-corner br', el.plate);

    // 标题
    el.head = make('div', 'ax-head', el.plate);
    el.kicker = make('div', 'ax-kicker', el.head);
    el.title = make('h2', 'ax-title', el.head);
    make('div', 'ax-title-rule', el.head);

    /* ============================================================
       右上角那块读数。**壳子只管它的形状和措辞，数字归记忆模块**
       （见 memory-module.js 的 pushReadout）。
       ============================================================ */

    el.sync = make('div', 'ax-sync', el.plate);

    /* 这个大读数的抬头。
       ------------------------------------------------------------
       换过两次：

         「同 步 率」    —— 照着 AC2 参考图搬的词（Animus 的"祖先记忆
                            同步"）。在参考图里成立，在我们这儿没有含义。
         「攻略进度」    —— 直白了。它把"这是个游戏机制"写在脸上，
                            而且"攻略"两个字把皖萱说成了一个攻略对象。

       现在用的是**归档** —— 这套界面自己的隐喻（顶栏写的就是
       「记 忆 归 档」，章节页上读过的章也标成「已归档」）。
       它不解释自己在量什么，但在这台机器里只有一个意思：
       这段记忆已经被收进来多少。数字在跳，说明机器在收。

       旁边那两行（章节 / 已读）负责把话说清楚，所以抬头可以含蓄。
       要再换的话只有一个词要改，就在这一行。 */
    make('div', 'ax-sync-label', el.sync).textContent = '归 档';

    el.syncValue = make('div', 'ax-sync-value', el.sync);
    el.syncNumber = make('span', '', el.syncValue);
    make('span', '', el.syncValue).textContent = '%';
    el.syncBar = make('div', 'ax-sync-bar', el.sync);
    el.syncSegments = [];
    for (var s = 0; s < SEGMENTS; s++) {
      el.syncSegments.push(make('i', '', el.syncBar));
    }
    el.syncRows = make('div', 'ax-sync-rows', el.sync);

    /* ============================================================
       第 0 层：Animus 桌面
       ------------------------------------------------------------
       .ax-rail     选文件夹的导轨（节点挂在绳上）
       .ax-connector 空间连线
       .ax-preview  右侧预览面板 —— 光标停在哪个文件夹上就显示它的摘要
       三样一起进进出出，所以包在一个组里（.ax-desktop）。
       ============================================================ */
    el.desktop = make('div', 'ax-desktop', el.plate);

    // 导轨 = 取景框；里面的 ax-rail-cam 才是会被相机推动的场景
    el.rail = make('div', 'ax-rail', el.desktop);
    el.railCam = make('div', 'ax-rail-cam', el.rail);
    el.railCanvas = make('canvas', 'ax-rail-canvas', el.railCam);
    el.railCtx = el.railCanvas.getContext('2d');
    make('div', 'ax-focus-line', el.rail);

    /* 空间连线：从对焦线横穿到预览面板。
       静态的 —— 它是这个空间的一部分，不是切换动效。 */
    make('div', 'ax-connector', el.desktop);

    el.preview = make('div', 'ax-preview', el.desktop);

    // 内容（第 1 层）
    el.body = make('div', 'ax-body', el.plate);

    // 底栏
    el.foot = make('div', 'ax-foot', el.plate);
    el.actions = make('div', 'ax-actions', el.foot);

    /* 左下角面包屑。参考图里永远有这一行（「◆ ANIMUS桌面」），
       很小，但少了它就不像那套界面 —— 它是"这是个操作系统"的口气。
       **文案用我们自己的名字**（`BREADCRUMB_ROOT` = 记忆归档），
       不照搬参考作品那个品牌词，见那边的注释。
       （右下角那两颗按键提示原来和它成对，已经删了，见下面那一大段。） */
    el.breadcrumb = make('div', 'ax-breadcrumb', el.plate);

    // 覆盖层放最后：它们要盖在所有东西上面
    make('div', 'ax-tear', el.plate);
    make('div', 'ax-scanbar', el.plate);

    bindKeys();
    bindRail();
    window.addEventListener('resize', onResize);
  }

  /**
   * 数据流的随机参数只生成一次 —— 每次开菜单都重掷会显得很躁。
   *
   * 14 条 1px 竖线，每条自己一条道（left），高度 22~62%，从上面往下淌。
   * 三个随机量分开掷：**位置、高度、周期**。只用位置随机的话，
   * 所有线会以同一个速度、同一种长度整片往下刷 —— 那看着像刷新，
   * 不像"机器在灌数据"。
   *
   * （这一层中间被换掉过一次：试过改成"浮尘"，理由是光里看得见灰。
   *   连同窗光一起撤了 —— 用户看过之后明确只要数据流。） */
  function buildStream() {
    for (var i = 0; i < 14; i++) {
      var bar = make('i', '', el.stream);
      bar.style.left = (2 + Math.random() * 94).toFixed(2) + '%';
      bar.style.height = (22 + Math.random() * 40).toFixed(1) + '%';
      bar.style.opacity = (0.25 + Math.random() * 0.6).toFixed(2);
      bar.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + 's';
      bar.style.animationDelay = (-Math.random() * 14).toFixed(1) + 's';
    }
  }
  /* ============================================================
     模块
     ============================================================ */

  function register(module) {
    if (!module || !module.id) {
      return;
    }
    modules.push(module);
    modules.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function resolveShown() {
    var wanted = frame.modules;

    shown = modules.filter(function (m) {
      if (wanted && wanted.indexOf(m.id) < 0) {
        return false;
      }
      return typeof m.available !== 'function' || m.available();
    });
  }

  /* ============================================================
     绳的几何
     ------------------------------------------------------------
     全篇用"沿绳的归一位置 u（0..1）"来描述位置，像素只在绘制时算。
     节点的 u 由它的高度决定，横坐标再从这个 u 求出来 ——
     这一条是"节点挂在绳上"的全部秘密。别改成"按序号排"，
     那就又变回选项卡列表了。
     ============================================================ */

  function railSize() {
    return { w: el.railW || 0, h: el.railHCam || 0 };
  }

  /** 绳在 u 处的相位（弧度）。旋转量随时间走。 */
  function phaseAt(u, spin) {
    return u * CFG.turns * Math.PI * 2 + spin;
  }

  /** 绳在 u 处的横坐标（像素，相对导轨左边缘）。 */
  function nodeXAt(u, spin, w) {
    return w * CFG.helixX + w * CFG.amplitude * Math.sin(phaseAt(u, spin));
  }

  function spinAngle(now) {
    return (now / 1000) / CFG.spinSeconds * Math.PI * 2;
  }

  /* ============================================================
     导航
     ============================================================ */

  function buildRail() {
    var old = el.rail.querySelectorAll('.ax-node');
    for (var i = 0; i < old.length; i++) {
      old[i].remove();
    }

    el.nodes = shown.map(function (module, index) {
      var node = make('button', 'ax-node', el.railCam);
      node.type = 'button';
      node.setAttribute('data-module', module.id);

      /* 三个部件分开定位：
           tile 挂在绳上（横坐标每帧算）
           lead 从 tile 连到标签（长度每帧算）
           text 固定不动（否则标签会跟着绳一起晃，读不了） */
      node.tile = make('span', 'ax-node-tile', node);
      node.lead = make('span', 'ax-node-lead', node);

      var text = make('span', 'ax-node-text', node);
      make('span', 'ax-node-no', text).textContent = module.no || ('0' + (index + 1));
      make('span', '', text).textContent = module.label || module.id;

      return node;
    });
  }

  /* ============================================================
     导轨上的三件事：点一下、划过、离开
     ------------------------------------------------------------
     **只注册一次**（在 build() 里调），不放在 buildRail() 里。
     buildRail() 每次"换一摞瓦片"都会被调（open / 进子桌面 / 返回 / refreshNav），
     而 `addEventListener` 写在里面就**每调一次多注册一份**：
       - 点一次「设置」会被两个监听器各处理一遍 → 子桌面被压两次栈
         → 退出来要按两次「返回」；
       - 划过一格会连着换两次表情、重画两遍预览面板。
     委托本身不需要跟着节点重建 —— 它挂在 el.rail 上，节点是它的子元素。
     ============================================================ */
  function bindRail() {
    el.rail.addEventListener('click', function (event) {
      var node = event.target.closest ? event.target.closest('.ax-node') : null;
      if (!node || level !== 0) {
        return;
      }
      event.stopPropagation();

      /* 点一下 = 进入。悬停只换高亮和预览（见下面的 mousemove）。 */
      enterFolder(node.getAttribute('data-module'));
    });

    /* 悬停：**挂在 mousemove 上，不挂 mouseenter。**
       mouseenter 是"指针底下的元素变了"就触发 —— 而元素位置正是被镜头
       决定的，于是"悬停 → 镜头动 → 元素从光标底下溜走 → 又触发悬停"
       变成一个闭环，光标不动画面也一直抖。

       mousemove 只在**指针真的动了**的时候触发，闭环就断了。
       顺带还解决另一个问题：键盘 ↑↓ 把高亮移到第 5 格时，
       停着不动的鼠标不会把选择抢回去。

       camera:false —— 悬停**不许动镜头**（理由见 highlight 的注释）。 */
    el.rail.addEventListener('mousemove', function (event) {
      if (level !== 0 || !event.target.closest) {
        return;
      }

      var node = event.target.closest('.ax-node');
      if (!node) {
        return;
      }

      var index = el.nodes.indexOf(node);
      if (index < 0) {
        return;
      }

      if (index !== highlightIndex) {
        highlight(index, { camera: false, quiet: true });
      }

      /* 换表情的出口。**这一句在 `if (index !== highlightIndex)` 外面** ——
         开场那一格本来就带着高亮（`open()` 里的 `highlight(0)`），
         写在里面的话"鼠标第一次划到最上面那一格"就永远不会发。
         重复发送由 pushHover 自己去重（同一个 id 不发第二次）。 */
      pushHover(node.getAttribute('data-module'));
    });

    /* 指针离开导轨 → 恢复默认表情（发 null）。
       挂 mouseleave 而不是"划过瓦片之间的空白"：导轨是这一摞瓦片的共同容器，
       它才是"指着某一格"这个状态的范围。而且 mouseleave 不冒泡，
       只能挂在这一层上 —— 挂在节点上就得随节点一起重建。 */
    el.rail.addEventListener('mouseleave', function () {
      pushHover(null);
    });
  }

  /**
   * 纵向排布。**纵向位置是算出来的、横向才由绳决定** ——
   * 反过来（横向等距）就成了选项卡。
   *
   * 坐标系是**场景**（.ax-rail-cam），不是取景框 ——
   * 场景比取景框上下各多出 overscan，节点在场景里只占
   * nodeTopU..nodeTopU+nodeSpanU 这一截，上下空出来的绳就是"空间还在延伸"。
   *
   * **行高直接取成格距**，让相邻两格严丝合缝。不这么做的话行与行之间会留下
   * 十来个像素的空档，鼠标滑过去时高亮会"掉一下" —— 手感上就是"卡"。
   */
  function layoutNodes() {
    if (!el.nodes || !el.nodes.length) {
      return;
    }

    var hCam = camHeight();
    if (hCam <= 0) {
      return;
    }

    var n = el.nodes.length;
    el.nodeU = [];

    var stride = n > 1 ? (CFG.nodeSpanU * hCam) / (n - 1) : CFG.nodeSpanU * hCam;

    for (var i = 0; i < n; i++) {
      var node = el.nodes[i];

      var u = n > 1
        ? CFG.nodeTopU + (CFG.nodeSpanU / (n - 1)) * i
        : CFG.nodeTopU + CFG.nodeSpanU / 2;

      var centre = u * hCam;

      node.style.height = stride.toFixed(1) + 'px';
      node.style.transform = 'translateY(' + (centre - stride / 2).toFixed(1) + 'px)';
      el.nodeU.push(u);
    }
  }

  /**
   * 场景的高度（CSS 像素）。
   *
   * **直接问 DOM，不自己乘 overscan。**
   * 这个值本来是 CSS（`.ax-rail-cam { top/bottom: -32% }`）和这里
   * （`CFG.overscan`）各写一份的 —— 我把 CFG 改成 0.15 却忘了改 CSS，
   * 结果节点按 871px 摆、画布却是 1098px，选中最后一个条目时头两格直接
   * 跑出画面。**一个常量写两遍必然漂移**，所以现在只留 CSS 那份。
   */
  function camHeight() {
    return el.railCam ? el.railCam.clientHeight : 0;
  }

  function onResize() {
    resizeRailCanvas();
    resizeSpaceCanvas();
    layoutNodes();
  }

  function resizeRailCanvas() {
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var w = el.rail.clientWidth;
    var h = el.rail.clientHeight;
    var hCam = camHeight();

    if (w <= 0 || h <= 0) {
      return;
    }

    el.railCanvas.width = Math.round(w * dpr);
    el.railCanvas.height = Math.round(hCam * dpr);
    el.railDpr = dpr;
    el.railW = w;
    el.railH = h;
    el.railHCam = hCam;
  }

  /* ============================================================
     画绳
     ------------------------------------------------------------
     和主菜单背景那条是**两种东西**，别混：
       主菜单那条是"环境"，大、慢、淡，被压在遮罩下面；
       这一条是"导航"，节点挂在上面，光标沿着它走。
     所以没有复用 background.js 的代码 —— 复用了反而两边都改不动。
     ============================================================ */
  function drawRail(now) {
    var ctx = el.railCtx;

    if (!ctx || !el.railW) {
      return;
    }

    var size = railSize();
    var W = size.w;
    var H = size.h;
    var spin = spinAngle(now);
    var fade = H * 0.11;

    ctx.setTransform(el.railDpr, 0, 0, el.railDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ---- 一根索引绳 ----
    /* **只有一根，而且没有横档。**
       上一版这里是"两条正弦 + 一根根横档" —— 那正是 DNA 的样子
       （两条链 + 碱基对），和剧本对不上，所以整个删掉。

       现在它是一根被上下两端拉住、在中间荡开的绳。纵向 alpha 走渐变，
       绳在画面外自然消失，不用画端点。 */
    var cordGrad = ctx.createLinearGradient(0, 0, 0, H);
    cordGrad.addColorStop(0, 'rgba(' + INK + ',0)');
    cordGrad.addColorStop(fade / H, 'rgba(' + INK + ',0.16)');
    cordGrad.addColorStop(0.5, 'rgba(' + INK + ',0.46)');
    cordGrad.addColorStop(1 - fade / H, 'rgba(' + INK + ',0.16)');
    cordGrad.addColorStop(1, 'rgba(' + INK + ',0)');

    ctx.beginPath();
    for (var y2 = 0; y2 <= H; y2 += CFG.sampleStep) {
      var x = nodeXAt(y2 / H, spin, W);
      if (y2 === 0) { ctx.moveTo(x, y2); } else { ctx.lineTo(x, y2); }
    }
    ctx.strokeStyle = cordGrad;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.stroke();

    /* ---- 换页时的那段亮弧 ----
       从旧节点所在的 u 跑到新节点所在的 u，跑完就淡掉。
       这是"光标在绳上移动"，不是"选项卡被点亮"。 */
    if (travel && el.nodeU) {
      var age = (now - travel.at) / CFG.travelMs;

      if (age >= 1) {
        travel = null;
      } else {
        var head = travel.fromU + (travel.toU - travel.fromU) * easeOutCubic(age);
        var lo = Math.min(travel.fromU, head);
        var hi = Math.max(travel.fromU, head);

        ctx.beginPath();
        for (var y3 = lo * H; y3 <= hi * H; y3 += CFG.sampleStep) {
          var u3 = y3 / H;
          var x3 = W * CFG.helixX + W * CFG.amplitude * Math.sin(phaseAt(u3, spin));
          if (y3 === lo * H) { ctx.moveTo(x3, y3); } else { ctx.lineTo(x3, y3); }
        }
        ctx.strokeStyle = 'rgba(' + MARK + ',' + (0.9 * (1 - age)).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();

        // 光点
        var hx = W * CFG.helixX + W * CFG.amplitude * Math.sin(phaseAt(head, spin));
        ctx.beginPath();
        ctx.arc(hx, head * H, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,246,224,' + (0.95 * (1 - age)).toFixed(3) + ')';
        ctx.fill();
      }
    }

    /* ---- 每个节点：绳上的挂点 + 到标签的引线 ----
       横坐标每帧算，所以它是真的"挂在绳上"、随绳摆动左右游走。 */
    if (!el.nodeU) {
      return;
    }

    var labelX = W * CFG.labelX;

    for (var i = 0; i < el.nodes.length; i++) {
      var node = el.nodes[i];
      var u4 = el.nodeU[i];
      var dotX = nodeXAt(u4, spin, W);
      var hot = node.classList.contains('active');

      node.tile.style.transform = 'translateX(' + dotX.toFixed(1) + 'px)';
      node.lead.style.transform = 'translateX(' + dotX.toFixed(1) + 'px)';
      node.lead.style.width = Math.max(0, labelX - dotX).toFixed(1) + 'px';
    }
  }

  function railLoop(now) {
    rafId = window.requestAnimationFrame(railLoop);

    /* 和主菜单背景一样：**不判断 document.hidden**。
       UWB 是 CEF 离屏渲染，visibilityState 可能一直是 hidden 而画面照画。 */
    var t = now || performance.now();

    /* 空间那一层铺满全屏（1920x1080 = 2M 像素），每帧重画在 CEF 里不便宜。
       而它只是缓慢漂移的氛围 —— 每 3 帧画一次（约 20fps）完全够，
       成本直接降到三分之一。导轨那条绳是导航，必须每帧画。 */
    el.spaceTick = (el.spaceTick || 0) + 1;
    if (el.spaceTick % 3 === 1) {
      drawSpace(t);
    }

    updateCamera(t);
    drawRail(t);
    tickSync(t);
  }

  /* ============================================================
     相机
     ------------------------------------------------------------
     切子页 = 镜头沿绳滑到那个节点，把它送到对焦线上，顺便推近一点再收回。

     和别处同一个规矩：**不留累加状态**。pan 由 now 现算，
     所以跳帧、卡顿、只画一帧，结果都一样。
     ============================================================ */
  function updateCamera(now) {
    if (!el.railCam) {
      return;
    }

    var t = CFG.camMs <= 0 ? 1 : clampNumber((now - cam.at) / CFG.camMs, 0, 1);
    var e = easeInOutCubic(t);

    cam.panNow = cam.panFrom + (cam.panTo - cam.panFrom) * e;

    /* 推近的曲线是 sin(πt)：起止都是 0，中间最大。
       纯平移看不出"推近"，加这一下才有镜头感。 */
    var zoom = 1 + CFG.zoomBump * Math.sin(Math.PI * t);

    /* 进入 / 离开文件夹时**额外**推一下。
       它和上面的滑动是叠加的（各有各的时间戳），所以读起来是
       "一边滑一边推近"的一次动作，而不是两段动画接在一起。 */
    if (cam.enterAt) {
      var et = (now - cam.enterAt) / CFG.enterMs;

      if (et >= 1) {
        cam.enterAt = 0;
      } else {
        zoom += CFG.enterZoom * Math.sin(Math.PI * clampNumber(et, 0, 1));
      }
    }

    el.railCam.style.transform =
      'translate3d(0,' + cam.panNow.toFixed(2) + 'px,0) scale(' + zoom.toFixed(4) + ')';
  }

  /**
   * 把镜头对准第 index 个节点。animate 为 false 时直接就位（开场用）。
   *
   * 对焦线在取景框正中，也就是场景的 u = 0.5（场景和取景框同心）。
   */
  function aimCamera(index, now, animate) {
    if (!el.nodeU || el.nodeU[index] === undefined) {
      return;
    }

    var hCam = camHeight();
    var target = (0.5 - el.nodeU[index]) * hCam;

    cam.panFrom = animate ? cam.panNow : target;
    cam.panTo = target;
    cam.activeU = el.nodeU[index];

    /* 不animate 时把时间推到头：t 直接等于 1，不用另写一条分支。 */
    cam.at = animate ? now : now - CFG.camMs;
  }

  /* ============================================================
     空间层：铺满全屏的一层淡绳
     ------------------------------------------------------------
     "无论你在哪个子页面，背景里总能看到绳的局部在缓慢摆动" ——
     这一层就是那句话。它是**环境**，不是导航：
     比导轨那条大得多、淡得多、慢得多，画在所有内容下面。

     有了它，四个子页读起来才像"同一个空间里的四个机位"，
     而不是"四张幻灯片"。
     ============================================================ */
  function drawSpace(now) {
    var ctx = el.spaceCtx;

    if (!ctx || !el.spaceW) {
      return;
    }

    var S = CFG.space;
    var W = el.spaceW;
    var H = el.spaceH;
    var cx = W * S.x;
    var amp = W * S.amplitude;
    var spin = (now / 1000) / S.spinSeconds * Math.PI * 2;

    ctx.setTransform(el.spaceDpr, 0, 0, el.spaceDpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 一根绳（和导轨那根同一个做法，只是更淡更慢；没有横档）
    ctx.beginPath();
    for (var y2 = 0; y2 <= H; y2 += S.step) {
      var uu = y2 / H;
      var x = cx + amp * Math.sin(uu * S.turns * Math.PI * 2 + spin);
      if (y2 === 0) { ctx.moveTo(x, y2); } else { ctx.lineTo(x, y2); }
    }
    ctx.strokeStyle = 'rgba(' + CYAN + ',' + S.cordAlpha.toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function resizeSpaceCanvas() {
    /* 这一层的 DPR 封在 1：它铺满全屏、又全是低对比的软结构，
       1.5 倍只是白烧 CPU（1920x1080 下是 4.6M 像素/帧）。 */
    var dpr = 1;
    var w = window.innerWidth || 1920;
    var h = window.innerHeight || 1080;

    el.space.width = Math.round(w * dpr);
    el.space.height = Math.round(h * dpr);
    el.spaceDpr = dpr;
    el.spaceW = w;
    el.spaceH = h;
  }

  /* ============================================================
     右上角那块读数
     ------------------------------------------------------------
     代码里的 `sync*` 这套名字是从"同步率"那版留下来的（那是照着 AC 参考图
     起的）。显示出来的抬头现在换成了「归 档」，但标识符没跟着改 ——
     改名的收益只有好看，代价是要动 app.js / README / 一堆注释，
     不划算。看到 sync 就当"右上角那块读数"读。
     ============================================================ */

  /**
   * 目标值。
   * @param ratio 0..1，或 null（没有真实进度时走"环境漂移"，见 tickSync）
   * @param rows  下面那两行 [抬头, 值]；不传就不动（见 setStatus）
   */
  function setSync(ratio, rows) {
    syncTarget = (typeof ratio === 'number' && isFinite(ratio))
      ? clampNumber(ratio, 0, 1)
      : null;

    if (rows) {
      renderRows(rows);
    }

    // 从现在显示的值开始数，而不是从 0 —— 换页时不该整条归零重数
    syncCountFrom = syncShown;
    syncCountAt = performance.now();
  }

  function renderRows(rows) {
    if (!el.syncRows) {
      return;
    }

    frame.rows = rows || [];
    el.syncRows.innerHTML = '';

    frame.rows.forEach(function (row) {
      var line = make('div', 'ax-status-row', el.syncRows);
      make('span', '', line).textContent = row[0] + '  ';
      make('b', '', line).textContent = row[1];
    });
  }

  /* ============================================================
     右下角的按键提示 —— **整块删掉了。**
     ------------------------------------------------------------
     原来那里是两个圆钮：「↑↓ 选择」和「Esc 关闭 / 返回」，
     从参考图（`L 浏览 / B 选择 / O 返回`）搬过来的。

     先发现的是它在第 1 层（各个页面里）**是错的**：方向键在外壳里
     只被第 0 层的节点列表接管，第 1 层是交给模块自己的 ——
     而章节页、设置页都没有"上下选择"这回事，写着就是骗人。
     于是先改成只有第 0 层画。

     然后就发现第 0 层其实也不需要它：
       · 「↑↓ 选择」—— 一摞瓦片上下排着，鼠标划过就高亮，
         本来就不需要一句说明；键盘玩家按一下方向键也就知道了。
       · 「Esc 关闭」—— 主菜单那台桌面本来也没有别的按钮表达"关闭"，
         但这句提示的价值抵不上它在画面右下角占的那一块。
     界面上少一块一直亮着、又没人读的小字，桌面本身更干净。

     所以：DOM 不建、CSS 删掉、调用点全部撤掉（见 bindKeys 那边）。
     键盘行为**一点没变** —— ↑↓ / Enter / Esc 该做的还做，
     只是不再有个牌子告诉你。
     ============================================================ */

  /** 左下角面包屑：金菱形 + 当前位置。**带上路径**（桌面 › 设置）。 */
  function renderBreadcrumb() {
    if (el.breadcrumb) {
      el.breadcrumb.textContent = path.join('  ›  ');
    }
  }

  /**
   * 每帧推进同步率。
   *
   * 两条路：
   *   · 调用方给了真实进度 → 从当前显示值数到目标值（开场就是一段"同步中"）
   *   · 没给 → 走一条很慢的环境漂移，只为了"这台机器在跑"
   *
   * 数字**一直在动**是刻意的：静止的读数是装饰，走动的读数才让人相信
   * 它真的在同步什么。
   */
  function tickSync(now) {
    if (!el.syncNumber) {
      return;
    }

    var value;

    if (syncTarget !== null) {
      var t = (now - syncCountAt) / CFG.syncCountMs;
      value = syncCountFrom + (syncTarget - syncCountFrom) * easeOutCubic(t);
      syncShown = value;
    } else {
      // 0.318 是随便挑的一个无理数倍率：它保证数字永远不落回同一个值，
      // 用整数倍率的话每隔几秒会看到一次明显的重复（像卡住）。
      value = 0.42 + 0.10 * Math.sin(now / 9000) + 0.02 * Math.sin(now / 1900);
      syncShown = value;
    }

    el.syncNumber.textContent = (value * 100).toFixed(1);

    var lit = Math.round(clampNumber(value, 0, 1) * SEGMENTS);
    if (lit !== lastTip) {
      lastTip = lit;
      for (var i = 0; i < el.syncSegments.length; i++) {
        el.syncSegments[i].classList.toggle('on', i < lit);
        el.syncSegments[i].classList.toggle('tip', i === lit - 1);
      }
    }
  }

  /* ============================================================
     第 0 层：桌面 —— 移动光标（不进入）
     ============================================================ */

  /**
   * 把光标移到第 index 个文件夹上。
   *
   * **它不进入。** 进入是另一件事（enterFolder）。分开的理由：
   * 参考图里光标在文件夹之间移动时，画面变的是**右侧预览面板**和**镜头**，
   * 不是内容本身 —— 你得按确认才推门进去。
   *
   * ## 谁能动镜头，谁不能（这条是手感的关键）
   *
   * `opts.camera` 默认 true，但**鼠标悬停必须传 false**。
   *
   * 为什么：镜头一动，标签就从光标底下滑走，光标落到下一格上，
   * 触发下一次悬停、镜头又动 —— 是个**闭环**，光标停在原地画面也会一直抖。
   * （这个坑当场踩过：鼠标不动，选项不停自己跳。）
   *
   * 所以：
   *   鼠标悬停  camera:false  —— 只换高亮和预览面板
   *   键盘 ↑↓   camera:true   —— 键盘没有"指针被挪走"这回事
   *   进入/返回 camera:true   —— 推近拉远
   *
   * 而且悬停这一路是挂在 **mousemove** 上、不是 mouseenter 上的：
   * mouseenter 是"元素变了"就触发，而元素位置正是被镜头决定的；
   * mousemove 只在**指针真的动了**的时候触发。
   * 于是"键盘把高亮移到第 5 格、而鼠标恰好停在原来的位置上"这种
   * 情况不会把键盘的选择抢走 —— 鼠标不动，画面就不理它。
   */
  function highlight(index, opts) {
    if (!shown.length) {
      return;
    }

    var options = opts || {};
    var moveCamera = options.camera !== false;
    var quiet = options.quiet === true;

    var n = shown.length;
    index = ((index % n) + n) % n;

    var first = activeIndex < 0;
    highlightIndex = index;
    activeId = shown[index].id;

    if (index !== activeIndex) {
      if (moveCamera) {
        if (activeIndex >= 0 && el.nodeU && el.nodeU[activeIndex] !== undefined) {
          travel = { fromU: el.nodeU[activeIndex], toU: el.nodeU[index], at: performance.now() };
        }

        /* 镜头沿绳滑过去把这个节点送到对焦线上。
           首次打开直接就位，不放滑动 —— 开场那一下滑动会让人以为"刚才在别的地方"。 */
        aimCamera(index, performance.now(), options.animate !== false && !first);
      }

      if (!quiet) {
        desync();
      }
    }

    activeIndex = index;

    el.nodes.forEach(function (node, i) {
      node.classList.toggle('active', i === index);
    });

    renderPreview(shown[index]);
  }

  /* ============================================================
     第 0 → 1 层：进入一个文件夹
     ============================================================ */

  function enterFolder(id) {
    var module = null;
    var index = -1;

    for (var i = 0; i < shown.length; i++) {
      if (shown[i].id === id) {
        module = shown[i];
        index = i;
        break;
      }
    }

    if (!module) {
      return;
    }

    if (index !== highlightIndex) {
      // 这里是"要进去了"，所以镜头要跟着走（和鼠标悬停相反）
      highlight(index, { camera: true });
    }

    /* ============================================================
       **"进去了"不发 hover(null)。**
       ------------------------------------------------------------
       原来这里有一条 `pushHover(null)`（"光标不再指着桌面上某一格"），
       本意是"点进设置之后她不该还挂着那一格的表情"。
       但那一句的代价是：调用方收到 null 就按"没指着任何一格"处理 ——
       主菜单页那边是**恢复默认表情**。于是"进子页"变成了
       "顺便回默认表情"：玩家只是想调个参数，她的脸却跳一下。
       （紧接着的 `page(id)` 又是"没意见"，接不回来，所以只能从源头改。）

       现在不发：**进任何一格都不动她**。进入子页/子桌面之后，
       指针一动就会有 mousemove → 新的一格自己会发出来（去重只按 id 比，
       换了格子必然不同），所以不会留下"指着这一格却按那一格算"的状态。

       只有两种 null 保留：**指针真的离开导轨**、**界面关掉**
       （见 bindRail 的 mouseleave 和 close）。
       ============================================================ */

    /* ---- 动作瓦片 ----
       参考图的桌面里「继续」「放弃记忆」「离开」和「归档」「物品」「数据库」
       是**混在同一摞瓦片里**的。所以我们也不把动作单独做成底栏一排，
       它就是一格瓦片，只是进去的方式不是"推门"而是"执行"。

       放在这里而不是点击处，是为了让键盘回车和鼠标点击走同一条路 ——
       两条路各写一遍迟早有一条漏掉。 */
    if (typeof module.run === 'function') {
      desync();
      module.run();
      return;
    }

    /* ---- 子桌面（文件夹套文件夹）----
       参考图里「物品」进去之后是另一摞瓦片（武器/补给品/物品/服装），
       不是一个内容页。所以带 children 的模块进去的是**新的一屏桌面**：
       把当前这一屏压进栈里，换成子项那一摞，光标回到第一格。

       注意这里**不切到第 1 层** —— 目之所及只是换了一摞瓦片，
       顶栏、导轨、预览面板、面包屑都还在原位。 */
    if (module.children) {
      stack.push({
        modules: frame.modules,
        title: frame.title,
        kicker: frame.kicker,
        rows: frame.rows,
        highlight: highlightIndex
      });

      path.push(module.label || module.id);

      frame.modules = module.children;
      frame.title = module.label || frame.title;
      frame.kicker = module.code || frame.kicker;
      frame.rows = typeof module.preview === 'function' ? module.preview() : [];

      resolveShown();
      buildRail();
      layoutNodes();
      renderRows(frame.rows);
      renderHead(null);
      renderBreadcrumb();
      /* 提示语也要刷 —— 进了文件夹之后 Esc 的含义从"关闭"变成了"返回"，
         不刷的话底栏会一直写着"Esc 关闭"。 */
      renderFooter(null);

      /* 上了新的一摞之后镜头重新就位，**两件事分开**：
           - `highlight(…, camera:false)` = **不滑动**：这不是"移动"，是"换了一屏"
             （滑动是给"光标在同一摞里换了一格"用的）
           - `cam.enterAt` = **推门那一下要有**：新那一摞会往前压一点再收住
             （更新摄像头时叠一层 enterZoom，见 updateCamera）。

         ⚠ 原来这里只有第一件、没有第二件，所以"进设置"是硬切、"从子页退回设置页"
         才有那一下 —— 同一次"进出文件夹"两侧不对称，看着像进的时候卡了一下。
         `enterZoom` / `enterMs` 的配置注释本来就写着这是"进入 / 离开一个文件夹"
         共用的那一下，所以这里补上才是原意。 */
      activeIndex = -1;
      highlight(0, { camera: false, quiet: true });
      cam.enterAt = performance.now();
      desync();
      return;
    }

    // 第一次进才构建内容 —— 玩家通常只进一两个文件夹
    if (!built[module.id]) {
      module.build(el.body);
      built[module.id] = true;
    }

    var pages = el.body.querySelectorAll('.ax-page');
    var page = null;
    for (var j = 0; j < pages.length; j++) {
      var on = pages[j].getAttribute('data-module') === id;
      pages[j].classList.toggle('active', on);
      if (on) { page = pages[j]; }
    }

    level = 1;
    el.root.classList.add('level-1');

    if (page) {
      /* 碎片拼合 + 失同步。每次进都放 ——
         它是"这一段数据开始渲染"的那一下，不只是入场动画。 */
      page.classList.remove('enter', 'desync');
      void page.offsetWidth;
      page.classList.add('enter', 'desync');
    }

    /* 推门那一下：镜头往前压。把 enterAt 打上时间戳，updateCamera 会
       在 camMs 之内叠一层 zoom —— 它是"在滑动的同时推近"，不是两段动画。 */
    cam.enterAt = performance.now();

    renderHead(module);
    path.push(module.label || module.id);
    renderBreadcrumb();
    renderFooter(module);

    desync();

    if (typeof module.refresh === 'function') {
      module.refresh(page);
    }

    notifyPage(id);
  }

  /**
   * 返回上一层。三种情况，从里往外：
   *   第 1 层（内容页）→ 回到它所属的那一屏桌面
   *   栈里还有东西（子桌面）→ 弹回上一屏桌面
   *   都不是 → 什么都不做（外壳的 close 由调用方决定）
   */
  function leaveFolder() {
    if (level === 1) {
      /* 通知模块"你被收起来了"。
         有自己 rAF / setInterval 的模块必须在这里停掉 —— 界面收起来了，
         它的循环还在后台烧 CPU，而且现场完全看不出来。 */
      var module = null;
      for (var i = 0; i < shown.length; i++) {
        if (shown[i].id === activeId) { module = shown[i]; break; }
      }
      if (module && typeof module.leave === 'function') {
        module.leave();
      }

      level = 0;
      el.root.classList.remove('level-1');

      path.pop();
      renderHead(null);
      renderBreadcrumb();
      renderFooter(null);

      // 拉回来也推一下镜头 —— 进出都要有，只做一半会很突兀
      cam.enterAt = performance.now();

      /* "子页结束了" —— **和进去时那一句 notifyPage(id) 对称**。
         少了它，调用方只知道"进去了"，任何"进去时改了什么、出来要改回去"
         的东西都会卡在里面那一套上（主菜单页的立绘姿态就是靠它收回基准位的）。 */
      notifyPage(null);

      /* 回桌面：把**悬停去重的状态清掉，但一声不吭**。
         不清的话：指针还停在"当初点进去的那一格"上（刚点完，指针没动过），
         在这一格上动鼠标时 `pushHover` 会认为"还是那一格"而不发 ——
         调用方那边刚被 page(null) 打回默认，于是她会**一直停在默认表情**，
         要移到别的格子上才恢复。
         （这也是"进去时不再发 hover(null)"的代价，所以在这儿补上。） */
      hoveredId = null;

      desync();
      return;
    }

    if (stack.length) {
      var prev = stack.pop();

      frame.modules = prev.modules;
      frame.title = prev.title;
      frame.kicker = prev.kicker;
      frame.rows = prev.rows;

      path.pop();

      resolveShown();
      buildRail();
      layoutNodes();
      renderRows(frame.rows);
      renderHead(null);
      renderBreadcrumb();
      /* 提示语要跟着一起回去 —— 退到根之后 Esc 的含义又从"返回"变回
         frame.escLabel（主菜单是"关闭"）。少了这一句，根那一层的底栏会一直
         写着「Esc 返回」，和实际行为对不上（真的按下去什么都不做）。 */
      renderFooter(null);

      /* 光标回到**当初进来的那一格**上。
         不还回去的话，"进去看一眼再退出来"每次都会跳回第一项。 */
      activeIndex = -1;
      highlight(prev.highlight, { camera: false, quiet: true });

      /* 弹回上一屏也要推一下镜头 —— 和上面"第 1 层 → 第 0 层"、以及
         "进子桌面"（enterFolder 那条）对称。这条原来也是漏的：
         从「设置」退回主桌面是硬切，而从子页退回「设置」才有那一下。
         规矩见第 1 层那条的注释："进出都要有，只做一半会很突兀"。 */
      cam.enterAt = performance.now();

      desync();
    }
  }

  /** 顶栏：第 0 层是应用名，第 1 层是文件夹自己的记录号。 */
  function renderHead(module) {
    if (module) {
      el.kicker.textContent = module.code || ('REC · ' + (module.no || ''));
      el.title.textContent = module.label || module.id;
    } else {
      el.kicker.textContent = frame.kicker;
      el.title.textContent = frame.title;
    }
  }

  /**
   * Esc 提示语该写什么。
   *
   * **只要还能往后退一层，就说「返回」。** 第 0 层的根（主菜单桌面、暂停菜单
   * 桌面）才是调用方给的那个词（"关闭"）。提示语和实际行为必须是同一件事 ——
   * 写"关闭"却只是退一层，玩家会以为按坏了。
   */
  function backLabel() {
    if (level === 1 || stack.length) {
      return '返回';
    }

    return frame.escLabel || '返回';
  }

  /**
   * 底栏按钮。
   *
   * 三种情况：
   *   第 1 层（内容页）→ 模块自己的动作 + 返回
   *   子桌面（栈非空）→ 调用方的动作 + 返回
   *   第 0 层的根      → 只有调用方的动作
   *
   * **中间那条是后补的，它是个真 bug 的修法。** 原来只有"有模块"和"没模块"
   * 两种情况，没模块就直接取 `frame.actions` —— 而主菜单那一摞的 actions 是
   * 空数组。于是点进「设置」之后**底栏一个按钮都没有，鼠标点不回去**；
   * 同时 Esc 在第 0 层又落到 `handlers.esc` 上被调用方吃掉（主菜单返回 true，
   * 等于什么都不做）。两条路一起断 —— 表现就是"设置页没有返回"（用户报的）。
   *
   * 教训：**"能不能退出去"不能只由底栏按钮负责，也不能只由 Esc 负责。**
   * 两条路都要各自成立。
   */
  function renderFooter(module) {
    var back = { id: 'back', label: '返回', primary: true };
    var actions;

    if (module) {
      actions = (module.actions || []).concat([back]);
    } else if (stack.length) {
      actions = (frame.actions || []).concat([back]);
    } else {
      actions = frame.actions;
    }

    el.actions.innerHTML = '';

    actions.forEach(function (action) {
      var button = make('button', 'ax-action' + (action.primary ? ' primary' : ''), el.actions);
      button.type = 'button';
      button.textContent = action.label;
      button.setAttribute('data-action', action.id);
      button.addEventListener('click', function (event) {
        event.stopPropagation();

        /* 「返回」由外壳自己处理 —— 每个模块都写一遍"返回上一层"
           迟早会有一边忘了，表现就是"这一页出不去"。 */
        if (action.id === 'back') {
          leaveFolder();
          return;
        }

        if (typeof handlers.action === 'function') {
          handlers.action(action.id);
        }
      });
    });

    el.foot.classList.toggle('no-actions', !actions.length);
  }

  /* ============================================================
     第 0 层右侧的预览面板
     ------------------------------------------------------------
     光标停在哪个文件夹上就显示它的摘要。参考图里那一栏是
     一张图 + 一段说明；我们没有图，就用**读数**代替 ——
     它同时还是"这一页有什么可调"的预告。
     ============================================================ */
  function renderPreview(module) {
    if (!el.preview) {
      return;
    }

    el.preview.innerHTML = '';

    if (!module) {
      return;
    }

    make('div', 'ax-preview-code', el.preview).textContent = module.code || ('REC · ' + (module.no || ''));
    make('div', 'ax-preview-title', el.preview).textContent = module.label || module.id;

    if (module.desc) {
      make('div', 'ax-preview-desc', el.preview).textContent = module.desc;
    }

    var lines = typeof module.preview === 'function' ? module.preview() : null;
    if (lines && lines.length) {
      var box = make('div', 'ax-preview-rows', el.preview);
      lines.forEach(function (row) {
        var line = make('div', 'ax-status-row', box);
        make('span', '', line).textContent = row[0] + '  ';
        make('b', '', line).textContent = row[1];
      });
    }

    /* 动作瓦片和文件夹瓦片的提示语不一样 —— "进入"和"执行"是两件事，
       写错了玩家会以为按下去会开一个新界面。 */
    var isAction = typeof module.run === 'function';
    var hint = make('div', 'ax-preview-enter' + (isAction ? ' action' : ''), el.preview);
    hint.textContent = isAction ? '回车 / 点击 执行' : '回车 / 点击 进入';
  }

  /* ============================================================
     动效
     ============================================================ */

  /** 扫描线 + 撕裂条。进入文件夹、返回、换光标都走这一条。 */
  function desync() {
    el.root.classList.remove('scan');
    void el.root.offsetWidth;
    el.root.classList.add('scan');

    window.clearTimeout(el.scanTimer);
    el.scanTimer = window.setTimeout(function () {
      el.root.classList.remove('scan');
    }, 560);
  }

  /* ============================================================
     页面容器（AC 三列里的中 + 右）
     ============================================================ */

  /**
   * 建一个页面。返回 { root, list, detail }：
   *   root   整页（含页首的 REC 记录条）
   *   list   条目列表容器
   *   detail 详情面板容器 —— 用 Animus.setDetail 往里写
   *
   * 页首那条"档案记录"由**外壳**统一插，不由模块各插一遍 ——
   * 两个模块各写一次必然会有一边忘了，界面上就是"这一页看着没做完"。
   */
  function createPage(module, host) {
    var root = document.createElement('section');
    root.className = 'ax-page';
    root.setAttribute('data-module', module.id);
    host.appendChild(root);

    /* 页首那条"档案记录"里的**记录号不在这里重复**。
       顶栏（renderHead）已经在显示 module.code 了，正文里再写一遍
       就是同一个字符串在同一屏出现两次 —— "REC · 05 / OUTPUT"
       上下各一条，实测看着像排版出错。
       所以这一块现在只放**描述**，模块没写 desc 就整块不建。 */
    if (module.desc) {
      var head = document.createElement('div');
      head.className = 'ax-page-head';

      var desc = document.createElement('div');
      desc.className = 'ax-page-desc';
      desc.textContent = module.desc;

      head.appendChild(desc);
      root.appendChild(head);
    }

    var cols = document.createElement('div');
    cols.className = 'ax-page-cols';
    root.appendChild(cols);

    var list = document.createElement('div');
    list.className = 'ax-list';
    cols.appendChild(list);

    var detail = document.createElement('aside');
    detail.className = 'ax-detail';
    cols.appendChild(detail);

    return { root: root, list: list, detail: detail };
  }

  /**
   * 往详情面板里写一条。
   *
   * AC2 子页的布局里，详情是"选中条目的说明"。有了它，只有一两行的子页
   * 才不像"没做完"，中文说明也不用挤在标签列里换三行。
   *
   * 结构固定是**两栏**：左边标题 + 大字读数，右边说明 + 编号。
   * 分成两个 wrapper 而不是把四个 div 直接丢进 grid ——
   * 直接丢的话它们会被 grid 自动排成 2x2（标题|读数 / 说明|编号），
   * 每一条都跑错格子。这个坑当场踩过一次。
   */
  function setDetail(detail, info) {
    if (!detail) {
      return;
    }

    detail.innerHTML = '';

    if (!info) {
      var nada = document.createElement('div');
      nada.className = 'ax-detail-note';
      nada.textContent = '把光标移到左边任意一条上。';
      detail.appendChild(nada);
      return;
    }

    var main = make('div', 'ax-detail-main', detail);
    var body = make('div', 'ax-detail-body', detail);

    if (info.title) {
      make('div', 'ax-detail-title', main).textContent = info.title;
    }

    if (info.value) {
      make('div', 'ax-detail-value', main).textContent = info.value;
    }

    if (info.note) {
      make('div', 'ax-detail-note', body).textContent = info.note;
    }

    if (info.id) {
      make('div', 'ax-detail-id', body).textContent = info.id;
    }
  }

  /* ============================================================
     开场 / 收场
     ============================================================ */

  function open(options) {
    build();

    var next = options || {};

    // 主题变了要重新读（见 readTheme 的注释）
    readTheme();

    /* **先把"现在在第几层"重置掉，再渲染。**
       level / stack 会被 renderFooter()（以及它读的 backLabel()）读到 ——
       放在渲染之后重置的话，open() 的第二次调用会按上一次留下的栈画出底栏，
       （多出一个不该有的「返回」，界面上就是闪一下）。
       open() 确实会被调用不止一次：主菜单 → 进游戏 → 按 Esc 掀开暂停菜单。 */
    var wasOnPage = level === 1;
    level = 0;
    stack.length = 0;
    path = [BREADCRUMB_ROOT];
    el.root.classList.remove('level-1');

    /* 刚才还停在某一页上，现在被直接掀回桌面了 —— 也要把"子页结束了"发出去。
       和 close() 里那一条同理：**进出成对**，否则调用方会以为还留在那一页
       （主菜单页的立绘姿态就是这么用的）。
       现在的调用路径都走不到这儿（进子页之后要先返回才能再 open），
       但这条比"以后有人从这里 open 一次"便宜。 */
    if (wasOnPage) {
      notifyPage(null);
    }

    frame.kicker = next.kicker || frame.kicker;
    frame.title = next.title || frame.title;
    frame.modules = next.modules || null;
    frame.actions = next.actions || [];
    frame.hint = next.hint || '';
    frame.escLabel = next.escLabel || frame.escLabel;

    el.kicker.textContent = frame.kicker;
    el.title.textContent = frame.title;

    renderRows(next.rows || []);

    /* 同步率：开场从 0 数上去。这一段"同步中"是 Animus 最有辨识度的几秒。 */
    syncTarget = (typeof next.sync === 'number' && isFinite(next.sync))
      ? clampNumber(next.sync, 0, 1)
      : null;
    syncShown = 0;
    syncCountFrom = 0;
    syncCountAt = performance.now();
    lastTip = -1;

    el.actions.innerHTML = '';
    el.foot.classList.toggle('no-actions', !frame.actions.length);
    renderFooter(null);

    resolveShown();
    buildRail();

    /* 刚打开：悬停去重的状态归零（**不发**，只是别让上一次会话的"指着哪一格"
       把开界面之后的第一次悬停吃掉）。 */
    hoveredId = null;

    isOpen = true;
    startedAt = performance.now();
    activeIndex = -1;
    travel = null;
    /* level / stack / path / level-1 已经在上面重置过了（必须在渲染之前）。 */
    renderHead(null);
    renderBreadcrumb();
    el.root.classList.add('open');

    /* 尺寸要等一帧才准：刚加上 .open 时 visibility 才从 hidden 变过来，
       这一帧里 clientHeight 可能还是 0。 */
    window.requestAnimationFrame(function () {
      resizeRailCanvas();
      resizeSpaceCanvas();
      layoutNodes();

      /* 开场落在调用方指定的文件夹上（默认第一个）。
         animate=false：首帧直接就位，不放滑动。 */
      var wanted = next.page ? shown.findIndex(function (m) { return m.id === next.page; }) : 0;
      highlight(wanted >= 0 ? wanted : 0, false, true);
    });

    if (!rafId) {
      rafId = window.requestAnimationFrame(railLoop);
    }

    desync();
  }

  function close() {
    if (!el.root || !isOpen) {
      return;
    }

    isOpen = false;
    el.root.classList.remove('open');

    /* 界面收起来了，光标也就不指着任何一格了 —— 立绘回默认表情。
       不发的话：暂停菜单关掉之后她还挂在那格的表情上，
       而这时候画面已经回到剧情，看起来像"表情卡住了"。 */
    pushHover(null);

    /* 万一是在第 1 层被关掉的（现在的调用方都不会这么做：Esc 在子页里
       只退一层，不关界面），也要把"子页结束了"发出去 ——
       否则她会停在那一页的姿态上。留着这条是因为它一旦漏了，
       表现是"立绘位置不对"，而原因在几百行之外。
       level / 'level-1' 不用在这里收拾：open() 每次都会重置。 */
    if (level === 1) {
      notifyPage(null);
    }

    if (typeof handlers.closed === 'function') {
      handlers.closed();
    }
  }

  function toggle(options) {
    if (isOpen) { close(); } else { open(options); }
  }

  /* ============================================================
     键盘
     ------------------------------------------------------------
     调用方的 keydown 是在本文件**之前**注册的，所以同一个 Esc 会先进
     调用方、后进这里。调用方在处理"Esc 打开暂停菜单"时会中途把 isOpen
     变成 true，等轮到本监听时它看到的是一个"开着"的界面，于是又关掉 ——
     现象是"第一次 Esc 能开，之后每次开了又立刻关"。
     所以调用方处理完必须 preventDefault，这里靠 defaultPrevented 认出来。
     ============================================================ */
  function bindKeys() {
    document.addEventListener('keydown', function (event) {
      if (!isOpen || event.defaultPrevented) {
        return;
      }

      /* ---- Esc：第 1 层返回桌面，第 0 层才真的关掉 ----
         这是两级结构最要紧的一条：Esc 在子页里**不是退出**，
         是退回文件夹选择。玩家会按很多次 Esc。 */
      if (event.key === 'Escape') {
        if (level === 1) {
          leaveFolder();
          event.preventDefault();
          return;
        }

        /* **子桌面里 Esc 也是"退一层"，不是"关掉"。**
           少了这一条，点进「设置」这种文件夹之后就是死路：底栏没返回
           （见 renderFooter 那段注释），Esc 又落到 handlers.esc 上被调用方
           吃掉（主菜单返回 true = 什么都不做）。玩家按 Esc 的期望永远是
           "退一层"，这一层得先由外壳满足，再谈调用方要不要关掉整个界面。 */
        if (stack.length) {
          leaveFolder();
          event.preventDefault();
          return;
        }

        if (typeof handlers.esc === 'function' && handlers.esc() === true) {
          event.preventDefault();
          return;
        }

        close();
        event.preventDefault();
        return;
      }

      /* ---- 回车/空格：在第 0 层是"进入" ---- */
      if ((event.key === 'Enter' || event.key === ' ') && level === 0) {
        if (activeId) {
          event.preventDefault();
          enterFolder(activeId);
        }
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      /* ↑↓ 只在第 0 层管用。第 1 层交给各模块自己（它们可能有自己的
         列表焦点），外壳不抢。 */
      if (level !== 0 || !el.nodes || !el.nodes.length) {
        return;
      }

      event.preventDefault();
      highlight(highlightIndex + (event.key === 'ArrowDown' ? 1 : -1), true);

      /* 键盘也走同一条换表情的路（和鼠标划过等价）。
         不做这一步的话，"用 ↑↓ 选到某一格"时立绘不会跟着变 ——
         而玩家看到的明明是同一件事："我现在指着这一格"。 */
      pushHover(activeId);

      // 焦点跟着光标走，键盘和鼠标共用同一条视觉路径
      el.nodes[highlightIndex].focus();
    });
  }

  /* ============================================================
     对外
     ============================================================ */
  return {
    handlers: handlers,
    register: register,
    open: open,
    close: close,
    toggle: toggle,
    createPage: createPage,
    setDetail: setDetail,
    setSync: setSync,
    /** 只换顶栏那几行读数，不动同步率。调用方在数据晚到时用它补一次。 */
    setStatus: renderRows,
    /** 第 0 层：把光标移到第 index 个文件夹（不进入）。 */
    highlight: highlight,
    /** 第 0 → 1 层：进入某个文件夹。 */
    enterFolder: enterFolder,
    /** 第 1 → 0 层：返回桌面。 */
    leaveFolder: leaveFolder,
    /** 当前在第几层（0 = 桌面，1 = 子页）。 */
    level: function () { return level; },
    isOpen: function () { return isOpen; },
    currentPage: function () { return activeId; },

    /** 重新问一遍 available() 并重画导航。存档状态变了之后调。 */
    refreshNav: function () {
      if (!isOpen) {
        return;
      }
      resolveShown();
      buildRail();
      layoutNodes();
      highlight(Math.min(highlightIndex, shown.length - 1), false, true);
    },

    /**
     * 放一下"故障"（扫描线 + 撕裂条，560ms）。就是外壳自己换层时用的那一下。
     *
     * 调用方目前只有一个：主菜单进游戏前的退场（`boot.js` 的 `leaveToGame`）——
     * 那一下的叙事是"归档软件被真人撞开"，所以这层界面得先坏一下。
     * 与其在调用方把 `.scan` 那三行抄一遍，不如从这儿开一个口子。
     */
    glitch: desync,

    /** 主题变了之后重读 canvas 用的通道三元组。
        改 data-theme 的人必须调它 —— 不调的话画布会留在上一套配色里。 */
    refreshTheme: readTheme,

    /** 当前主题的三个通道三元组（canvas 用）。模块画自己的东西时也要走它。 */
    theme: function () { return { ink: INK, mark: MARK, cyan: CYAN }; },

    config: CFG,
    _el: el
  };
})();
