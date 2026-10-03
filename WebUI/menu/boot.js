/* ============================================================
   boot.js —— 主菜单页的**唯一协调者**
   ------------------------------------------------------------
   menu-view.js 不知道 Animus 存在，Animus 也不知道主菜单存在。
   这一层是唯一同时认识"主菜单"和"归档系统"的地方，也是唯一认识 C# 的地方。

   为什么不把这些直接写进两个 view 里：
     因为"点设置就打开设置页""点开始游戏就告诉 C# 换场景"是**流程**，
     不是界面。流程会变（以后要加"继续游戏""读档"），界面尽量别跟着改。

   与 C# 的往来（协议见 bridge.js）：
     收  menu.show       { title, subtitle }        → 改标题
     收  settings.apply  { textSpeed, … }           → 刷新滑杆
     发  settings.request                           → 开机问一次当前设置
     发  settings.changed { textSpeed, … }          → 玩家改了设置（C# 负责落盘）
     发  menu.start                                 → 开始游戏（C# 负责换场景）
     发  menu.quit                                  → 退出
   ============================================================ */

(function () {
  'use strict';

  // 本页不再需要 DOM 引用表：布局由 CSS 按视口单位负责，
  // 立绘的位置/大小归 OML2D（见 live2d.js 的 TUNING），两边都不需要 JS 参与排版。

  /* ============================================================
     哪一格 → 哪个表情
     ------------------------------------------------------------
     表里的名字来自模型自己的 `2-3.model3.json`（一共四个：
     发光循环 / 困困眼 / 死鱼眼 / 空虚眼），**不是**策划案里那套
     `表情A/B/C`（圣洁 / 灿烂 / 委屈）—— 这两套名字不是一回事。

     这张表是**定下来的**（不再"按名字猜"）：
       发光循环   继续游戏 / 开始游戏 / **设置子桌面那四格**
       死鱼眼     章节选择
       困困眼     设置
       空虚眼     退出游戏
     想核对视觉效果，在页面上逐个悬停即可 —— 控制台会打
     `[VN:live2d] 表情 → 发光循环（走 model.expression）`。

     ⚠ **这个模型里没有叫"空洞眼"的表情。** 美术把"空洞"那个词用在了
       **参数**名上（`Param122 空洞眼开关`），而**表情**叫 `空虚眼`
       （`expressions/空虚眼.exp3.json`，`2-3.model3.json` 的 Expressions
       里也是这四个字）。所以表里必须写 `空虚眼` ——
       写错的名字不会报错到你看得出来：库找不到那个表情，她就保持原样不动。

     ## 「设置」子桌面那四格为什么统一是发光循环

     它们**曾经**是从各自的子页表里取表情（悬停「显示」预览死鱼眼……），
     本意是"进去之后会怎样"的预告。但那件事现在已经不成立了：
     进去之后她的状态复杂得多 —— 声音页按**语音的值和调整方向**变、
     文字页**退场**、显示页**只露半张脸**、立绘页**切全身取景**。
     悬停预告不了这些，只会让人以为"进去就是那样"。
     所以四格统一给最有精神的那张：**悬停是"我在看这一格"的反馈**，
     不是对下一页的承诺。

     **没进这张表的 key 一律落到默认表情**（得到 `undefined` →
     `setExpression` 恢复默认）。这不是"没反应"，是"保持默认"。
     指针不指着任何一格时（离开导轨 / 进子页 / 关掉界面）同理，传 `null`。
     ============================================================ */
  /** 有没有存档。由 C# 通过 menu.show 下发 —— 网页不自己猜。 */
  var hasSave = false;

  var EXPRESSIONS = {
    /* ---- 主桌面 ---- */
    continue: '发光循环',  // 继续游戏
    start: '发光循环',     // 开始游戏

    memory: '死鱼眼',      // 章节选择
    settings: '困困眼',    // 设置 —— 偏平淡
    quit: '空虚眼',        // 退出游戏 —— 最低落/最无所谓的那个

    /* ---- 「设置」子桌面那四格：统一（理由见上） ---- */
    sound: '发光循环',     // 声音
    text: '发光循环',      // 文字
    display: '发光循环',   // 显示
    portrait: '发光循环'   // 立绘
  };

  /* ============================================================
     她的样子（一）：子页 → 表情 + 姿态
     ------------------------------------------------------------
     「设置」进去之后是四页，每一页让她换个站法。这不是装饰 ——
     它同时是"这一页在管什么"的提示：

       sound     调音台      **往前凑**（放大 + 往左倾），**但不压到右边的参数**
       text      打字机      **直接退场**：整屏留给那一行字，她不抢戏
       display   显示输出    **右移到只露半张脸**：机器自己的参数，她让开
       portrait  立绘        整个人在画面里，正对着你（姿态留空，见下表）

     这张表不只装「设置」那四页：**「章节选择」也在里面**（`memory`），
     理由见下面那一条的注释 —— 桌面那格是什么表情，进去之后就还得是什么。

     ## 姿态是什么

       expression  表情名，来自模型自己的 2-3.model3.json
       dx / dy     位置偏移，**视口像素**（正 x 往右、正 y 往下）
       scale       大小倍数，1 = live2d.js 里 TUNING.scale 那个大小
       rotate      倾斜角，度。**正 = 顺时针 = 头往右倒**，绕她脚下那条轴转
       keepVisible 留下的**可见宽度**比例（0~1）。**按实测换算成横移，有它就忽略 dx。**
                   ⚠ 它算的是"可见宽度"，**不是"露多少脸"**，两者不是一回事：
                   `0.5` 会把她的脸**整个切掉**（脸在可见区的靠右一侧）。
                   显示页要的是"露半张脸"，所以那个值是 0.67 而不是 0.5。
                   它和 scale/rotate 别同时用 —— 那两个会改可见宽度。
       exit        **退场**：true = 从画面下缘走出去（整块往下推一个画布高）。
                   覆盖 dy；行级写 `exit: false` 可以把她叫回来。
       fullBody    取景：true = 整个人在画面里；不写 / false = 半身（主菜单那套）

     ⚠ **`fullBody` 只给「立绘」那一页开。** 主菜单（以及别的页）的构图
       是有意做成半身的 —— 她只占右侧、不抢戏。立绘页是唯一的例外：
       那一页就是在**调她**（亮度 / 饱和度 / 显不显示），看不见整个人就没法调。

     ## 「设置」那四页**没有 `expression`** —— 那是故意的

     进子页**不该换表情**：玩家点进来的目的是调参数，不是看她变脸，
     而且那一瞬间她本来正挂着"悬停那一格"的脸（设置子桌面四格统一发光循环）。
     所以这四页只声明**姿态 / 退场 / 取景**，表情那一项留空 =
     "没意见，保持她现在那张脸"。

     ⚠ 这里必须和"回到默认表情"区分开（`undefined` vs `null`）：
       - `null`    = 明确要求**回默认表情**（桌面：不指着任何一格时）
       - `undefined` = **没意见，不碰**（进子页时就是这样）
     两者混成同一个值的话，"进入子页"会被当成"回默认"，她的脸会跳一下 ——
     这正是这一条要修的现象。见 moodNow 里表情那一段和 refreshPortrait。

     读法：dx 正数 = 往右**离内容更远**；dy 正数 = 往下（缩到画面下缘外一点）；
     scale < 1 = 变小；rotate **负数 = 往左倾**（冲着她旁边那块内容）；
     keepVisible 越小 = 露得越少（0.5 一半、0.35 三成半）。
     她是从视口底部长上来的，所以"退"= 往右下（display 页是极端版：右移到只剩一半）；
     "凑近"= 往左上 + 变大 + 往内容那边倾。

     ⚠ **dx / dy / scale / rotate 都是临时值，没有实测过。**
       （`keepVisible` 例外：它是当场量出来的，不是填的。）
       live2d.js 里 TUNING 那段注释的教训在这儿同样成立：
       "这个参数的语义和直觉不一致，只能量"。调法：

         VN.character.setPose({ dx: -24, dy: -6, scale: 1.05, rotate: -1.6 })
         VN.character.setPose({ keepVisible: 0.5, dy: 20 })   ← 只露一半
         VN.character.setExpression('空虚眼')
         VN.character.setPose(null)     ← 回基准

       表情当场就能判断对错；姿态要试几轮。试对了把数字抄回这张表。
       倾斜那两项**故意做得很小（1~2 度）** —— 再多就不像倾斜，像没对齐。

     **没进这张表的子页**走默认：默认表情 + 基准姿态。
     要加就在这儿补一行 —— 调用处不认字，只查表。
     ============================================================ */
  var PAGE_MOODS = {
    /* 章节选择（记忆序列，id 来自 memory-module.js）。**这一条是为了和桌面那格对齐**：
       悬停「章节选择」是死鱼眼，进去之后还得是死鱼眼 ——
       不写这一条的话，进去那一瞬间她会变回默认表情，看起来像"点坏了"。
       姿态留空 = 基准：那一页她把整屏让给那圈卡片，不需要挪她。 */
    memory:   { expression: '死鱼眼' },

    /* 声音页：**往前凑**（稍微放大、往左倾）—— 她在听那三条电平条。

       ⚠ `dx` 是 **+80**，不是负数：第一版写成 -44（真往内容那边挪），
       结果**她的头发压到右侧那一列参数数值上了**。算一下就明白：

         内容列右缘 = 27vw + 35vw = 62vw          = 1190px（animus.css 的 .ax-body）
         她的左缘（基准位）                       = 1229px（0.64W，那条实测）
         scale 1.03 之后（原点在 82%/100%）       ≈ 1219px  ← 放大把她往左拉了 10px
         rotate -1.8° 之后**左上角**再往左摆       ≈   60px  ← 这一项最吃余量
         → 左上角 ≈ 1159px（60.4vw），伸进内容列 30px

         dx = +80 → 左上角 ≈ 1239px（**64.5vw**）：离内容列 49px 余量，
         而且正好回到"她基准位那条 0.64W 线"上 —— 放大和倾斜带来的左移
         被 dx 抵掉，剩下的只是"变大 + 偏头"，不再是"整个人往前压"。

       ⚠ **吃余量的是倾斜，不是放大。** 想让她别这么靠右，就减 rotate ——
         两个数要一起动：rotate -1.2 时 dx 只要 +60 就够（余量一样）。
       ⚠ 放大还有个风险：半身取景下她的头可能已经贴着画面上缘 ——
         看见头顶（和那圈光环）被切掉就把 scale 调回 1、或者把 dy 加大
         （dy 正数 = 往下，等于把头顶让出画面来）。 */
    sound:    { dx: 80, dy: 16, scale: 1.03, rotate: -1.8 },
    /* 文字页：**直接退场** —— 这一页是打字机预览，整屏给那一行字，
       她留在画面里只会和"逐字打出来"抢注意力。用 `exit` 而不是
       `keepVisible: 0`：往右切像被画面裁掉，往下走出去才像退场。

       ⚠ 她在场外时**行级那些表情反应等于看不见**（textSpeed / autoDelay
       两行只改表情、不改姿态，所以不会把她叫回来）。要让她在某一行上
       探头，就在那一行写 `exit: false` + 想要的姿态 —— moodField 逐项接，
       行能覆盖页。 */
    text:     { exit: true },
    /* 显示页：**往右挪到只露半张脸** —— 这一页管的是机器自己的参数，
       她躲到屏幕边上去，但脸还得留一半（观众要能认出是"她在让开"，
       整个切掉就变成"人不见了"）。
       `keepVisible 0.67` 是**反推**出来的，不是试出来的：
         她的左缘在 0.64W（animus.css 那条实测）= 1229px
         她的脸在约 0.88W（TUNING 那条实测）           = 1690px
         可见宽度 1920-1229 = 691px
         要让屏幕右缘切在脸中间 → 位移 1920-1690 = 230px
         → 留下 (691-230)/691 ≈ 0.67
       ⚠ 0.61~0.67 这个区间都可能（"她的脸在 0.88W"是在**另一个 position**
         下量的，[700,120] 相对 [820,220] 挪了多少只有"一点"这个描述）。
         这里取 0.67 = 偏保守（宁可多露一点脸）。要更贴脸就往下调到 0.6。
       **不再叠 scale / rotate**：那两个都会改她的可见宽度，0.67 就不是这个意思了。 */
    display:  { keepVisible: 0.67, dy: 20 },
    /* 立绘页：**只有这一页要全身**。她是这一页的内容，而这一页的控件
       （亮度 / 饱和度 / 显示与否）全在她身上 —— 看不见整个人就调不了。

       **姿态这一档刻意留空（= 中性）**：取景已经把她铺到画布高度的 94%，
       姿态那一层再放大就会把头顶和光环裁掉（两层是相乘的：0.94 × 1.08 > 1）。
       这一页的"上台"由全身取景本身表达，不需要再叠位移和缩放。

       退出去时 refreshPortrait 会把取景收回半身（见 live2d.js 的 setFraming）。 */
    portrait: { fullBody: true }
  };

  /* ============================================================
     她的样子（二）：你正指着的那一项 → 再加一层（行级）
     ------------------------------------------------------------
     上面那张表是"这一页的底子"，这一张**细到控件**：
     光标停在哪一行上，她就对那一项做反应。优先级：

       行（ROW_MOODS） > 值驱动的基调（VALUE_MOODS） > 子页（PAGE_MOODS） > 默认

     ## 三条规则

     1. **行里只写 `expression` = 姿态沿用这一页的。** 想为某一项换个站法，
        就把 dx/dy/scale/rotate 一起写上 —— 那是**绝对值**（替换掉页那一套），
        不是增量。写了几个就用几个，**没写的项自动从页那张表接上**，
        所以不会出现"半套姿态"。
     2. **没进这张表的行 = 只沿用页的反应**，不会掉到默认。
        所以这张表可以只写你有感觉的那几行。
     3. **行可以带一个 `when(settings)` 开关**：条件不成立时**整行作废**
        （落回下面几层，不是"换成别的表情"）。
        现在只有音乐/音效那两条用它 —— 它们要看**语音是不是还开着**：
        语音被关到 0 之后她处在"说不出话"的状态（空虚眼），
        悬停音乐/音效不该把她逗精神。

     ## "按值挂着"的那种反应不在这张表里

     语音音量那一条（0 空虚眼 / 小 死鱼眼 / 大 发光循环）是**状态**、
     不是悬停反应 —— 它住在下面的 `VALUE_MOODS`。两处分开写是有意的：
     写进这张表的话，那个关系只在"指着那一行"时才成立，
     而玩家要的是"调到 0 之后她一直空虚眼"。

     所以 `voiceVolume` 在这儿**只声明姿态**，表情留给 `VALUE_MOODS` 那一条
     （指着它时落下来正好接上 —— 见 moodNow 里表情那三层）。

     ## 每一条的由头（要改先看这里，别顺手"改通顺"）

       声音
         volume             主音量   她本来就困（总响度跟她没关系）
         bgmVolume          音乐音量 **语音没被关掉时**才有声音就精神（见 `when`）
         seVolume           音效音量 同上
         voiceVolume        语音音量 **按方向挂着**（VALUE_MOODS）：往左调 死鱼眼 / 往右调 发光循环 / 0 空虚眼
       文字（她在场外，这两行只看得出表情——而且看不到人）
         textSpeed          文字速度 字越快她越精神
         autoDelay          自动播放 等下一句 = 发呆
       显示
         animusThemeMode    主题模式 让机器决定 → 最没所谓的那张脸
         animusTheme        界面主题 换光 = 她身上那道信号色变了，她亮一下
         fullscreen         全屏     最没所谓的那张脸（**不动位置**，见下）
       立绘
         portraitVisible    显示立绘 在看自己那个开关（要被关掉的就是它）
         portraitBrightness 立绘亮度 她身上的光
         portraitSaturation 饱和度   去色 = 她自己变淡，有点乏

     ⚠ 这一页的行级姿态（`portraitVisible` 那个退半步）是叠在**全身取景**上的：
       那一档的 dx/dy/scale 是"半身基准"的量级，全身下会显得更小 ——
       要调就对着画面调（`VN.character.setPose({...})`）。

     ⚠ 同样是临时值。**行级只有两处动了姿态**（显示立绘 / 语音音量），
       其余都是**只换表情**（或按值换表情）—— 这一层动多了会很吵：
       玩家的鼠标在设置页里一直在动，而且是在两行之间来回动。
       特别是**开关类的那几行**（全屏 / 显示立绘）：开关就在行里，
       悬停它等于进了这一行，一动她就跟着挪，读起来像界面在抖。
       （全屏原来就是那样写的，已经改回只换表情 —— 见那一行的注释。）
       要让她"在某一项上换个站法"，先问自己：这件事**够不够重**？
       够重就该是"换一页"的量级，不是"悬停一行"。
     ============================================================ */
  var ROW_MOODS = {
    /* ---- 声音 ---- */
    volume:             { expression: '困困眼' },
    /* 音乐 / 音效两条：**语音还开着的时候**，有声音她就精神。
       `when` 是这一行的开关：语音被关到 0 之后这两条不再把她逗精神 ——
       她那时是"说不出话"的状态（VALUE_MOODS 给的空虚眼），
       悬停音乐/音效不该把她拉回来。条件不成立时**整行作废**，
       落回挂着的那一层（就是空虚眼）。
       ⚠ 音乐音量原来还带"再往前凑一点"那点姿态 —— 它整套挪到语音音量
         那一行去了（见下），所以这里只留表情。 */
    bgmVolume:          { expression: '发光循环', when: voiceAudible },
    seVolume:           { expression: '发光循环', when: voiceAudible },

    /* ============================================================
       语音音量：这一行**只声明姿态** —— 表情由上面 VALUE_MOODS 那条
       "按值挂着"的规则决定，因为那个关系是**状态**（语音调到 0 之后
       她在这页一直空虚眼），不该只在指着这一行时才生效。
       ============================================================ */
    voiceVolume: { scale: 1.05, rotate: -2.4 },

    /* ---- 文字 ----
       ⚠ 这一页她**退场了**（PAGE_MOODS.text 的 exit），所以这两行现在
       只改表情、而她在场外 —— 等于看不见效果。留着是因为哪天她又出场
       （或者你给某一行写 `exit: false` 把她叫回来）时它们还在。 */
    textSpeed:          { expression: '发光循环' },
    autoDelay:          { expression: '困困眼' },

    /* ---- 显示 ---- */
    animusThemeMode:    { expression: '死鱼眼' },
    animusTheme:        { expression: '发光循环' },
    /* 全屏：**只换表情，不动位置。**
       原来这里写的是 `keepVisible: 0.5, dy: 28`（"比这一页再躲远一点"），
       但实测下来那个效果是**鼠标一碰这颗开关她就往右挪**，像界面在抖 ——
       因为开关是行内的子元素，悬停它等于进了这一行，而行级焦点一变
       就会重算姿态。而且这一页她本来就已经躲在 0.67（半张脸）上了，
       "再躲远"多出来的那点位移没有信息量。
       真要让她在现场让开，那应该是**换一页**的量级，不是悬停一行。 */
    fullscreen:         { expression: '死鱼眼' },

    /* ---- 立绘 ---- */
    portraitVisible:    { expression: '空虚眼', dx: 12, dy: 8, scale: 0.97, rotate: 1.2 },
    portraitBrightness: { expression: '发光循环' },
    portraitSaturation: { expression: '困困眼' }
  };

  /**
   * 一个 key（瓦片 id）该配什么表情 —— **只看 `EXPRESSIONS` 一张表**。
   *
   * 这张表现在覆盖全部九格（主桌面五格 + 设置子桌面四格），
   * 所以"查不到"才是例外。查不到 → `null` = 默认表情：
   * "没反应"和"保持默认"在代码上是同一个东西，**不需要在调用处判断**。
   *
   * > 它原来是"先查 EXPRESSIONS、再落到 PAGE_MOODS[key].expression"，
   * > 后一跳是拿子页的表情当悬停预告。那一跳已经去掉了 ——
   * > 四格的预览改成统一发光循环（理由见上面 EXPRESSIONS 的表头）。
   * > 好处是这两件事**彻底解耦**了：子页的表情（管"进去之后"）
   * > 和悬停的反馈（管"我正在看哪一格"）各改各的，互不牵连。
   */
  function expressionOf(key) {
    return key ? (EXPRESSIONS[key] || null) : null;
  }

  function applyHoverExpression(key) {
    MenuCharacter.setExpression(expressionOf(key));
  }

  /** 现在停在第 1 层的哪一页上（null = 在桌面上）。由 Animus.handlers.page 下发。 */
  var currentPage = null;

  /** 光标现在停在这一页的哪一行上（null = 没指着任何一行）。
      由 AnimusSettings.handlers.rowHovered 下发 —— 只有设置那四页会有值。 */
  var currentRow = null;

  /**
   * 她现在的样子。**逐项**从里往外接：
   *
   *     行（你正指着的那一项） → 子页 → 默认
   *
   * 逐项取的意思是：行里只写了表情，姿态就还是这一页那一套（不会退成基准，
   * 也不会出现"半套姿态"）。见上面 ROW_MOODS 那三条规则。
   *
   * 两层都没有 → 返回 null = 默认表情 + 基准姿态（桌面上就是这个状态）。
   */
  function moodField(row, page, field, fallback) {
    if (row && row[field] !== undefined) { return row[field]; }
    if (page && page[field] !== undefined) { return page[field]; }
    return fallback;
  }

  /**
   * "按值挂着"的那一层：**语音音量那一项**决定她在这一页的基础表情。
   *
   * 和"悬停某一行的反应"不是一回事 —— 那是临时的（鼠标一离开就还回去），
   * 这是**状态**：语音调到 0 之后她在这页一直空虚眼，直到你调回去
   * （或者离开这一页）。
   *
   * 优先级：**行（悬停）> 这一层 > 页**。所以指着「主音量」时她是困困眼，
   * 手一移开又回到这一层算出来的那张脸。
   */
  var VALUE_MOODS = [
    {
      page: 'sound',
      key: 'voiceVolume',

      /* **只在"玩家在这一趟真的调过"之后才生效。**
         为什么需要这个闸门：进子页不该换表情 —— 一进「声音」页她就按语音的
         当前值变脸的话，那也是"进入子页切换表情"，正是要避免的。
         `voiceTrend` 在进/出页面时被清掉，所以它非空 = 这一趟调过。

         调过一次之后就**挂着**了：鼠标移开、悬停别的行、拖动别的滑杆都不影响，
         她保持那张脸直到你再调（或者离开这一页）。 */
      active: function () {
        return voiceTrend !== null;
      },

      /* ============================================================
         语音音量 → 她：**跟着"你往哪边调"**，不是按值切区间
         ------------------------------------------------------------
           拖到 0        → 空虚眼   （声音被彻底关掉，和往哪边拖无关）
           往左拖（调小） → 死鱼眼
           往右拖（调大） → 发光循环

         **为什么方向优先于值**：按值切区间（比如"小于一半就死鱼眼"）
         在"从 30% 拖到 60%"这一格上答错了 —— 那是**往大调**，
         她应该精神起来，而按值算她还在区间左边。
         玩家要的是"跟着你的动作"，所以记住最后一次调整的方向。

         方向的来源是 noteVoiceValue()；基线在进/出页面时重新对准
         （不然开机时 C# 推过来的那份存档值会被当成一次"调整"）。
         ============================================================ */
      byValue: function (value) {
        /* 0 优先于方向：拖到底就是"声音被关掉"。
           其余情况 active() 已经保证了 voiceTrend 非空，所以只看方向。 */
        if (value <= 0) { return '空虚眼'; }

        return voiceTrend === 'up' ? '发光循环' : '死鱼眼';
      }
    }
  ];

  /* 语音音量的"最后一次是往哪边调的"：'up' / 'down' / null（还没调过）。
     以及上一次的值（用来判断方向）。见上面 VALUE_MOODS 那段。 */
  var voiceTrend = null;
  var voiceLast = null;

  /** 语音音量的当前值（拿不到就 null）。 */
  function voiceValue() {
    var settings = AnimusSettings.get() || {};
    var value = settings.voiceVolume;

    return typeof value === 'number' ? value : null;
  }

  /**
   * 记下语音这次的**调整方向**。
   *
   * 别的设置项一变这个回调也会来，所以**值没变就什么都不做** ——
   * 不然调一次文字速度会把语音的方向也重置掉。
   */
  function noteVoiceValue(next) {
    if (typeof next !== 'number') {
      return;
    }

    if (voiceLast !== null && next !== voiceLast) {
      voiceTrend = next > voiceLast ? 'up' : 'down';
    }

    voiceLast = next;
  }

  /** 语音还开着吗（语音音量不为 0）。给行级 `when` 用的。 */
  function voiceAudible(settings) {
    return (settings.voiceVolume || 0) > 0;
  }

  /**
   * 这一页"按值挂着"的表情（没有这样的规则就返回 null）。
   *
   * 值从 AnimusSettings 现读（`get()` 是整份快照）。设置模块在发 `changed`
   * 之前就已经写进 current 了（见 onControlChanged），所以这里读到的一定是
   * 刚拖到的那个值。
   */
  function stickyExpression(pageId, settings) {
    if (!pageId) {
      return null;
    }

    for (var i = 0; i < VALUE_MOODS.length; i++) {
      var rule = VALUE_MOODS[i];

      if (rule.page !== pageId) {
        continue;
      }

      /* 这一条现在**算不算数**（比如语音那条要求"这一趟真的调过"）。 */
      if (typeof rule.active === 'function' && !rule.active()) {
        continue;
      }

      var value = settings[rule.key];

      return rule.byValue(typeof value === 'number' ? value : 0);
    }

    return null;
  }

  /**
   * 这一行最终生效的那一份（`null` = 当它没写）。
   *
   * `when` 是**行自己的开关**：有些行的反应依赖**别的设置项**
   * （音乐 / 音效那两条要看语音是不是还开着）。条件不成立时整行作废 ——
   * 不是"换成别的表情"，而是**落回下面几层**（挂着的那一层 / 页）。
   * 这样"她那时候该是什么样"只有一个答案，不用在这儿再写一遍。
   */
  function rowMood(key, settings) {
    var mood = key ? ROW_MOODS[key] : null;

    if (!mood) {
      return null;
    }

    if (typeof mood.when === 'function' && !mood.when(settings)) {
      return null;
    }

    return mood;
  }

  function moodNow() {
    var settings = AnimusSettings.get() || {};
    var page = currentPage ? PAGE_MOODS[currentPage] : null;
    var row = rowMood(currentRow, settings);

    if (!page && !row) {
      return null;
    }

    /* 表情是**三层**：行（悬停）> 值驱动的基调（挂着）> 页。
       ⚠ 值那一层必须**压过页** —— 否则声音页自己的「困困眼」会把
       "语音调到 0 → 空虚眼"挡掉，而那个关系正是玩家要的
       （"调到 0 之后她一直空虚眼"）。所以这里不能用 moodField 一把查，
       三层的顺序得写死。

       **返回值有三态**，别把它们混成一个：
         一个字符串  → 就用这个表情
         `null`      → 明确要求**回默认表情**（谁都没编排时由 refreshPortrait 决定）
         `undefined` → **没意见，什么都不碰**（进子页时就是这样，见 PAGE_MOODS） */
    var expression;

    if (row && row.expression !== undefined) {
      expression = row.expression;
    } else {
      expression = stickyExpression(currentPage, settings);

      if (expression === null) {
        /* 页那一层没有 `expression` 时给 `undefined`（= 没意见），
           **不要落成 null** —— 那就变成"进子页顺便回默认表情"了。 */
        expression = page && page.expression !== undefined ? page.expression : undefined;
      }
    }

    return {
      expression: expression,
      dx: moodField(row, page, 'dx', 0),
      dy: moodField(row, page, 'dy', 0),
      scale: moodField(row, page, 'scale', 1),
      rotate: moodField(row, page, 'rotate', 0),
      /* "只露出多少"。没写就是 null → live2d.js 那边当成"没用这个字段"，
         横移照旧走 dx。给了值就是它说了算（实测换算，忽略 dx）。 */
      keepVisible: moodField(row, page, 'keepVisible', null),
      /* 退场。**行级写 `exit: false` 可以把她叫回来**（moodField 逐项接，
         显式的 false 会盖掉页的 true）—— 想让某一页里"只有这一行她才出场"
         就靠这个。 */
      exit: moodField(row, page, 'exit', false),
      /* 取景由页决定（行也可以覆盖，但没这个必要）—— 见 PAGE_MOODS.portrait */
      fullBody: moodField(row, page, 'fullBody', false),
      fill: moodField(row, page, 'fill', null)
    };
  }

  /**
   * 把 moodNow() 算出来的那一套应用到立绘上。
   *
   * **子页和行优先于桌面悬停**：进了某一页之后指针就不再指着桌面那一格，
   * 所以页面里那一套说了算；退出来时外壳会发 `page(null)`，这里就回基准。
   *
   * **进出必须成对**：只发"进去了"不发"出来了"的话，她会一直保持那一页的姿态
   * —— 进「立绘」页再退回来，她还站在台上放大着。这条对称性由外壳保证
   *（见 animus.js 的 notifyPage），本文件只管查表。
   */
  function refreshPortrait() {
    var mood = moodNow();

    if (!mood) {
      // 桌面上 / 没编排过的子页 → 默认表情 + 基准姿态 + 半身取景
      applyHoverExpression(null);
      MenuCharacter.setPose(null);
      MenuCharacter.setFraming(false);
      return;
    }

    /* 表情：**只有"有意见"才动她**。
       - `undefined`（进子页、或者行里没写表情）= 保持她现在那张脸，**不碰**
       - 字符串 = 就用那个
       - `null` = 回默认表情（表里显式写 `expression: null` 时；桌面那条路
         走的是上面 `if (!mood)` 那一支，也回默认） */
    if (mood.expression !== undefined) {
      MenuCharacter.setExpression(mood.expression);
    }

    MenuCharacter.setPose(mood);
    /* 取景（半身 / 全身）。**只有立绘页那一行是 true** ——
       主菜单永远是半身，所以这里传 false 是常态，不是"没生效"。
       模型还没就绪时它会自己重试（见 live2d.js 的 retryFraming）。 */
    MenuCharacter.setFraming(!!mood.fullBody, mood.fill);
  }

  /* ============================================================
     背景的唯一入口
     ------------------------------------------------------------
     MenuBackground 是**装饰层**：它没加载上（文件缺失、canvas 拿不到
     上下文、老浏览器）也不该让菜单瘫掉。所以所有调用都从这里走，
     缺了就静默跳过 —— 和 live2d.js 失败时自己降级是同一个原则。
     ============================================================ */
  function bg(method, arg) {
    var api = window.MenuBackground;

    if (api && typeof api[method] === 'function') {
      api[method](arg);
    }
  }

  /* ============================================================
     进游戏：**她闯进来**（不是淡出）
     ------------------------------------------------------------
     这一下的叙事是"归档软件被真人撞开"，所以四件事一起发生
     （全部在 menu.css 里，见那边的 keyframes）：

       0–190ms   她扑向镜头（放大 1.35、亮度顶起来）+ 这层 OS 界面被撞开
                 （缩小、往左退、抖动、故障撕裂）
       190–370ms 她的光炸开、盖满屏
       370–520ms 白光保持 —— **C# 就是在这片白里换场景的**

     所以这里要做的只有三件：
       1. 加 `menu-leaving`（CSS 全在那边）
       2. 让外壳放一下故障（`Animus.glitch()`，就是它自己换层用的那套）
       3. 演完才发消息 —— 见下面"为什么不能先发"那一段

     为什么不能"发完消息让 C# 自己切"：C# 换场景要时间。先发消息的话，
     网页这一层先消失，玩家看到的是"菜单没了、画面还在原地"，然后才黑一下。
     发晚了没关系：C# 换场景的耗时正好接在这段动画后面。

     那层光（`#handoff-veil`，样式在 theme.css、两页共用）盖住的正是
     **换场景 + 整页跳转**那一段；到了游戏页再从光里收出来。

     ⚠ 520ms 这个数和 menu.css 的时间轴必须对齐，改一个要改两个。
     ============================================================ */
  var LEAVING_MS = 520;
  var leaving = false;

  function leaveToGame(message, payload) {
    /* 连点两下不该发两条消息 */
    if (leaving) {
      return;
    }

    /* 浏览器里预览时没有宿主，发了也没人接 —— 那就别演退场，
       否则菜单会淡掉然后永远停在淡掉的状态（预览时最讨厌这种）。 */
    if (!VNBridge.hasHost()) {
      console.log('[VN:menu] 没有宿主（浏览器预览），' + message + ' 不发送、也不演退场。');
      return;
    }

    leaving = true;

    document.body.classList.add('menu-leaving');

    /* 这层界面**先坏一下**：她是"撞"进来的，不是"淡"进来的。 */
    if (window.Animus && typeof Animus.glitch === 'function') {
      Animus.glitch();
    }

    var veil = document.getElementById('handoff-veil');
    if (veil) {
      veil.classList.add('covered');
    }

    /* 她扑向镜头 —— **走姿态那一层**，不用 keyframes。
       为什么：`#oml2d-canvas` 上那条 transform 带 `!important`
       （为了压住库运行时注入的样式表），而 CSS 级联里**动画排在 important
       声明之前**，所以 keyframes 里写的 transform 会被直接吃掉
       （表现是"她一动不动"）。姿态变量本来就是喂给那条规则的，正好用它。
       幅度和曲线在 menu.css 的 `body.menu-leaving #oml2d-canvas` 里。
       dy 是正的：放大 1.35 会把她的头推出画面上缘（她从下往上长），
       用 dy 把她压回来，读起来正好是"怼到镜头前"。 */
    MenuCharacter.setPose({ dx: -20, dy: 240, scale: 1.35, rotate: -1.5 });

    window.setTimeout(function () {
      VNBridge.send(message, payload || {});
    }, LEAVING_MS);
  }

  /** 把两套界面接起来。这是整个文件存在的理由。 */
  function bindHandlers() {
    MainMenuView.handlers.start = function () {
      // 先收菜单再发消息：换场景要等 C# 走完，中间这段空白不该还压着一个菜单。
      MainMenuView.hide();
      leaveToGame('menu.start');
    };

    /* 继续游戏：只发消息，不做任何剧情判断。
       存档的有无、续到哪一步，都由 C# 决定（它才是存档的权威）——
       前端连"有没有存档"都不自己判断，只按 C# 下发的 hasSave 决定按钮灰不灰。 */
    MainMenuView.handlers.continue = function () {
      MainMenuView.hide();
      leaveToGame('menu.continue');
    };

    MainMenuView.handlers.settings = function () {
      /* 打开 Animus 归档系统。它是**第三套界面**（见 animus/），
         主菜单页和游戏页都会加载它 —— 所以这里只负责"用主菜单的语境打开它"，
         界面的样子和内容是别人的事。 */
      MainMenuView.hide();
      openAnimus();
    };

    /* ============================================================
       悬停一格 → 她换表情
       ------------------------------------------------------------
       **这一路原来挂在 MainMenuView 那列按钮上，被"改成 Animus 桌面"顺手弄断了。**

       断在哪：唯一调用 MenuCharacter.setExpression 的地方是下面
       MainMenuView.handlers.hover，而它的来源是 menu-view.js 里绑在
       #menu-buttons 上的 mouseover。可本文件 init() 里已经
       `MainMenuView.hide()` —— `#menu-layer.hidden` 是
       `visibility: hidden; pointer-events: none`（menu.css），
       那 4 个按钮**永远不可能被指到**，回调是死代码。
       于是她的表情一直停在默认值，而且不报错、不警告。

       现在出口由 Animus 外壳统一发（`Animus.handlers.hover`，参数是模块 id）：
       鼠标划过瓦片、键盘 ↑↓、离开导轨、关掉界面，四种情况都从那一处出来。
       （**"点进某一格"不算** —— 见 animus.js 的 enterFolder：那条 null
       会把她的脸打回默认，于是"进子页"变成"顺便回默认表情"。）
       外壳不知道表情这回事，本文件不知道瓦片在哪 —— 和别处同一个分工。

       ⚠ 顺手带出来的一件事：`bg('setActive', key)`（把背景那条线索点亮）
         仍然只在旧入口里。Animus 桌面这一路**还没有接**，
         所以"划过一格 → 背景亮起来"目前是没有的 —— 背景的 rAF
         本来就 `bg('stop')` 掉了（见 init()），要接回来得先把它 start 起来。
       ============================================================ */
    /* 桌面上的悬停 → 表情。**进到子页里就不接管了** ——
       那一页有自己的编排（见 refreshPortrait），
       这时候还按悬停改表情会让"她变了"这件事忽有忽无：
       鼠标一划过左边那条导轨她就跳回桌面的表情。 */
    Animus.handlers.hover = function (id) {
      if (currentPage) {
        return;
      }

      applyHoverExpression(id);
    };

    /* 子页进出 → 换姿态（姿态/退场/取景这一档一定跟着页走）；
       **表情只在这一页有 `expression` 时才换** —— 四页都没有，
       所以进子页不换表情（理由见 PAGE_MOODS 那段）。
       外壳保证"进去发 id、出来发 null"成对（见 animus.js 的 notifyPage），
       所以这里可以直接拿它当状态用。 */
    Animus.handlers.page = function (id) {
      currentPage = id || null;

      /* 换页（或回桌面）时行焦点一定失效了 —— 不清的话，下一页没有那一行，
         她会拿着上一页那一行的反应不放（比如从「全屏」退到桌面，
         她还缩在最远处）。 */
      currentRow = null;

      /* 语音的基线重新对准当前值、方向清空。
         为什么要重新对准：开机时 C# 会推一份存档值过来（那**不是**玩家调的），
         不重新对准的话，玩家第一次拖滑杆算出来的方向会是反的。 */
      voiceLast = voiceValue();
      voiceTrend = null;

      refreshPortrait();
    };

    /* 光标停在设置页的哪一行上 → 她对**那一项**再反应一层（见 ROW_MOODS）。
       和上面的 Animus.handlers.hover 是两层不同的"指着"：
       那个指着桌面上的瓦片，这个指着页面里的控件。子页开着的时候
       只可能发生后者（导轨那时是藏起来的）。 */
    AnimusSettings.handlers.rowHovered = function (key) {
      currentRow = key || null;
      refreshPortrait();
    };

    /* 旧入口留着（见上面那段注释）。**两个入口共用 applyHoverExpression**，
       免得以后把标题画面接回来时两张映射表各说各话。 */
    MainMenuView.handlers.hover = function (key) {
      applyHoverExpression(key);
      bg('setActive', key);
    };

    MainMenuView.handlers.quit = function () {
      if (VNBridge.hasHost()) {
        VNBridge.send('menu.quit', {});
      } else {
        // 浏览器里没有"退出"这回事，说清楚总比按钮点了没反应好
        MainMenuView.setHint('（正在浏览器里预览，退出按钮只在 Unity 内生效）');
      }
    };

    /* ---------------- Animus ---------------- */

    /* 底栏动作。**第 0 层（桌面）没有底栏动作** —— 那一步能做的事
       就是"选文件夹"和"进去"。
       「返回」由 Animus 外壳自己处理（返回上一层），不在这里写。
       「恢复默认」是设置页自己的动作，挂在各模块的 actions 上。 */
    Animus.handlers.action = function (id) {
      if (id === 'reset') {
        AnimusSettings.resetToDefaults();
      }
    };

    /* 第 0 层按 Esc 什么都不做。
       这是**标题画面**，按一下 Esc 就退出的行为会让人误触 ——
       要退出得选「退出游戏」或「关闭」。 */
    Animus.handlers.esc = function () {
      return true;
    };

    /* 章节跳跃：时间线上点了某一段 → 告诉 C# 从那里接着读。
       本页只发意图，换场景和跳步都是 C# 的事。
       **这一条也是"进游戏"**（C# 会换到 MainRoom），所以走同一条退场通道 ——
       不这么做的话，从章节选择跳进去是硬切，而开始游戏是渐入，两条路手感不一样。 */
    Animus.handlers.chapter = function (stepId) {
      leaveToGame('menu.chapter', { stepId: stepId });
    };

    AnimusSettings.handlers.changed = function (settings) {
      // 名字用 settings.changed 而不是 settings.set：
      // 这是"通知 C# 我改了"，不是"命令 C# 去改"。C# 收到后自己决定要不要落盘、
      // 要不要真的切全屏，并且会回一条 settings.apply 做最终确认。
      VNBridge.send('settings.changed', settings);

      /* **值变了就得重算她该是什么样** —— 因为语音音量那一条是"按值挂着"的
         （VALUE_MOODS），而且它看的是**调整方向**：拖左死鱼眼、拖右发光循环、
         拖到 0 空虚眼。所以先记方向、再重算，两步的顺序不能反。
         拖滑杆时这个回调每一格都会来一次，所以：
           - live2d.js 那边对"同一个表情"做了去重（不然刷屏 + 一直抖）
           - setPose / setFraming 写同样的值本来就是空操作
         只重算她、不碰 C# 那条消息，两件事互不依赖。 */
      noteVoiceValue(settings.voiceVolume);
      refreshPortrait();
    };
  }

  /**
   * 打开 Animus 桌面 —— **它就是这个页面的主菜单**。
   *
   * 参考图里那一套（Animus Desktop）本来就是"操作系统"：一摞瓦片里
   * 混着「继续」「放弃记忆」「离开」这些主菜单级的动作。
   * 所以主菜单不再另做一个画面，桌面本身就是。
   *
   * 瓦片的顺序由各模块的 order 决定：
   *   -10 继续游戏 / -5 开始游戏 → 10 章节选择 → 20~50 设置那四页 → 900 退出
   * 动作在最上最下、内容在中间，和参考图那摞瓦片的排法一致。
   */
  function openAnimus() {
    Animus.open({
      kicker: '记 忆 归 档',
      title: '甜味的坠落',
      /* 顶层**显式列出**五格，不用 null（null = 所有已注册的都上来）。
         声音/文字/显示/立绘 挂在「设置」这个文件夹里，不该摊在桌面上 ——
         参考图的桌面也是「选项」一个入口，不是四条散项。 */
      modules: ['continue', 'start', 'memory', 'settings', 'quit'],
      /* ============================================================
         **rows 不在这里给了。**
         顶栏那两行读数（章节 / 进度）归记忆模块 —— 它是唯一知道
         "读到哪一章了"的地方，主菜单和游戏页共用它那一份。
         原来这里是写死的 `['系统','就绪'] / ['序列','未载入']`，
         在主菜单上永远是这两句占位。

         open 之后要立刻 warmUp 一次，否则那两行会空着等 C# 回话。
         warmUp 里本地剧本那一遍是同步的，所以第一帧就是真数据。
         ============================================================ */
      escLabel: '关闭',
      actions: []
    });

    /* **开完立刻把记忆数据拉起来**，顶栏那两行才不会空着等 C# 回话。
       warmUp 里本地剧本那一遍是同步的（story.js 就在这一页手上），
       所以第一帧就有一份真数据；C# 回话之后再被精修一次
       （比如补上"存档停在哪一章"）。 */
    if (window.AnimusMemory && typeof AnimusMemory.warmUp === 'function') {
      AnimusMemory.warmUp();
    }

    /* 主题要是「跟随时间 / 跟随进度」，依据分别来自本机时钟和
       "现在读到哪里" —— 后者刚被上面那句 warmUp 填上，所以必须重算一次。
       不重算的话跟随模式在开局这几秒用的是上一次算出来的那套
       （主菜单第一眼就是错的）。 */
    if (window.AnimusSettings && typeof AnimusSettings.refreshTheme === 'function') {
      AnimusSettings.refreshTheme();
    }
  }

  /**
   * 桌面上的动作瓦片。
   *
   * 它们不是"界面"，只是三格瓦片 —— 界面归 animus/，流程归本文件。
   * 和游戏页那三个（继续 / 回主菜单 / 退出）的差别是：这边多一个「开始游戏」，
   * 少了「回主菜单」（已经在主菜单里了）。
   */
  function registerDesktopTiles() {
    Animus.register({
      id: 'continue', no: '00', label: '继续游戏', order: -10,
      code: 'CMD · CONTINUE',
      desc: '从上次读到的地方接着往下。',
      preview: function () { return [['存档', hasSave ? '有' : '无']]; },
      run: function () {
        if (!hasSave) { return; }
        /* 走统一的退场通道 —— 不直接 send，否则这一路是硬切（见 leaveToGame）。 */
        leaveToGame('menu.continue');
      },
      /* 没有存档时这格不该出现 —— available() 每次开菜单都会重问一遍，
         所以存档状态变了它自己会跟。 */
      available: function () { return hasSave; }
    });

    Animus.register({
      id: 'start', no: '01', label: '开始游戏', order: -5,
      code: 'CMD · NEW GAME',
      desc: '从头开始。会覆盖当前的进度 —— 存档系统还没做，所以没有确认弹窗。',
      run: function () { leaveToGame('menu.start'); }
    });

    /* ---- 「设置」是一格瓦片，不是四格 ----
       参考图的桌面里「选项」是一个入口，声音/文字/显示那些在**它里面**。
       把四页摊在桌面上会让桌面变成一长条杂项列表，也不符合参考图的层级。

       children 是外壳的"子桌面"机制：进去之后换一摞瓦片，
       顶栏 / 导轨 / 预览面板 / 面包屑都还在原位；返回时回到原来那一格。 */
    Animus.register({
      id: 'settings', no: '05', label: '设置', order: 50,
      code: 'REC · 05 / OPTIONS',
      desc: '音频、文字、显示输出，以及右侧那位的成像参数。',
      children: ['sound', 'text', 'display', 'portrait'],
      preview: function () {
        var s = AnimusSettings.get();
        return [
          ['主音量', Math.round(s.volume * 100) + '%'],
          ['立绘', s.portraitVisible ? '显示' : '隐藏']
        ];
      }
    });

    Animus.register({
      id: 'quit', no: '90', label: '退出游戏', order: 900,
      code: 'CMD · QUIT',
      desc: '直接退出。设置会保存，剧情进度不会。',
      run: function () {
        if (VNBridge.hasHost()) {
          VNBridge.send('menu.quit', {});
        } else {
          MainMenuView.setHint('（正在浏览器里预览，退出只在 Unity 内生效）');
        }
      }
    });
  }

  function handleBridgeMessage(type, payload) {
    switch (type) {
      case 'menu.show':
        MainMenuView.setText(payload.title, payload.subtitle);

        /* 「继续游戏」那一格出不出现由 C# 说了算 —— 存档在 PlayerPrefs 里，
           网页无从判断，也不该猜。先记下来，那格瓦片的 available() 读它。 */
        hasSave = !!payload.hasSave;

        /* ============================================================
           顶栏那块读数（同步率 / 章节 / 进度）**这里再拉一次**。

           `menu.show` 是"桥接确实连上了、C# 确实在说话"的第一个信号 ——
           比 DOMContentLoaded 可靠（那时候 host 可能还没连上，
           openAnimus 里那次 warmUp 就只会拿到本地那一版）。
           到手的存档锚点就是从这里进去的：读过的章写得出名字，
           没读到的显示「???」。
           ============================================================ */
        if (window.AnimusMemory && typeof AnimusMemory.warmUp === 'function') {
          AnimusMemory.warmUp();
        }

        Animus.refreshNav();
        break;

      case 'settings.apply':
        // C# 把设置对象直接当 payload 发（形如 {textSpeed:34,…}），
        // 也接受包一层 settings 的形态。
        AnimusSettings.apply(payload.settings || payload);
        break;

      default:
        console.warn('[VN:menu] 未知的桥接消息：', type);
        break;
    }
  }

  function init() {
    /* 桌面上的动作瓦片和设置页排在同一摞里，所以和它们一样在加载时就注册。
       注册晚了第一次打开会少几格。 */
    registerDesktopTiles();

    /* 立绘先起。失败不会抛出来 —— live2d.js 自己会在右下角显示原因，
       桌面本体继续可用（没有立绘也不该连菜单都进不去）。 */
    MenuCharacter.init();

    bindHandlers();
    VNBridge.subscribe(handleBridgeMessage);

    /* ============================================================
       **Animus 桌面就是这个页面的主菜单。**
       ------------------------------------------------------------
       参考图里那一套本来就是"操作系统" —— 一摞瓦片里混着「继续」
       「开始游戏」「退出」这些主菜单级的动作。所以不再另做一个标题画面。

       代价：background.js 那条暖色绳影背景和 menu-view.js 那列选项
       现在都不显示了（代码留着，主题要重做时可能还用得上）。
       背景的 rAF 也一起停掉 —— 看不见的东西不该继续烧 CPU。

       init() 还是要调：它负责缓存 DOM 和绑事件，`hide()` 才有东西可藏。
       不调的话 `hide()` 会撞上空的 DOM 引用直接抛，
       而抛在 init 的中途 ＝ 后面所有事都不做（页面看起来什么都没发生）。 */
    MainMenuView.init();
    MainMenuView.hide();
    bg('stop');

    openAnimus();

    // 主动问 C# 要当前设置，而不是等 C# 推。
    // 主动推必须踩准"网页还没加载完 / 桥接还没连上"的时机，两个场景里这个时机
    // 还不一样；网页自己知道自己什么时候准备好了，所以让网页开口问。
    VNBridge.send('settings.request', {});

    /* ============================================================
       「画好了」—— Unity 侧那层光（Assets/Scripts/UI/HandoffVeil.cs）等的就是这一条。
       ------------------------------------------------------------
       从游戏退回主菜单时，Unity 会在换场景那一帧把光盖满：新场景里的 WebView 是
       全新的对象，CEF 要重新启动、这个页面要重新加载，中间那 1~3 秒屏幕上是空的。
       收到这条才敢收光 —— 判据是"页面画出来了"，不是"引擎连上了"。

       **两个 rAF 之后再发**：rAF 回调跑在"这一帧即将被画出来"之前，
       只等一个 rAF 的话画面其实还没上屏，那边一收光就会露出真实场景，
       紧接着本页画出来又是一次闪白。嵌两层才落到**第一帧画完之后**。
       ============================================================ */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        VNBridge.send('ready', { mode: 'menu' });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 调试用：控制台里可直接操作。
  // 调立绘取景：VN.character.setFraming(true, 1.05) ← 全身（数字 = 占画布高的比例）
  //         VN.character.setFraming(false)         ← 回主菜单那套半身
  //         （主菜单那套本身在 live2d.js 的 TUNING，改完 VN.character.reload()）
  // 调**子页/行级编排**（PAGE_MOODS / ROW_MOODS 那些数）：不用改文件，控制台直接试 ——
  //         VN.character.setPose({ dx: -24, dy: -6, scale: 1.05, rotate: -1.6 })
  //         VN.character.setExpression('空虚眼')
  //         VN.character.setPose(null)   ← 回基准
  //         试好把数字抄回上面那两张表
  // 调背景：改 background.js 顶部的 CFG，然后 VN.background.sync()；
  //         想看当前几何就 VN.background.debug()
  // 调设置页：VN.animus.open({...}) 可以直接把它掀开
  // 姿态的原点（判据：她原地放大、原地倾斜）写在 menu.css 的 #oml2d-canvas 上
  window.VN = {
    menu: MainMenuView,
    animus: Animus,
    settings: AnimusSettings,
    character: MenuCharacter,
    background: window.MenuBackground,
    bridge: VNBridge
  };
})();
