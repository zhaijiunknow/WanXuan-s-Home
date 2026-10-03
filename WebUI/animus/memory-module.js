/* ============================================================
   memory-module.js —— 记忆序列（animus/memory-module.js）
   ------------------------------------------------------------
   暂停菜单的主视图：整条剧情按"幕"列出来，已经读过的、正在读的、
   还没解锁的各有各的状态。

   隐喻是**归档**，不是基因 —— 剧本 4-1 里皖萱给自己拍下来的甜点照片
   "做归档"，所以这一页是一条索引绳，样本卡挂在上面。
   没有血缘 / 遗传/ 族谱这条线，别往那个方向画。

   ## 数据从哪来

    一条主路 + 一条辅助路，**两条都要走**（见 ensureData）：

     ① 页面自己的剧本 —— story.js 就在这一页手上（主菜单页也引了它）。
        先拿它画一版，页面不会空着。

     ② C# 的 story.progress —— 发 story.progress.request 问它。
        回答有两种形状：
          · 整张表（chapters 非空）—— 游戏场景里正在播剧本，C# 权威
          · 空表 + savedStepId  —— 主菜单场景没有 StoryManager，
            C# 算不出表，但它读得到存档停在哪一步。网页拿这个锚点
            在本地剧本里一查，就知道哪几章读过了。

    **为什么不自己维护「读到哪了」**：进度的权威在 C#（存档也在它那儿）。
    网页只显示、不记账 —— 唯一的例外是主菜单那条锚点路径，
    那也只是把 C# 给的一个 id 翻译成一张表，不是自己发明进度。

    ## 名字什么时候可以露

    只有 done / current 这两态写得出口名字，其余一律「???」。
    **能不能点进去（open）和说不说名字（isRead）是两件独立的事** ——
    混在一起的后果就是主菜单把所有章名念了一遍，那是剧透。

   ============================================================ */

window.AnimusMemory = (function () {
  'use strict';

  /** [{ id, title, state }]，state ∈ done | current | locked */
  var chapters = [];
  var progress = 0;
  var source = '（还没拿到数据）';

  var pageEl = null;
  var contentEl = null;
  var detailEl = null;
  var requestedAt = 0;

  /** C# 回过一张**空表**（那个场景里没有正在播的剧本）。
      和"发了请求没人回"是两回事，显示的话术和能给的建议都不一样。 */
  var hostRepliedEmpty = false;

  /* ============================================================
     C# 给的**存档锚点**：存档停在哪一个 stepId 上。
     ------------------------------------------------------------
     主菜单场景里没有 StoryManager（剧本在游戏场景里），C# 算不出整张表 ——
     但它读得到 PlayerPrefs 里的存档步 id。有了这个 id，
     "哪几章读过了"就是一次纯查找，网页自己就能算（剧本它本来就有）。

     分工没变：**C# 仍然是权威 —— 权威的是"读到哪了"这个事实**，
     变的只是"这张表由谁画"。原来没有锚点时，主菜单只能把所有章
     标成"可跳转"，于是整页章名全念了出来（章节页正好就在主菜单里，
     等于开局就剧透）。 */
  var hostAnchorId = '';

  /* 请求发出去之后等多久才认定"拿不到"。太短会在慢机器上误报，
     太长玩家会盯着一片空白。1.2 秒两头都还算舒服。 */
  var REQUEST_TIMEOUT = 1200;

  /* ============================================================
     本地推算（浏览器预览 / standalone）
     ------------------------------------------------------------
     和 C# 那边算的是同一个东西，但这里是"看得见的近似"：
     选项分支走向不同的结局时，本地只知道当前走到哪一步，
     不知道"哪几幕这一周目已经走过了"。
     ============================================================ */
  function fromLocalStory() {
    var vn = window.VN;

    /* 两条来源：
         · window.VN.state.story —— 游戏页 app.js 载入的（standalone 模式）
         · window.VN_STORY       —— story.js 本体。**主菜单页也要用它**：
           那一页没有 app.js，可是「章节选择」整页就靠这份数据。 */
    var story = (vn && vn.state && vn.state.story) || window.VN_STORY;

    if (!story || !story.steps || !story.steps.length) {
      return false;
    }

    var steps = story.steps;
    /* 读到哪了，两条来源：
         · 游戏页 app.js 自己的 state.currentId（它每一步都在推）
         · C# 给的存档锚点（主菜单页 —— 那里没有 app.js）
       前者更"实时"，所以排在前面。 */
    var currentId = (vn && vn.state ? vn.state.currentId : null) || hostAnchorId;
    var found = [];
    var act = '';            // 当前落在哪一幕里
    var currentIndex = -1;   // -1 = 不知道读到哪了（没有存档、也没人回话）
    var i;

    /* **幕标题本身也是一条 marker**，但它不是"一章"，是后面那几章的组名。
       这一点必须分开，否则 31 条 marker 会变成 31 章、12 个组，
       而且组名会拼成「第 第一幕-降临——… 章第一幕：降临——…」那种鬼东西
       （这个 bug 真出现过）。

       判据来自数据本身，不靠猜：**章标记的 id 一定以数字开头**
       （1-1 / 3-6 / 5A-2），幕标题是「第一幕-…」「结局分支-A-…」。 */
    for (i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (!step) { continue; }

      if (step.type === 'marker') {
        var id = step.id || '';
        var title = step.markerTitle || id;

        if (/^[0-9]/.test(id)) {
          found.push({ id: id, title: title, act: act, at: i });
        } else {
          act = title;
        }
      }

      if (currentId && step.id === currentId) {
        currentIndex = i;
      }
    }

    if (!found.length) {
      return false;
    }

    /* 当前所在的那一章 = 最后一个"开始位置不晚于当前步"的章标记 */
    var activeMarker = 0;
    for (i = 0; i < found.length; i++) {
      if (found[i].at <= currentIndex) {
        activeMarker = i;
      }
    }

    /* ============================================================
       "进度未知" 只影响**能不能点**，不影响**说不说名字**。

       原来这里写的是"未知时全是可跳转"，然后 showLabel 把
       `open` 当成"已解锁"，于是主菜单页把所有章名都念了出来。
       可主菜单**正是章节页所在的地方** —— 一开局就把 5 章标题
       摆给没读过的人看，这是剧透，不是信息。

       现在把两件事拆开：
         · 能不能进 —— open / done / current 能进，locked 不能（没读到的分支）
         · 说不说名字 —— 只有 done / current 说得出口，其余一律「???」
       ============================================================ */
    var known = currentIndex >= 0;

    chapters = found.map(function (marker, index) {
      var state = 'open';

      if (known) {
        state = index < activeMarker ? 'done' : (index === activeMarker ? 'current' : 'locked');
      }

      return { id: marker.id, title: marker.title, act: marker.act, state: state };
    });

    progress = known && steps.length ? currentIndex / steps.length : null;
    source = '本地剧本 · ' + chapters.length + ' 章 / ' + steps.length + ' 步';
    return true;
  }

  function requestFromHost() {
    if (typeof VNBridge === 'undefined' || !VNBridge.hasHost()) {
      return false;
    }

    requestedAt = Date.now();
    VNBridge.send('story.progress.request', {});
    return true;
  }

  /* ============================================================
     渲染
     ============================================================ */

  var STATE_TEXT = {
    done: '已归档',
    current: '读取中',
    locked: '未解锁',
    open: '未读'
  };

  /** 这一章**读过了没有** —— 决定名字能不能说出口。
      注意它和"能不能点进去"是两件独立的事：
      open（进度未知，主菜单）能点进去，但名字一样不给看。 */
  function isRead(state) {
    return state === 'done' || state === 'current';
  }

  /**
   * 去掉标题开头的编号。
   *
   * 剧本里的 markerTitle 常常自带编号（"1-1　寂静的独居生活"），而编号已经
   * 单独占左边一列了 —— 不去掉就是同一句话说两遍，看着像排版出错。
   * 用全角空格 (\u3000) 也要一起吃掉，那是中文排版里惯用的那个。
   */
  function stripIdPrefix(title, id) {
    if (!title) {
      return id || '';
    }

    if (id && title.indexOf(id) === 0) {
      return title.slice(id.length).replace(/^[\s\u3000]+/, '');
    }

    return title;
  }

  /* ============================================================
     右上角那块读数（大数字 + 下面两行）
     ------------------------------------------------------------
     **由本模块负责**，因为它是唯一知道"读到哪一章了"的地方。

     原来那块在主菜单上是**装饰**：大数字是 tickSync 的环境漂移
     （每次进都不一样，48.0 / 48.3 / 53.6…），下面两行是写死的
     「系统 就绪 / 序列 未载入」。游戏页好一些（app.js 会喂），
     但菜单页从来没接过真数据 —— 而菜单页正是玩家第一眼看到它的地方。

     现在三样都是真的（抬头是「归档」，壳子持有那行字）：
       大字   读过的步数 / 总步数（progress，C# 或本地算出来的）
       第一行 章节   = 现在读到哪一章（还没开始就写「未开始」）
       第二行 已读   = 已经读过的章数 / 总章数
     ============================================================ */

  /** 顶栏该显示哪一章：优先"正在读"的那一章，其次最后读过的一章。 */
  function topChapter() {
    /* 用**分组后**的 5 章，不是 25 个幕标记 —— 顶栏要和章节页上
       那张卡片说的是同一章，不然玩家会对不上号。
       （groupChapters 是纯函数，每次算一遍很便宜。） */
    var groups = groupChapters();
    var i;

    for (i = 0; i < groups.length; i++) {
      if (groups[i].state === 'current') { return groups[i]; }
    }

    for (i = groups.length - 1; i >= 0; i--) {
      if (groups[i].state === 'done') { return groups[i]; }
    }

    return null;
  }

  function pushReadout() {
    if (!window.Animus || typeof Animus.setSync !== 'function') {
      return;
    }

    var groups = groupChapters();
    var total = groups.length;
    var read = 0;
    var i;

    for (i = 0; i < total; i++) {
      if (isRead(groups[i].state)) { read++; }
    }

    var chapter = topChapter();

    /* **进度未知时给 0，不给 null。** 给 null 的话外壳会退回一条
       随机漂移的假数字（那是它原来的兜底），而我们要的是真数据 ——
       一局都没开始时"归档 0.0%"就是实话。 */
    var ratio = (typeof progress === 'number' && isFinite(progress)) ? progress : 0;

    Animus.setSync(ratio, [
      ['章节', chapter ? chapter.title : (total ? '未开始' : '—')],
      /* 抬头用「已读」：大读数那边（归档）是含蓄的，**这两行负责把话说清楚**，
         所以用最没有歧义的词 —— "读过的章数 / 总章数"。 */
      ['已读', total ? (read + ' / ' + total + ' 章') : '—']
    ]);
  }

  function render() {
    /* 顶栏读数**先推**，而且要在 contentEl 那个守卫之前 ——
       数据到手时页面可能还没建过（主菜单就是这样：玩家一进来
       就该看到真进度，而不是点进章节页之后才有）。 */
    pushReadout();

    if (!contentEl) {
      return;
    }

    /* 只清内容区，**不清整页**。清整页会把 Animus.createPage 插进来的
       页首"档案记录"条一起抹掉 —— 这个坑当场踩过一次：记忆序列那一页
       的 REC 条就是这么没的。 */
    contentEl.innerHTML = '';

    if (!chapters.length) {
      var empty = document.createElement('div');
      empty.className = 'ax-empty';

      /* ---- 说清楚"为什么没有" ----
         原来这里只有一句"拿不到记忆序列"，把三种完全不同的原因
         （文件没导出 / 剧本里没有幕标记 / 正在等 C# 回话）混成了一句 ——
         看到它的人无从下手。现在分开，而且**每条都给出下一步做什么**。 */
      empty.textContent = missingReason();

      contentEl.appendChild(empty);
      return;
    }

    buildWing();
  }

  /**
   * 拿不到章节时显示什么。
   *
   * 几条路的判据不同，**能做的事也不同** —— 所以必须分开写。
   * 原来只有一句"拿不到记忆序列"，看到的人无从下手。
   *
   * 顺序有讲究：先看"是不是有人明确回过话"，再看"是不是文件不在"。
   * 反过来的话，Unity 里明明回了空表却会说成"请求没回音"，把人带偏。
   */
  function missingReason() {
    var hasStory = !!(window.VN_STORY && window.VN_STORY.steps && window.VN_STORY.steps.length);

    /* ① Unity 明确回了一张**空表**。
          主菜单场景没有 StoryManager（剧本在游戏场景里），所以它算不出章节。
          这一条在 Unity 里跑主菜单时一定会遇到 —— 而且它有个能动手的解法。 */
    if (hostRepliedEmpty) {
      return 'Unity 侧回了一张空表：那个场景里没有正在播的剧本，算不出章节。\n' +
        '这一页的章节来自　WebUI/story.js　—— 在 Unity 里执行菜单\n' +
        'WanXuan > 导出 Web 剧本（story.js）　生成它就好了。';
    }

    /* ② 剧本在，但没有幕标记 —— 那是剧本数据的问题，不是这一页的事 */
    if (hasStory) {
      return '剧本载入了 ' + window.VN_STORY.steps.length + ' 步，但里面一条幕标记都没有，所以铺不出时间线。\n' +
        '（幕标记 = 剧本里「1-1 寂静的独居生活」这种行，解析器把它们标成 type: "marker"。）';
    }

    /* ③ 已经向 C# 发了请求，还在等 */
    if (requestedAt && Date.now() - requestedAt < REQUEST_TIMEOUT) {
      return '正在向 Unity 侧请求章节…';
    }

    /* ④ 发了请求但没人回 */
    if (requestedAt) {
      return '向 Unity 侧请求了章节，但没有回音。';
    }

    /* ⑤ 最常见的一种：story.js 根本不在，而且也没有 host 可以问 */
    return '找不到剧本数据 —— WebUI/story.js 不在。\n' +
      '在 Unity 里执行菜单　WanXuan > 导出 Web 剧本（story.js）　就会有这个文件，\n' +
      '它是主菜单页拿到「有哪几章」的唯一来源（这一页没有 app.js）。';
  }

  /* ============================================================
     章节选择：**一条有纵深的卡片环**
     ------------------------------------------------------------
     这一页换过十几版形状，全部作废，列在这里只为别再走回去：

       索引绳（canvas，会荡）→ 天使半身 + 一只大翅膀（线稿 + mask）
       → 草 / 栅栏 / 须刷 / 散叶 / 排线（六种翅膀几何）
       → 光环圆环 → 25 张散落的卡片

     **为什么翅膀全军覆没，得记下来。** 不是画得不够好，是几何上做不到：
     25 片各自像真羽毛的片子（比例约 5:1）铺在一只翅膀上，
     需要大约 1700 单位的翼展，而 viewBox 只有 580 高。
     每换一种排法都是在"把羽毛改细"和"让它们互相压住"之间来回撞。

     **为什么卡片能成。** 卡片就是矩形 —— 位置、旋转、压叠顺序
     全是几个数算出来的，没有"曲线画歪"这回事。

     最后落在参考图那一种上：**卡片钉在一个水平圆环上，有 z 轴纵深**。
     选中哪一张，整圈转到让那一张正对镜头。转动同时改三个量
     （缩放 / 横向压扁 / 明暗），合起来才读得出"这是一圈"，
     而不只是"一排卡片排在弧上"。具体公式见 CARDS 上面那段。

     ## 布局是**确定的**，不是随机的

     角度按序号均分，抖动从序号推出来（sin(i·3.7719)），不用 Math.random。
     随机会有两个后果：每次刷新这页都变样（玩家会以为界面坏了），
     而且"上次那张好看的"复现不出来。**要能复现才谈得上调。**

     ## 压叠顺序 = 纵深

     SVG 没有 z-index，只能靠改 DOM 顺序。按 cos θ 从小到大 appendChild：
     **远的先画、近的后画**。那就是这一页的 z 轴。

     ## 交互（点两次，不是一次）

       · 鼠标划过 —— 只高亮 + 浮出名字，**不转、不进**（那是"指到"，不是"选中"）
       · 点一张不在正面的卡 —— 整圈转到它正对镜头，到此为止
       · 点**已经正对镜头**的那一张 —— 才进去
       · locked（确定这一周目没读到的分支）永远进不去，但转得过来，看得见「???」

     卡片上默认只有编号，名字在转到正面之后才浮出来；
     **没读过的那几张，名字是「???」**（判据见 isRead）。
     ============================================================ */

  var CARDS = {
    view: { w: 1000, h: 580 },

    /* 卡片尺寸。**25 张的时候是 158×106，现在只有 5 张，可以大一圈。**
       卡少了就该把卡做大 —— 否则周围空一大片，看着像没排满。 */
    cardW: 232,
    cardH: 158,

    /* ============================================================
       这是一条**有纵深的圆环**，不是摊开的网格。

       25 张卡均匀钉在一个水平圆环上（i 张 = 第 i 个角度），
       选中哪一张，**整圈就转到让那一张正对镜头**（θ = 0）。
       然后按透视投影算每张卡的位置和大小：

         θ   = 该卡的角度 − 选中那张的角度     （0 = 正对镜头，π = 最远）
         c   = cos θ                            （1 = 最近，−1 = 最远）
         depth = (1 − c) / 2                    （0 = 最近，1 = 最远）

         横向   x = cx + rx · sin θ
         纵向   y = cy + ry · c / 2 − 30 · (1 − depth)   ← 远的往上飘一点
         缩放   scale  = lerp(heroScale, backScale, depth)
         侧对   squash = lerp(1, minSquash, depth)        ← **这一条是关键**
         明暗   opacity = lerp(frontAlpha, backAlpha, depth)

       三个量合起来才像"有纵深"：
         · **scale**   —— 近大远小
         · **squash**  —— 卡片转到侧面时会"变窄"（scaleX），
                          转到 ±90° 附近最窄，那是它侧对着你。
                          少了这一条，整圈看起来只是一个扁椭圆，
                          卡片还是正着的 —— 那就没有 3D 感，只有"排在弧上"。
         · **opacity** —— 远的暗下去，把纵深再推一层

       画叠顺序按 c 从小到大：**远的先画、近的后画**。
       SVG 没有 z-index，只能靠 DOM 顺序 —— 这就是"z 轴"。
       ============================================================ */
    /* 环的两个半径。**ry 不能小** —— 这是"看得见纵深"的物理来源：
       远的那半圈要真的高上去，不然整圈读成"一排卡片"而不是"一圈"。
       168 → 300 之后后面那几张才明显抬起来。

       rx 300 → 330：卡变大之后 300 有点挤，左右两张会蹭到中间那张。
       注意 ry **不能跟着一起加** —— 详情条的位置是
       `h/2 + ry*0.5 + 卡高/2 + labelGap` 算出来的（见 placeRing 末尾），
       ry 一加它就被推出 SVG 下边界，直接看不见了。 */
    rx: 330,
    ry: 252,
    lift: 0,
    /* 远的那几张**纵向也压扁**一点：它们在环的后半圈，
       是从下往上看过去的，本来就该扁。只做横向压缩的话
       它们看起来还是"正对着你、只是变瘦了"。 */
    backSquashY: 0.68,
    heroScale: 1.34,     /* 正对镜头那张的缩放（卡本身就大了，缩放收一点） */
    /* ============================================================
       后面那两张必须**还看得清**。

       原来是 backScale 0.5 / minSquash 0.28，两个一乘再乘上
       SVG 的 0.669 缩放，最后那两张只有 **38 px 宽** ——
       在 1920 的画面上就是两个小点，章号和名字全糊了。
       截图量出来的实际宽度：38 / 132 / 209 px（远/中/近）。

       现在 0.76 × 0.70，同样三个位置是 **92 / 158 / 209 px**：
       远近层次还在（0.60 / 1.02 / 1.34），但后排也读得出来。
       用户要的是"5 章全摆在面前，没解锁的显示 ???" ——
       后排糊成点就等于没摆出来。
       ============================================================ */
    backScale: 0.76,     /* 最远那张的缩放 */
    minSquash: 0.70,     /* 完全侧对时横向压到多少 */
    frontAlpha: 1,
    backAlpha: 0.50,

    /* 卡片自转：近的正着、远的歪着。参考图里就是前面那张正、后面的歪。 */
    rotMax: 9,

    /* ---- 转圈的时长 ----
       原来放在 CSS 里（transition），但那条路根本不生效（见 placeRing 那段）。
       现在由 spinToIndex 自己算，而且**按转动距离给**：
       转过 0° 用 spinMinMs，转过 180° 用 spinMaxMs，中间线性。
       两个都给得长，是因为一圈卡片本来就是"一次转盘"。

       660/1750 是"能看清它怎么转"的时长；用户看过之后要快一点点 ——
       现在 **520/1400**（约快 20%）。再快就会变成"跳"而不是"转"：
       那正是当初 CSS 过渡取消掉之后踩过的坑。 */
    spinMinMs: 520,
    spinMaxMs: 1400,

    markSize: 17,
    /* 名字（幕名 + 章节名）离正面那张卡的下缘多远。
       30 的时候幕名那一行的**基线只比卡片底边低 8 个单位** ——
       中文字是从基线往上长的，于是字压在卡片的描边上，
       看着像"名字画进卡里了"。44 把它推到卡外，又不至于顶出画布下沿
       （整体只剩 58 个单位的余量，再往下加会被 SVG 裁掉）。 */
    labelGap: 44,

    /* 卡里那块"照片"占卡片高度的比例。
       **这个参数被我漏过一次**（重写 CARDS 时没带上它）：它变成 undefined 之后
       `(h - 18) * undefined` = NaN，于是 <rect height> 和 <line y1/y2> 全成了
       "NaN" —— 浏览器不报错、页面也不崩，只是那一块**静默地不画**。
       Unity 那边是在 CEF 的 console 里才看到这三条 Error 的。
       教训：往这种"一个大对象 + 到处点属性"的结构里加东西，
       删/改的时候要拿 `CARDS.` 反过来 grep 一遍。 */
    shotRatio: 0.62
  };

  /* ============================================================
     生成与渲染
     ============================================================ */

  var wingEl = null;
  /* 卡片那一层。placeRing 靠**改 DOM 顺序**做 z 轴（SVG 没有 z-index），
     所以必须把它存下来。 */
  var layerEl = null;
  /* **两张状态分开存，这是这一版的关键。**
       front —— 转到正对镜头的那一张。**只在点击时改**。
       hover —— 鼠标划过的那一张。只影响高亮和标签，**不转圈**。
     混成一个的话，鼠标一划过整圈就跟着转，鼠标在卡片之间扫一遍
     整个界面会自己转个不停 —— 那是"选中"，不是"指到"。 */
  var frontIndex = 0;
  var hoverIndex = -1;
  var labelEls = null;
  var feathers = [];

  function svgEl(name, cls) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    if (cls) { el.setAttribute('class', cls); }
    return el;
  }

  function fmt(n) { return Math.round(n * 10) / 10; }

  /**
   * 把细碎的章节标记**收成"章"**。
   *
   * 剧本里一条 marker 是一小节（1-1 / 1-2 / 5A-3 …），一共 25 条。
   * 但**环上不该有 25 张卡** —— 那既看不清，也不符合"章节跳跃"这件事：
   * 玩家想跳的是"第几章"，不是"第几章第几节"。
   *
   * 所以按 id 开头的数字收：1-1 到 1-4 都是第 1 章，5A-* 和 5B-* 都是第 5 章
   * （它们是同一个第五决策点的两个结局分支）。最后是 5 张卡。
   *
   * **状态取"最靠前"的那一个**：一章里只要有一节是 current，这一章就是
   * current；否则看有没有 done。这样"读到哪了"在章这一级上仍然准确。
   */
  function groupChapters() {
    var rank = { current: 3, done: 2, open: 1, locked: 0 };
    var out = [];
    var byKey = {};

    chapters.forEach(function (c) {
      var m = /^([0-9]+)/.exec(c.id || '');
      var key = m ? m[1] : (c.id || '?');
      var g = byKey[key];

      if (!g) {
        g = byKey[key] = {
          key: key,
          /* id 给标签/详情用（显示成 SEQ 1），jump 才是真正的跳转目标 */
          id: key,
          jump: c.id,
          act: '第 ' + key + ' 章',
          title: '',
          branches: [],
          state: 'locked'
        };
        out.push(g);
      }

      if (c.act && g.branches.indexOf(c.act) < 0) { g.branches.push(c.act); }
      if (rank[c.state] > rank[g.state]) { g.state = c.state; }
    });

    /* 名字：取第一段幕标题冒号后半段（"降临——名为…"）。
       一章跨了两个结局分支的话，名字只放第一个，分支数记在 branches 里，
       详情面板那边会说明。名字太长会顶出画布，所以也可能只放第一个。 */
    out.forEach(function (g) {
      var first = g.branches[0] || '';
      var colon = first.indexOf('\uFF1A');

      g.title = colon > 0 ? first.slice(colon + 1) : (first || ('第 ' + g.key + ' 章'));
    });

    return out;
  }

  /**
   * 每张卡在环上的角度。
   *
   * **只有角度，没有坐标** —— 坐标是"当前选中谁"才算得出来的
   * （见 placeRing）。这一点是这一版和前面所有版本最大的区别：
   * 位置不是固定的布局，是一个**由选中项决定的投影**。
   */
  function ringAngle(i, n) {
    return (i / n) * Math.PI * 2;
  }

  /**
   * 把整圈摆到位：让第 front 张正对镜头。
   *
   * 每次选中都整个重算一遍（25 张，开销可以忽略），
   * 但**元素的 transform 只改值、不重建** ——
   * 所以 CSS 的 transition 能把"整圈转过去"做成一次动画，
   * 而不是一瞬间跳过去。这是走 style.transform 而不是 transform 属性的原因。
   */
  /* ============================================================
     转圈是**自己动的**，不是 CSS 过渡动的
     ------------------------------------------------------------
     上一版用 `transition: transform` 做这件事，怎么加时长都觉得"太快" ——
     因为**过渡根本没跑起来**：

       placeRing 每一帧都要把 25 个 <g> 按纵深重新 appendChild（SVG 没有
       z-index，画叠顺序只能靠 DOM 顺序）。而**把一个已经在 DOM 里的节点
       再 append 一次 = 先摘下来再插回去**，浏览器把它当成新插入的元素，
       旧的 computed style 没了 —— 于是那次 transition 直接被取消，
       卡片**瞬间**跳到新位置。时长调到 3s 也一样瞬间到位。

     所以改成自己用 rAF 算：每帧把插值出来的角度喂给 layoutRing。
     反正每帧都要重写 transform，DOM 重排也就无所谓了。
     好处还有一个：**转多远都能控制时长**（见 spinToIndex）。
     ============================================================ */

  var ringNow = 0;          /* 当前（动画中的）正面角度 */
  var ringRaf = 0;

  function easeInOut(t) {
    /* 两头软：起步有加速、到位前慢慢收。和之前那条 CSS 曲线是同一个意思，
       只是现在写在自己手里，改一个数就行。 */
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function layoutRing(front) {
    if (!layerEl || !feathers.length) { return; }

    var n = feathers.length;
    var target = front;
    var order = [];
    var i;

    for (i = 0; i < n; i++) {
      var e = feathers[i];
      if (!e) { continue; }

      /* 夹角归一到 [-π, π]，这样"转到正对"永远走最近的那一边 */
      var d = e.angle - target;
      d = Math.atan2(Math.sin(d), Math.cos(d));

      var c = Math.cos(d);
      var s = Math.sin(d);
      var depth = (1 - c) / 2;

      var scale = CARDS.heroScale + (CARDS.backScale - CARDS.heroScale) * depth;
      var squash = 1 + (CARDS.minSquash - 1) * depth;
      var squashY = 1 + (CARDS.backSquashY - 1) * depth;
      var alpha = CARDS.frontAlpha + (CARDS.backAlpha - CARDS.frontAlpha) * depth;

      var x = CARDS.view.w / 2 + CARDS.rx * s;
      var y = CARDS.view.h / 2 + CARDS.ry * c * 0.5 - CARDS.lift * (1 - depth);

      /* 近的正着、远的歪着 */
      var rot = e.baseRot * depth;

      e.el.style.transform =
        'translate(' + fmt(x) + 'px,' + fmt(y) + 'px) ' +
        'rotate(' + fmt(rot) + 'deg) ' +
        'scale(' + fmt(scale * squash) + ',' + fmt(scale * squashY) + ')';
      e.el.style.opacity = alpha.toFixed(3);

      order.push({ el: e.el, c: c });
    }

    /* **远的先画、近的后画 —— 这就是 z 轴。**
       SVG 没有 z-index，DOM 顺序就是深度顺序。

       注意：这里每帧都 appendChild，而"再 append 一次"= 摘下来再插回去，
       **会掐掉这个元素身上正在跑的 CSS 过渡**。所以转圈不能靠 CSS 过渡，
       必须自己逐帧喂角度（见上面那段）。 */
    order.sort(function (p, q) { return p.c - q.c; });
    order.forEach(function (o) { layerEl.appendChild(o.el); });
  }

  /**
   * 转到第 index 张正对镜头。
   *
   * **时长按转动距离给。** 这是"像转盘"的关键：
   * 点隔壁那张只转一格，点对角线那张要绕半圈 —— 都给 1.5s 的话，
   * 前者慢得发慌、后者还是像被人推了一把。所以角速度大致恒定：
   *     时长 = 基准时长 × (转过的角度 / π)
   * 再夹一个上下限，免得"点自己"时长为 0、"绕半圈"慢到没耐心。
   */
  function spinToIndex(index) {
    var n = feathers.length;
    if (!n || index < 0 || index >= n) { return; }

    var to = ringAngle(index, n);

    /* 走最近的一边：把目标折到当前角度的 ±π 之内 */
    var delta = to - ringNow;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));

    var span = Math.abs(delta) / Math.PI;          /* 0 = 不用动，1 = 绕半圈 */
    var ms = CARDS.spinMinMs + (CARDS.spinMaxMs - CARDS.spinMinMs) * Math.min(1, span * 1.35);

    if (ringRaf) { window.cancelAnimationFrame(ringRaf); ringRaf = 0; }

    var from = ringNow;
    var at = performance.now();

    function tick(now) {
      var t = Math.min(1, (now - at) / ms);

      ringNow = from + delta * easeInOut(t);
      layoutRing(ringNow);

      if (t < 1) {
        ringRaf = window.requestAnimationFrame(tick);
      } else {
        ringRaf = 0;
        ringNow = from + delta;      /* 收在准确值上，别留浮点尾巴 */
        layoutRing(ringNow);
      }
    }

    ringRaf = window.requestAnimationFrame(tick);
  }

  function cardEl(tag, cls) {
    return svgEl(tag, cls);
  }

  function buildWing() {
    var svg = svgEl('svg', 'ax-wing ax-cards-svg');
    svg.setAttribute('viewBox', '0 0 ' + CARDS.view.w + ' ' + CARDS.view.h);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', '章节选择：一摞卡片，每张是一章');

    /* **环上是 5 张卡（一章一张），不是 25 张。** 见 groupChapters。 */
    var groups = groupChapters();
    var n = groups.length;

    /* 注意这里**不能**写 var feathers —— 那样会遮蔽模块级那个，
       focusChapter 就找不到这一张，标签永远空白（真踩过）。 */
    feathers = new Array(n);
    var layer = svgEl('g', 'ax-feathers');
    /* placeRing 要往这一层加元素（靠 DOM 顺序做 z 轴），所以存到模块级 */
    layerEl = layer;

    /* **用 forEach，不要 for + var。**
       这里原来是 `for (i…) { var chapter = chapters[i]; … addEventListener }`，
       而 `var` 是函数作用域的 —— 25 个监听器全都闭包到**最后一章**上，
       于是划过任何一张卡片，圆心/卡下写的都是最后一章的名字。
       这类 bug 的症状是"内容看着对、但永远是同一个"，极难从界面上看出来。 */
    groups.forEach(function (chapter, i) {
      /* `unread` = 这一章没读过（open / locked 都算）。
         **它只表示"进不去"，不表示"动不了"** —— 没读过的卡照样能转、
         能划过、能被键盘选到。CSS 和点击回调都挂在这一个类上，
         不然"哪些卡不给进"这件事要在好几处各写一遍。 */
      var read = isRead(chapter.state);
      var g = svgEl('g', 'ax-feather ' + chapter.state + (read ? '' : ' unread'));
      g.setAttribute('data-id', chapter.id);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-disabled', read ? 'false' : 'true');

      /* 卡里的元素全部**以卡片中心为原点**画（-w/2 ~ +w/2）。
         位置由 placeRing 通过这个 <g> 的 transform 一次性给出，
         里面的东西不用各自算一遍 —— 旋转、缩放、透视压缩全都跟着走。

         **transform 走 style，不走属性。** 属性那条路 CSS 过渡管不到，
         而"整圈转过去"必须是一次动画。 */
      var w = CARDS.cardW;
      var h = CARDS.cardH;

      var plate = cardEl('rect', 'ax-card-plate');
      plate.setAttribute('x', fmt(-w / 2));
      plate.setAttribute('y', fmt(-h / 2));
      plate.setAttribute('width', fmt(w));
      plate.setAttribute('height', fmt(h));
      g.appendChild(plate);

      /* 卡里那块"照片"：我们没有图，就用一块比底色亮一点的板子 +
         两道横线暗示它是张照片 / 一页档案。空着会像没做完。 */
      var shot = cardEl('rect', 'ax-card-shot');
      shot.setAttribute('x', fmt(-w / 2 + 9));
      shot.setAttribute('y', fmt(-h / 2 + 9));
      shot.setAttribute('width', fmt(w - 18));
      shot.setAttribute('height', fmt((h - 18) * CARDS.shotRatio));
      g.appendChild(shot);

      var shotLine = cardEl('line', 'ax-card-shotline');
      shotLine.setAttribute('x1', fmt(-w / 2 + 26));
      shotLine.setAttribute('y1', fmt(-h / 2 + 9 + (h - 18) * CARDS.shotRatio * 0.66));
      shotLine.setAttribute('x2', fmt(w / 2 - 26));
      shotLine.setAttribute('y2', fmt(-h / 2 + 9 + (h - 18) * CARDS.shotRatio * 0.66));
      g.appendChild(shotLine);

      /* 编号。**这是默认唯一显示的字** —— 名字要选中才给（见 label）。 */
      var no = cardEl('text', 'ax-card-no');
      no.setAttribute('x', fmt(-w / 2 + 12));
      no.setAttribute('y', fmt(h / 2 - 12));
      /* 卡上现在只有 1 个数字（章号），不是 "1-1" 那种小节号 ——
         所以让它占得大一点，一眼看得清是第几章。 */
      no.setAttribute('data-big', '1');
      no.textContent = chapter.key;
      g.appendChild(no);

      /* 选中那张的菱形记号。平时不显示，靠 .focused 那一条 CSS 放出来。 */
      var mark = cardEl('path', 'ax-card-mark');
      var ms = CARDS.markSize / 2;
      mark.setAttribute('d', 'M0,' + fmt(-ms) + ' L' + fmt(ms) + ',0 L0,' + fmt(ms) +
        ' L' + fmt(-ms) + ',0 Z');
      mark.setAttribute('transform',
        'translate(' + fmt(-w / 2) + ',' + fmt(-h / 2) + ')');
      g.appendChild(mark);

      /* 划过：只高亮 + 出名字，**不转圈** */
      g.addEventListener('mouseenter', function () { hoverCard(i); });
      g.addEventListener('focus', function () { hoverCard(i); });
      g.addEventListener('mouseleave', clearHover);
      g.addEventListener('blur', clearHover);

      /* 点击：**两步**。
         第一次点 → 只把这张转到正对镜头（它变成 front），不进去；
         再点同一张 → 才真的进去。
         一圈卡片挤在一起，一次点击就进太容易点错章节，
         而点错章节 = 跳到剧情中间，代价很大。

         **第二步只对读过的那几张放行。** 没读到的（open / locked）
         照样转得过来、看得见是第几章，但进不去 ——
         原来这里只拦 locked，`open`（主菜单、进度未知）是能一路点进去的，
         于是"未解锁的卡片点一下居然跳走了"。 */
      g.addEventListener('click', function (event) {
        event.stopPropagation();

        var alreadyFront = selectCard(i);
        if (!alreadyFront) { return; }        /* 第一步：只是转过来 */

        /* 第二步：它已经正对镜头了，这一下才是"进去" */
        if (!isRead(chapter.state)) { return; }

        jumpTo(chapter);
      });

      g.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      });

      layer.appendChild(g);

      feathers[i] = {
        chapter: chapter,
        el: g,
        index: i,
        /* 在环上的角度。位置是"由选中项算出来的"，这里只存角度。 */
        angle: ringAngle(i, n),
        /* 基准自转。近的正着、远的歪着 —— 由 placeRing 按纵深加权。 */
        baseRot: Math.sin(i * 3.7719) * CARDS.rotMax,
        /* 名字写在**正对镜头那张**的下缘。它固定在画面中下方，
           不跟着圈转 —— 所以标签的位置是常数，见 focusChapter。 */
        tip: {
          x: CARDS.view.w / 2,
          y: CARDS.view.h / 2 + CARDS.ry * 0.5 +
             (CARDS.cardH * CARDS.heroScale) / 2 + CARDS.labelGap
        }
      };
    });

    svg.appendChild(layer);
    wingEl = svg;

    /* ---- 名字：**只有一个**，选中谁挪到谁下面 ----
       25 个卡片各藏一个标签的话，24 个永远是空的，
       而且 25 份字号/对齐规则迟早有人改漏一份。 */
    var label = svgEl('g', 'ax-wing-label');
    var act = svgEl('text', 'ax-wing-label-act');
    var name = svgEl('text', 'ax-wing-label-name');
    act.setAttribute('text-anchor', 'middle');
    name.setAttribute('text-anchor', 'middle');
    label.appendChild(act);
    label.appendChild(name);
    svg.appendChild(label);

    labelEls = { group: label, act: act, name: name };

    contentEl.innerHTML = '';
    contentEl.appendChild(svg);

    /* 先算初始的 front：**正在读的那一章**（没有就第一章）。
       然后摆一整圈 —— 这一帧没有过渡，直接摆就行。

       循环变量用 q 不用 i：buildWing 原来那个 `var i` 在重写时被删掉了，
       再写 i 就是一个 ReferenceError —— 而它抛在这一步，
       placeRing 就永远不跑，表现是"进页面时 25 张卡全叠在原点"。 */
    /* 初始 front = **正在读的那一章**（把它的 state 找出来）。 */
    frontIndex = 0;

    for (var q = 0; q < n; q++) {
      if (groups[q].state === 'current') { frontIndex = q; break; }
      if (groups[q].state === 'done') { frontIndex = q; }
    }

    ringNow = ringAngle(frontIndex, n);
    layoutRing(ringNow);

    /* front 那张一进来就标成"选中"（加粗边 + 菱形），
       并且把它的名字和详情写出来。

       **没读过的那张也照样标 front** —— 它是"正面对着你的这一张"，
       这个事实和它能不能进无关。菱形（"再点一次就进去"的确认记号）
       由 CSS 在 .unread 上单独关掉，见 animus.css。 */
    var f0 = feathers[frontIndex];

    if (f0) {
      f0.el.classList.add('front');
      showLabel(f0.chapter);
      showDetail(f0.chapter);
    }
  }


  /* ============================================================
     "选中"和"指到"是两件事，界面上必须看得出来
     ------------------------------------------------------------
       hover（划过）  只是"指到"：细边 + 名字浮出来，**不转圈、不进去**
       front（选中）  **点一下**把它转到正对镜头，加粗边 + 那颗菱形；
                      再**点它一次**才真的进去

     两步是刻意的：一圈卡片挤在一起，一张点击就进的话
     太容易点错章节（而且点错就是跳到剧情中间，代价很大）。
     先转到面前、看清名字、确认，再进。

     **没读过的那几张不参与这套交互**：画面上是灰卡片，
     划过不高亮、点了不转、更进不去（见 selectCard）。
     理由很直接 —— 它们的名字是「???」，转到正面也读不出东西。
     ============================================================ */

  /** 划过某一张：只高亮 + 把名字写出来，**不转圈**。 */
  function hoverCard(index) {
    var e = feathers[index];
    if (!e) { return; }

    hoverIndex = index;
    markHover(e.el);
    showLabel(e.chapter);
  }

  /** 鼠标离开卡片：去掉划过的高亮，名字回到**选中那张**上。 */
  function clearHover() {
    hoverIndex = -1;

    feathers.forEach(function (e) {
      if (e) { e.el.classList.remove('focused'); }
    });

    var f = feathers[frontIndex];
    if (f) { showLabel(f.chapter); }
  }

  /**
   * 点某一张。
   *
   * **两步：**
   *   · 点不在正面的那张 → 只把整圈转过去（它变成 front），**不进去**
   *   · 点已经正对镜头的那张 → 这才进去
   *
   * 这样"转到面前"和"确认进入"是两个动作，和转盘一样。
   */
  function selectCard(index) {
    var e = feathers[index];
    if (!e) { return false; }

    /* **没读过的那几张也能转过来** —— 转和进是两件事。

       转过来是为了看清楚"这是第几章"（名字仍然是 ???）。
       拦在这里的话，一圈灰卡片就永远只能待在后面当装饰，
       连"一共有几章、现在是第几章"都读不出来。
       真正要拦的是**第二下（进去）**，那一步在点击回调里。 */
    var wasFront = index === frontIndex;

    frontIndex = index;
    spinToIndex(frontIndex);

    feathers.forEach(function (o) {
      if (o) { o.el.classList.toggle('front', o.el === e.el); }
    });

    showLabel(e.chapter);
    /* **详情面板也要跟着换。**
       原来这里只调了 showLabel —— 于是卡片转过来了，底下那一栏还停在
       上一次那一章（进页面时那张）："选了新的，说明是旧的"。
       locked 的藏名也一起由 showDetail 处理。 */
    showDetail(e.chapter);
    return wasFront;      /* true = 它本来就是正面的那张 → 调用方可以进去 */
  }

  function markHover(el) {
    feathers.forEach(function (e) {
      if (e) { e.el.classList.toggle('focused', e.el === el); }
    });
  }

  /** 写名字（幕名 + 章节名），并显示出来。位置固定在画面中下方。 */
  function showLabel(chapter) {
    if (!labelEls || !chapter) { return; }

    var hideName = !isRead(chapter.state);
    var f = feathers[frontIndex];
    var tip = f ? f.tip : { x: CARDS.view.w / 2, y: CARDS.view.h / 2 };

    labelEls.act.textContent = actHeadOf(chapter) || '';
    /* 没读到的：**名字是三个问号**。
       一个「?」容易被当成"这里有点东西但没显示好"，
       三个一眼就是"还没到，不告诉你"。
       判据是"读没读过"，不是"能不能进" —— open（主菜单、进度未知）
       一样藏，因为主菜单正是章节页所在的地方，藏不住就等于开局剧透。 */
    labelEls.name.textContent = hideName
      ? '???'
      : stripIdPrefix(chapter.title, chapter.id);

    /* **锚点要夹进画布。** 名字最长的那几章会顶出去。 */
    var lx = Math.max(130, Math.min(CARDS.view.w / 2 + 0, CARDS.view.w - 130));

    labelEls.act.setAttribute('x', fmt(lx));
    labelEls.name.setAttribute('x', fmt(lx));
    labelEls.act.setAttribute('y', fmt(tip.y - 22));
    labelEls.name.setAttribute('y', fmt(tip.y + 2));
    labelEls.act.setAttribute('text-anchor', 'middle');
    labelEls.name.setAttribute('text-anchor', 'middle');

    labelEls.group.classList.add('on');
    /* 类名沿用 locked（CSS 里那条就是"名字用灰的"），
       但判据换成"没读过" —— 于是 ??? 在主菜单里也是灰的。 */
    labelEls.group.classList.toggle('locked', hideName);
  }

  /** 把某一章写进底部的详情面板。 */
  function showDetail(chapter) {
    if (!detailEl || !chapter) { return; }

    /* ============================================================
       面板里**不再重复章名**。

       名字已经写在卡片正下方那条 SVG 标签上了（labelEls），
       而面板和标签永远说的是同一章 —— 同一行字在同一屏出现两次，
       中间只隔 50 个像素。所以面板改成只管"这一章的档案状态"：
       大字是状态（已归档 / 读取中 / 未读 / 未解锁），小字是记录号。

       顺便修掉一个**说反了的提示**：这里原来写「SEQ 1 · 转到面前再点一次」，
       可是面板只在"那张已经转到正面"时才更新 —— 提示玩家去做
       一件已经做完的事。现在只留 SEQ 号。
       ============================================================ */
    Animus.setDetail(detailEl, {
      value: STATE_TEXT[chapter.state] || '',
      id: 'SEQ ' + chapter.id
    });
  }

  /**
   * 换高亮 + 换名字 + 换详情。**不转圈、不进去。**
   *
   * 三件事都在这里，是因为它们永远是同一时刻发生的：
   * 指到谁 / 选中谁，界面上的这三处就得一起变。
   * 转圈是另一件事（placeRing），由 selectCard 单独调 ——
   * 混进来的话，鼠标扫过一排卡片界面会自己转好几圈。
   */
  function focusChapter(chapter, featherEl) {
    if (!chapter) { return; }

    if (featherEl) { markHover(featherEl); }
    showLabel(chapter);
    showDetail(chapter);
  }

  /** 这一章属于哪一幕。幕名是剧本自己的幕标题（见 fromLocalStory）。 */
  function actHeadOf(chapter) {
    var full = chapter.act || '';
    var colon = full.indexOf('\uFF1A');

    return colon > 0 ? full.slice(0, colon) : full;
  }

  /**
   * 从这里继续。
   *
   * 本模块**只把 stepId 交出去**，不自己跳。跳步要换场景 / 重载剧情，
   * 那是流程，属于调用方（主菜单发 menu.chapter，游戏里发 story.jump）。
   * 界面不认识流程，这是本项目一贯的分工。
   */
  function jumpTo(chapter) {
    if (!chapter) { return; }

    /* 一章的跳转目标是**它第一节的 stepId**（groupChapters 里记的 jump）。 */
    var stepId = chapter.jump || chapter.id;
    if (!stepId) { return; }

    /* 双保险：点击处已经拦过一次 locked，这里再拦一次 ——
       键盘 / 别的地方调进来也不会把 locked 跳出去。 */
    if (chapter.state === 'locked') { return; }

    if (typeof Animus.handlers.chapter === 'function') {
      Animus.handlers.chapter(stepId);
    }
  }

  /**
   * 把数据补齐，然后画出来。
   *
   * ============================================================
   * 要注意的两件事（都踩过）：
   *
   * ① **本地剧本画完不能就收工。** 原来写的是
   *    `if (fromLocalStory()) { render(); return; }` —— 主菜单页有
   *    story.js，所以它永远在这里返回，`story.progress.request`
   *    从来没发出去过。表现就是主菜单永远停在"全部未读"（全是 ???）。
   *
   * ② **已经有 chapters 也一样要问一次。** 本地那一版只知道"有哪几章"，
   *    不知道"读到哪了"（存档锚点在 C# 手里）。所以原来那条
   *    `if (chapters.length) { render(); return; }` 也会把请求挡掉。
   *    现在只有一条闸：**问过就不再问**（requestedAt），
   *    reload() 会把它清零。
   * ============================================================
   */
  function ensureData() {
    if (!chapters.length) {
      fromLocalStory();
    }

    render();

    if (requestedAt) {
      return;
    }

    if (!requestFromHost()) {
      return;
    }

    /* 超时再画一次 —— 那时提示文字会从"正在读取"变成"拿不到"。
       不这么做的话请求石沉大海时，页面会永远停在"正在读取"。 */
    window.setTimeout(function () {
      if (!chapters.length) {
        render();
      }
    }, REQUEST_TIMEOUT + 120);
  }

  /* ============================================================
     注册
     ============================================================ */

  /* 模块对象先写好再注册 —— build 里要把 module 自己传给 createPage，
     写成对象字面量的话在 build 内部拿不到自己的 code/desc。 */
  var module = {
    id: 'memory',
    no: '02',
    label: '章节选择',
    order: 10,
    code: 'REC · 01 / CHAPTERS',
    /* **没有 desc，是故意的。**
       这一页的内容就是那圈卡片，本来不需要一段话解释它是什么；
       而且这段小字正好压在卡片环的左上角上，和画面抢地方。
       记录号（code）已经在顶栏上了 —— createPage 那边也不再在正文里
       重复一遍，所以这一页现在只有一个标题 + 一圈卡。
       别的页（设置那几页）还有 desc，没动。 */
    build: function (host) {
      var parts = Animus.createPage(module, host);
      pageEl = parts.root;
      // 内容单独一层：render() 只清这一层（现在是空的，留着以后要加东西）
      contentEl = parts.list;
      detailEl = parts.detail;
      ensureData();
    },
    refresh: function (page) {
      pageEl = page;

      /* refresh 是在页面**已经显示之后**才调的。原来这里要补一次尺寸
         （build 时 .ax-page 还是 display:none，量出来宽高全是 0）。
         现在整张图是 SVG，缩放交给浏览器，**没有要量的东西了** ——
         只把数据补齐。 */
      ensureData();
    }
    /* 没有 leave()：这一页是静止的线稿，没有 rAF 要停。 */
  };

  Animus.register(module);

  return {
    /**
     * C# 回话时由 app.js 调用。
     * payload: { chapters:[{id,title,state}], progress, savedStepId }
     */
    setProgress: function (payload) {
      if (!payload) { return; }

      /* ============================================================
         存档锚点：**带上字段就整个覆盖，哪怕是空串。**

         原来写的是 `if (anchor) { hostAnchorId = anchor; }` —— 只有非空
         才记。于是锚点**粘住了**：玩家通关 / 清档之后，C# 明确报"没有存档"
         （savedStepId 是空串），网页却还把上一次那个 id 留着，
         「跟随进度」那一套主题就一直停在旧存档的位置上，重启才好。

         所以判据是"这次回话里有没有这个字段"，不是"它是不是空的"：
           有字段  → 覆盖（空串 = 真的没有存档，清掉）
           没字段  → 不动（老的 payload 形状，别误清）

         这和 uiSettings 那套"字段缺了就是 null"的坑是同一类问题，
         只是方向相反：那边怕误写成默认值，这边怕误留着旧值。
         ============================================================ */
      var hasAnchorField = ('savedStepId' in payload) || ('SavedStepId' in payload);
      var anchor = payload.savedStepId || payload.SavedStepId || '';
      if (hasAnchorField) { hostAnchorId = anchor; }

      var list = payload.chapters || payload.Chapters;

      /* 空表**也要处理**：它是"我这个场景里没有正在播的剧本"的明确回答，
         和"请求没人回"完全不是一回事 —— 显示的话术不一样，
         能做的事也不一样。 */
      if (!list || !list.length) {
        hostRepliedEmpty = true;

        /* ============================================================
           主菜单就走这条路：C# 那边没有 StoryManager，算不出整张表。

           原来到这里就 render() 收工，于是网页退回 `fromLocalStory()`，
           而它没有锚点，只能把每一章都标成 open —— 章名全露。
           现在 C# 把存档步 id 一起发过来，本地剧本拿它一查就知道
           哪几章读过了，读过的照常写名字，没读到的显示「???」。
           ============================================================ */
        if (anchor) { fromLocalStory(); }

        render();
        return;
      }

      hostRepliedEmpty = false;

      chapters = list.map(function (chapter) {
        return {
          id: chapter.id || chapter.Id || '',
          title: chapter.title || chapter.Title || '',
          state: chapter.state || chapter.State || 'locked'
        };
      });

      progress = typeof payload.progress === 'number' ? payload.progress : null;
      source = 'Unity 侧计算';
      render();
    },
    /** 给顶栏用：当前正在读的那一幕的标题。 */
    currentChapter: function () {
      for (var i = 0; i < chapters.length; i++) {
        if (chapters[i].state === 'current') {
          return chapters[i].title;
        }
      }
      return '';
    },
    progress: function () { return progress; },
    hasData: function () { return chapters.length > 0; },

    /**
     * **现在这一步的场景光照。** 给「主题模式 = 跟随进度」用。
     *
     * 返回 `{ background, rainy }` 或 null：
     *   background  剧本每一步自己带的 `background` 字段，只有 day / evening / night
     *   rainy       这一步的场景描述里有没有提到雨
     *
     * 为什么读剧本，而不是排一张"第几章配哪套主题"的表：
     * 剧本本来就把光照写好了 —— 每一步都有 `background`，场景描述里
     * 连天气都写了（`【场景】客厅 / 夜 / 雨声不止`、`雨后`、`雨未停`、
     * `雷雨将至`）。排表的话剧本一改就得跟着改，而且排出来的顺序一定
     * 不如剧本自己准：第 2 章是 白天/傍晚/深夜 各占一部分，
     * 排表就必须二选一，而"现在这一步"永远不会选错。
     *
     * 雨单独拎出来，是因为**它和时段是两个维度**：四套主题里的雨夜
     * 不是"更晚的夜"，是"外面在下雨的夜"。所以"下没下雨"是剧本的事实，
     * "下雨该算哪套主题"是主题那边的事（见 settings-module.js）。
     */
    currentLighting: function () {
      var vn = window.VN;
      var id = (vn && vn.state ? vn.state.currentId : null) || hostAnchorId;
      var story = (vn && vn.state && vn.state.story) || window.VN_STORY;

      if (!id || !story || !story.steps) { return null; }

      for (var i = 0; i < story.steps.length; i++) {
        var step = story.steps[i];
        if (!step || step.id !== id) { continue; }

        return {
          background: step.background || '',
          /* `stageNote` 是那一步的演出说明，里面写着【场景】和【BG】。
             只认「雨」和「雷」两个字 —— 剧本里出现它们的地方正好就是那几场
             （2-5 雨后 / 4-1 雷雨将至 / 4-3 雨声不止 / 5A-1 雨声渐缓 /
              5A-2 雨停后 / 5B-1 雨未停），和 animus.css 里雨夜那段的
             取色依据对得上。 */
          rainy: /雨|雷/.test(step.stageNote || '')
        };
      }

      return null;
    },

    /**
     * 把数据拉起来，并把顶栏那块读数刷成真的。
     *
     * **每个入口打开归档界面时都要调一次**（主菜单 boot.js、游戏页 app.js）。
     * 为什么不放在本模块加载时自己跑一遍：那一刻桥接可能还没连上 host，
     * `requestFromHost()` 会返回 false，而"什么时候连上了"只有入口知道。
     * 调多了也没关系 —— `requestedAt` 挡着，不会重复发请求。
     */
    warmUp: function () {
      ensureData();
    },

    /** 强制重新拿一次（比如读了档之后）。 */
    reload: function () {
      chapters = [];
      requestedAt = 0;
      ensureData();
    }
  };
})();
