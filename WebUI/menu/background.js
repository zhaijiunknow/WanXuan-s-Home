/* ============================================================
   background.js —— 主菜单的动态背景（menu/index.html 专用）
   ------------------------------------------------------------
   画什么：一条缓慢摆动的**索引绳**（归档用的那根），每个选项从背景里
   延伸出一条**线索**接到绳上的一个节点。悬停选项时线索亮起、一颗
   光点从背景流到节点、节点扩散一圈涟漪。

   参考的是刺客信条 Animus 那类界面：**界面不是浮在背景上的卡片，
   而是从背景里长出来的**。所以这里刻意做了两件事：
     1) 线索的起点在画面左侧的暗处，沿线 alpha 从 0 渐亮到节点 ——
        读起来是"从背景里延伸出来"，而不是"画了一条横线"；
     2) 绳的上下两端都淡出到 0 —— 结构是**从画面外延伸进来的**，
        画面只是它的一个窗口。

   **不是 DNA。** 上一版这里是"双螺旋 + 横档"（两条链加碱基对），
   那是 AC 的血脉档案隐喻 —— 剧本里没有血缘、没有遗传、没有族谱，
   照着画会误导人。剧本自己的词是**归档**（4-1：皖萱给她的"调查样本"
   做归档），所以现在只剩一根绳：没有第二条链，也没有横档。
   真正像"从背景里延伸出来"的是**线索**，那部分一个字没改。

   ## 坐标约定

   所有结构参数都存成**视口比例**（0..1），每帧才换算成像素。
   这样窗口一变化不需要重算任何东西，也不会出现"改完窗口锚点跑到别处"。

   ## 与 DOM 的耦合只有一处

   节点的 y 是从 `#menu-buttons button` 的 getBoundingClientRect() 量的。
   这是**故意**的：只有量真实位置，"界面长在背景上"才成立；
   要是这里按公式算一个位置，菜单一改版两边就错开了。

   ## 排查

   控制台里：VN.background.sync() 重量一次节点位置；
            VN.background.debug() 打印当前几何。
   ============================================================ */

window.MenuBackground = (function () {
  'use strict';

  /* ============================================================
     可调参数 —— 背景的样子只改这一段
     ============================================================ */
  var CFG = {
    /* 主轴（索引绳）的横向位置，视口宽的比例。
       0.50 正好落在"文字列的右缘"和"她"中间那条空档里。
       如果她往左压到主轴上了，就把这个数加大（0.53 / 0.56）。
       实测记录（别推理，和立绘的 TUNING.position 一样只能量）：
         0.500  当前值，左侧文字列右缘约 0.42W，她大约在 0.72W 之后 */
    spineX: 0.500,

    /* 打开设置页时主轴往右让位。
       设置的内容占 6.9vw..60.9vw，主轴留在 0.50 会被压在设置文字底下，
       所以让它退到她旁边那条空档去。0.665 留了约 5.6vw 的余量。 */
    spineXSettings: 0.665,

    /* 主轴可见范围的上下端（视口高的比例）。两端各有一段淡出，
       让结构看起来是延伸到画面外的。 */
    topU: 0.100,
    bottomU: 0.920,
    fadeU: 0.17,          /* 两端淡出的长度，占可见范围的比例 */

    amplitude: 0.048,     /* 索引绳的横向摆幅（视口宽） */
    turns: 0.62,          /* 从顶到底荡几个来回。旧的 2.3 是给双螺旋用的
                             —— 一根绳拧 2.3 圈就是弹簧了 */
    spinSeconds: 46,      /* 荡一个周期要多少秒；越大越慢（绳比螺旋重） */
    sampleStep: 0.0035,   /* 绳的采样步长（视口高的比例），越小越圆滑 */

    strandWidth: 0.0023,  /* 绳的粗细（视口宽） */
    glowScale: 7,         /* 光晕层相对绳粗的倍数 */
    glowAlpha: 0.13,      /* 光晕层的透明度（绳本体之外那一圈） */
    strandAlphaGold: 0.50,
    axisAlpha: 0.10,      /* 中轴线：把节点串起来的那条极淡的竖线 */

    /* 线索从视口的哪一列开始"浮出"背景。
       0.235 在选项文字（约到 0.18W）之后、主轴之前的空档里。 */
    filamentEmergeX: 0.235,
    /* 线索的垂度（视口高的比例）。起点比节点低这么多，往右抬上来接到节点。
       一条完全水平的直线看着像标尺刻度，微微起弧才像"长出来的枝条"。 */
    filamentSag: 0.011,
    filamentAlpha: 0.42,
    filamentHotAlpha: 0.95,
    nodeSize: 0.0052,     /* 节点菱形半径（视口宽） */

    particles: 58,
    particleRise: 0.0000135,  /* 尘埃每秒上浮的视口高比例 */
    particleAlpha: 0.34,

    /* 入场编排：整条链从中间往两端长出来，然后线索逐条延伸，最后节点亮起。
       数值是毫秒；线索的那一组和 menu.css 里 option-in 的延迟同量级，
       这样"选项落下"和"线延伸过来"是同一件事的两个面。 */
    entranceHold: 260,
    entranceGrow: 1250,
    filamentDelay: 640,
    filamentStagger: 95,
    filamentGrow: 620,
    nodeRevealMs: 240,    /* 节点从无到有要多久（从它自己的 due 时刻起算） */
    hotMs: 150,           /* 悬停高亮的淡入淡出 */
    spineMs: 520,         /* 主轴在菜单/设置之间挪位的时长 */

    /* 设置页打开时，两层结构各退到什么程度（1 = 完全不退）。
       线索链只对主菜单的选项有意义，所以几乎完全退场；
       绳和网格是**环境**，留七成下来当背景。
       退场时长和 spineMs 共用（它们是同一件事：让位）。 */
    settingsChainDim: 0.12,
    settingsHelixDim: 0.70
  };

  /* 配色：全部取自 theme.css 的 room 主题，不在这里发明新颜色 */
  var GOLD = '232,197,106';   /* --accent-gold #E8C56A */
  /* TEAL 是给第二条链用的。只剩一根绳之后它没人用了，但留着 ——
   它是主题里的 --accent，别的地方（比如以后要加的强调色）还能取。 */
var TEAL = '62,140,132';    /* --accent    #3E8C84 */
  var CREAM = '255,247,234';  /* --plate-text #FFF7EA */

  var canvas = null;
  var ctx = null;

  var W = 0;                /* 视口 CSS 宽 */
  var H = 0;                /* 视口 CSS 高 */
  var dpr = 1;

  var nodes = [];           /* {key, y, order, reveal, hot} */
  var particles = [];
  var ripples = [];         /* {y, born} 悬停时节点扩散的涟漪 */

  var activeKey = null;
  var mode = 'menu';

  var startedAt = 0;
  var rafId = 0;
  var running = false;
  var reducedMotion = false;

  /* 主轴位置：菜单 0.50 ←→ 设置 0.645。
     存的是"从哪、到哪、什么时候开始挪"，当前值每帧现算（见 drawScene）。 */
  var spineFrom = CFG.spineX;
  var spineTo = CFG.spineX;
  var spineAt = 0;
  var spineXNow = CFG.spineX;

  /* "设置页让位"的进度 0→1。和主轴共用 spineAt（同一件事的两个面）。 */
  var modeFrom = 0;
  var modeAmount = 0;

  /**
   * 让位系数。设置页打开时，属于**主菜单**的东西要退到 floor 那一档。
   * floor = 1 表示完全不退。
   */
  function modeDim(floor) {
    return 1 - modeAmount * (1 - floor);
  }

  /* ============================================================
     几何
     ============================================================ */

  /** 主轴当前的横向像素位置。 */
  function spinePx() {
    return W * spineXNow;
  }

  function topPx() { return H * CFG.topU; }
  function bottomPx() { return H * CFG.bottomU; }

  /** u（0..1，沿主轴的归一位置）→ 视口 y 像素 */
  function uToY(u) {
    return topPx() + (bottomPx() - topPx()) * u;
  }

  /**
   * 两端淡出系数。
   * 用 smoothstep 而不是线性：线性淡出会在两端留下一条"能看出停在哪"的硬边。
   */
  function fadeAt(u) {
    if (u < CFG.fadeU) {
      var a = u / CFG.fadeU;
      return a * a * (3 - 2 * a);
    }
    if (u > 1 - CFG.fadeU) {
      var b = (1 - u) / CFG.fadeU;
      return b * b * (3 - 2 * b);
    }
    return 1;
  }

  /** 自转角（弧度）。整条链一起转，所以看着像"结构在自转"而不是"波浪在跑"。 */
  function spinAngle(now) {
    return (now / 1000) / CFG.spinSeconds * Math.PI * 2;
  }

  function easeOutCubic(t) {
    var p = 1 - t;
    return 1 - p * p * p;
  }

  function clamp01(t) {
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  /* ============================================================
     这一层为什么**没有跨帧累加的状态**
     ------------------------------------------------------------
     全篇不用 `value += (target - value) * dt / k` 那种写法。三个理由：

       ① 它把动画钉死在 dt 上。同一时刻连着派发两帧时 dt = 0，
          value 就永远涨不上去 —— 画面上看到的是"这一层根本不存在"，
          代码却完全正常。这个坑在 CEF 的虚拟时间下实测踩到过。
       ② 它和帧率绑定，30fps 和 120fps 下快慢不一样。
       ③ 更隐蔽的一条：`state.at` 如果记的是"哪一帧才发现目标变了"，
          那么事件发生到下一帧之间的那段真实时间就被丢掉了。
          正常跑没事，但只要某一刻只渲染了一帧，那一次过渡就会算出 0。
          所以在下面，凡是"某个时刻开始的变化"，记的都是
          **变化发生的那一刻**（setActive / setMode 里取的 performance.now()），
          而不是接手的那一帧。

     结果：任意一帧都能独立算对，跳帧、卡顿、只画一帧，结果都一样。
     ============================================================ */

  function smoothstep(t) {
    var x = clamp01(t);
    return x * x * (3 - 2 * x);
  }

  /* ============================================================
     节点：位置全部从真实 DOM 量出来
     ============================================================ */

  function measureNodes() {
    var list = [];
    var container = document.getElementById('menu-buttons');

    if (container && canvas) {
      var host = canvas.getBoundingClientRect();
      var buttons = container.querySelectorAll('button[data-menu]');

      for (var i = 0; i < buttons.length; i++) {
        var rect = buttons[i].getBoundingClientRect();

        // 布局还没完成时 rect 会是全 0，那种值不能要
        if (rect.height <= 0) {
          continue;
        }

        list.push({
          key: buttons[i].getAttribute('data-menu'),
          y: rect.top - host.top + rect.height / 2,
          order: list.length,
          reveal: 0,
          hot: 0,
          /* 悬停高亮的过渡状态：从哪个值、什么时候开始过渡。
             时间戳由 setActive 打（事件发生的那一刻），不是由帧循环打。 */
          hotFrom: 0,
          hotAt: 0
        });
      }
    }

    /* 兜底：量不到就按"绕画面中心均分"摆一排。
       宁可摆放得不对，也不要整个背景空着 —— 那会让人以为页面坏了。 */
    if (!list.length) {
      var keys = ['continue', 'start', 'settings', 'quit'];
      var span = H * 0.052;
      var mid = H * 0.56;

      for (var k = 0; k < keys.length; k++) {
        list.push({
          key: keys[k],
          y: mid + (k - (keys.length - 1) / 2) * span,
          order: k,
          reveal: 0,
          hot: 0,
          hotFrom: 0,
          hotAt: 0
        });
      }
    }

    /* 重量的时候把旧的进度按 key 接过来。
       不接的话，窗口一 resize、或者字体加载完触发的那次重量，
       已经在跑的入场动画会从零重来 —— 现场看就是"闪了一下"。 */
    for (var n = 0; n < list.length; n++) {
      var old = findNode(nodes, list[n].key);
      if (old) {
        list[n].reveal = old.reveal;
        list[n].hot = old.hot;
        list[n].hotFrom = old.hotFrom;
        list[n].hotAt = old.hotAt;
      }
    }

    nodes = list;
  }

  function findNode(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        return list[i];
      }
    }
    return null;
  }

  /* ============================================================
     尘埃
     ============================================================ */

  function seedParticles() {
    particles = [];

    for (var i = 0; i < CFG.particles; i++) {
      particles.push({
        x: Math.random(),
        /* 起始高度。位置的**计算**放在绘制时按绝对时间做，
           这里只存常量 —— 粒子和上面的缓动守同一条规矩，不靠累加推进。 */
        y0: Math.random() * 1.04,
        r: 0.6 + Math.random() * 1.6,
        a: 0.35 + Math.random() * 0.65,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.25 + Math.random() * 0.5,
        // 每颗尘埃的呼吸相位不同，整片才不会一起闪（一起闪像故障）
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.4 + Math.random() * 0.9
      });
    }
  }

  function drawParticles(now) {
    /* 从开场到现在一共上浮了多少个视口高。
       用"总位移取模"而不是每帧 p.y -= v*dt：前者不依赖 dt，
       而且窗口卡一下之后尘埃的位置仍然是对的，不会越飘越偏。 */
    var rise = (now / 1000) * CFG.particleRise;
    var t = now / 1000;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      var y = p.y0 - rise;
      y = y - Math.floor(y / 1.04) * 1.04;   // 取模到 [0, 1.04)

      // 横向摆动：正弦位移指数很小，只是"不是直线上升"而已
      var x = (p.x + Math.sin(p.swayPhase + t * p.swaySpeed) * 0.006) * W;
      var twinkle = 0.55 + 0.45 * Math.sin(p.twinklePhase + t * p.twinkleSpeed);

      // 左侧更亮：那一片最暗，尘埃在那里才看得见；
      // 右边本来就亮，再撒亮点多此一举。
      var side = 1 - 0.55 * clamp01((p.x - 0.45) / 0.55);

      ctx.beginPath();
      ctx.arc(x, y * H, p.r * (W / 1920) * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + CREAM + ',' +
        (CFG.particleAlpha * p.a * twinkle * side).toFixed(3) + ')';
      ctx.fill();
    }
  }

  /* ============================================================
     索引绳
     ============================================================ */

  /**
   * 画一根绳。
   *
   * 纵向的 alpha 用一个**垂直渐变**当 strokeStyle 解决 ——
   * canvas 的描边不能逐顶点给 alpha，但可以整条路径用一个渐变。
   * 两端淡出正好是"从上到下"的，所以一个渐变就够了，不用分段描。
   */
  function drawStrand(phase, rgb, alpha, width) {
    var cx = spinePx();
    var amp = W * CFG.amplitude;
    var top = topPx();
    var bottom = bottomPx();

    ctx.beginPath();

    var step = H * CFG.sampleStep;
    var first = true;

    for (var y = top; y <= bottom; y += step) {
      var u = (y - top) / (bottom - top);
      var x = cx + amp * Math.sin(u * CFG.turns * Math.PI * 2 + phase);

      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }

    var grad = ctx.createLinearGradient(0, top, 0, bottom);
    var f = CFG.fadeU;

    /* 渐变里的每一档都要乘上 fadeAt()，
       否则"淡出两端"这件事在渐变和采样里会各做一次，叠加起来两端会断得太快。 */
    grad.addColorStop(0, 'rgba(' + rgb + ',0)');
    grad.addColorStop(f * 0.5, 'rgba(' + rgb + ',' + (alpha * fadeAt(f * 0.5) * 0.5).toFixed(3) + ')');
    grad.addColorStop(f, 'rgba(' + rgb + ',' + (alpha * fadeAt(f)).toFixed(3) + ')');
    grad.addColorStop(0.5, 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')');
    grad.addColorStop(1 - f, 'rgba(' + rgb + ',' + (alpha * fadeAt(1 - f)).toFixed(3) + ')');
    grad.addColorStop(1 - f * 0.5, 'rgba(' + rgb + ',' + (alpha * fadeAt(1 - f * 0.5) * 0.5).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /* 这里原来有一个 drawRungs()（横档 = DNA 的梯子）。
     一根绳没有横档可画，整个函数删掉了。 */

  /** 中轴线：极淡的竖线，把各个节点串成一串，也让"结构延伸出画面"更成立。 */
  function drawAxis() {
    var cx = spinePx();
    var top = topPx();
    var bottom = bottomPx();

    var grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, 'rgba(' + GOLD + ',0)');
    grad.addColorStop(0.5, 'rgba(' + GOLD + ',' +
      (CFG.axisAlpha * modeDim(CFG.settingsHelixDim)).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + GOLD + ',0)');

    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, W * CFG.strandWidth * 0.5);
    ctx.stroke();
  }

  /* ============================================================
     线索链：选项 → 主轴
     ============================================================ */

  /** 一条线索当前应该伸到多长（0..1）。入场时逐条延伸，之后恒为 1。 */
  function filamentProgress(node, now) {
    var elapsed = now - startedAt - CFG.filamentDelay - node.order * CFG.filamentStagger;

    if (elapsed <= 0) {
      return 0;
    }
    if (elapsed >= CFG.filamentGrow) {
      return 1;
    }

    return easeOutCubic(elapsed / CFG.filamentGrow);
  }

  function drawFilament(node, now) {
    var p = filamentProgress(node, now);

    if (p <= 0 || node.reveal <= 0) {
      return;
    }

    var cx = spinePx();
    var x0 = W * CFG.filamentEmergeX;
    var x1 = x0 + (cx - x0) * p;
    var y = node.y;
    var c = filamentCurve(x0, x1, y);

    var hot = node.hot;
    var alpha = (CFG.filamentAlpha + (CFG.filamentHotAlpha - CFG.filamentAlpha) * hot)
      * node.reveal * fadeAt(uOf(y)) * modeDim(CFG.settingsChainDim);

    /* 横向渐变：起点 alpha 0 → 节点处最亮。
       这一条就是"从背景里延伸出来"的全部秘密 —— 线不是从某个坐标开始的，
       它是**渐渐显形**的。 */
    var grad = ctx.createLinearGradient(x0, 0, cx, 0);
    grad.addColorStop(0, 'rgba(' + GOLD + ',0)');
    grad.addColorStop(0.35, 'rgba(' + GOLD + ',' + (alpha * 0.28).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + GOLD + ',' + alpha.toFixed(3) + ')');

    ctx.beginPath();
    ctx.moveTo(c.x0, c.y0);
    ctx.quadraticCurveTo(c.x1, c.y1, c.x2, c.y2);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1, W * CFG.strandWidth * (0.5 + hot * 0.7));
    ctx.stroke();

    /* 常态下的"数据流动"：一小段更亮的线沿着线索慢慢地走。
       没有它，静止的线就是死的；有了它，线在**呼吸**。
       位置必须按弧线求，否则光点会从线上飘出去。 */
    if (p >= 1) {
      var flowPos = ((now / 3200) + node.order * 0.27) % 1;
      var tA = clamp01(flowPos - 0.07);
      var tB = clamp01(flowPos + 0.07);

      var flowGrad = ctx.createLinearGradient(
        quadPoint(c.x0, c.x1, c.x2, tA), 0,
        quadPoint(c.x0, c.x1, c.x2, tB), 0);
      flowGrad.addColorStop(0, 'rgba(' + CREAM + ',0)');
      flowGrad.addColorStop(0.5, 'rgba(' + CREAM + ',' +
        (0.18 * node.reveal * modeDim(CFG.settingsChainDim)).toFixed(3) + ')');
      flowGrad.addColorStop(1, 'rgba(' + CREAM + ',0)');

      ctx.beginPath();
      ctx.moveTo(
        quadPoint(c.x0, c.x1, c.x2, tA),
        quadPoint(c.y0, c.y1, c.y2, tA));
      ctx.lineTo(
        quadPoint(c.x0, c.x1, c.x2, tB),
        quadPoint(c.y0, c.y1, c.y2, tB));
      ctx.strokeStyle = flowGrad;
      ctx.lineWidth = Math.max(1, W * CFG.strandWidth * 0.9);
      ctx.stroke();
    }
  }

  /** 由像素 y 反推 u，用来查淡出系数。 */
  function uOf(y) {
    var top = topPx();
    var bottom = bottomPx();
    return clamp01((y - top) / (bottom - top));
  }

  /**
   * 二次贝塞尔求值。
   *
   * 线索是有弧度的，所以沿途的每一个点（尤其是那颗游走的光点）都必须
   * 落在**这条弧**上；按直线插值的话光点会离开线自己飘，一眼就看出是假的。
   */
  function quadPoint(p0, p1, p2, t) {
    var m = 1 - t;
    return m * m * p0 + 2 * m * t * p1 + t * t * p2;
  }

  /**
   * 线索的控制点。起点在节点下方 sag 处，往右抬起接到节点 ——
   * 控制点取在 0.55 处并且只抬到 sag 的 0.3，是为了让"抬起来"这件事
   * 集中在线条靠右的一段：左边大半段几乎还是平的，读起来才像从暗处伸出来。
   */
  function filamentCurve(x0, x1, y) {
    var sag = H * CFG.filamentSag;
    return {
      x0: x0, y0: y + sag,
      x1: x0 + (x1 - x0) * 0.55, y1: y + sag * 0.3,
      x2: x1, y2: y
    };
  }

  /**
   * 节点：一个 45° 的菱形，形状和标题上那个 「✦」 是同一族。
   * 未悬停时只有描边，悬停时实心 + 一圈涟漪。
   */
  function drawNode(node) {
    if (node.reveal <= 0) {
      return;
    }

    var cx = spinePx();
    var dim = modeDim(CFG.settingsChainDim);
    var s = W * CFG.nodeSize * (1 + node.hot * 0.85) * node.reveal * dim;
    var alpha = (0.55 + 0.45 * node.hot) * node.reveal * fadeAt(uOf(node.y)) * dim;

    ctx.save();
    ctx.translate(cx, node.y);
    ctx.rotate(Math.PI / 4);

    ctx.beginPath();
    ctx.rect(-s, -s, s * 2, s * 2);

    ctx.fillStyle = 'rgba(' + GOLD + ',' + (node.hot * 0.55 * node.reveal).toFixed(3) + ')';
    ctx.fill();

    ctx.strokeStyle = 'rgba(' + GOLD + ',' + alpha.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, W * CFG.strandWidth * 0.7);
    ctx.stroke();

    ctx.restore();
  }

  /* ============================================================
     涟漪：悬停/选中时从节点扩散出去
     ============================================================ */

  function drawRipples(now) {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var age = (now - ripples[i].born) / 950;

      if (age >= 1) {
        ripples.splice(i, 1);
        continue;
      }

      var e = 1 - Math.pow(1 - age, 3);
      var r = W * CFG.nodeSize + e * W * 0.030;

      ctx.beginPath();
      ctx.arc(spinePx(), ripples[i].y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + GOLD + ',' +
        (0.42 * (1 - age) * modeDim(CFG.settingsChainDim)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, W * CFG.strandWidth * 0.8);
      ctx.stroke();
    }
  }

  /* ============================================================
     主循环
     ============================================================ */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);

    /* 这里**刻意不判断 document.hidden**。
       UWB 走的是 CEF 的离屏渲染（OSR），这种模式下 visibilityState 有可能
       一直是 hidden 而画面照常在画 —— 一旦按它提前 return，背景就永远静止，
       而且现场看起来跟"代码没跑"一模一样，很难查。
       旁边的立绘（PIXI 的 ticker）也是无条件跑的，两边保持一致。 */

    updateNodes(now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawScene(now);
  }

  /**
   * 画一张完整的画面。
   *
   * 时间只从一个地方进来（now），所有会动的东西都在这里或它调用的函数里
   * 由 now 直接算出来 —— 没有任何跨帧累加的状态。这一点是刻意的：
   * 累加状态一旦遇到"同一时刻连发两帧"就会停住，而画面上只会表现为
   * "某些东西不动"，非常难查。
   */
  function drawScene(now) {
    var i;

    // 主轴位置：每帧按"开始挪的那一刻"现算，不累加
    var yieldT = smoothstep((now - spineAt) / CFG.spineMs);
    spineXNow = spineFrom + (spineTo - spineFrom) * yieldT;
    modeAmount = modeFrom + ((mode === 'settings' ? 1 : 0) - modeFrom) * yieldT;

    // 尘埃在裁剪之外：它是环境，不参与"链长出来"的编排
    drawParticles(now);

    // 线索在裁剪之外：它有自己的延伸进度，不需要再被链的生长范围切一次
    for (i = 0; i < nodes.length; i++) {
      drawFilament(nodes[i], now);
    }

    /* 绳本身（轴线 / 索引绳）一起被"从中间往两端长出来"的矩形裁掉。
       两者必须同进同出，否则会看到绳先铺满、生长却是另一套 —— 那是散架。 */
    ctx.save();
    clipToGrowth(now);

    var phase = spinAngle(now);
    var helixDim = modeDim(CFG.settingsHelixDim);

    drawAxis();
    /* 只有一根。上一版这里还有第二条链 + 横档 —— 那是 DNA 的样子，
       和剧本对不上，所以删了（TEAL 这个色也就跟着没人用了）。 */
    drawStrand(phase, GOLD, CFG.strandAlphaGold * helixDim, Math.max(1.2, W * CFG.strandWidth));

    ctx.restore();

    for (i = 0; i < nodes.length; i++) {
      drawNode(nodes[i]);
    }

    drawRipples(now);
  }

  /**
   * 逐个节点推进 reveal（长出来）和 hot（悬停高亮）。
   *
   * 两个都是**纯函数**，一个累加状态都不留：
   *   reveal 只用入场时间轴算（单向的，永远 0→1，不需要记住过去）；
   *   hot    用"上一次变化发生在哪一刻"算（时间戳由 setActive 打）。
   *
   * reveal 用的是**和绳、线索同一套时间轴**：绳长完 → 线索延伸 → 节点亮起。
   * 三段错开是入场编排的全部内容，别把它们并到一起，一起出现就没有"编排"了。
   */
  function updateNodes(now) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      var due = startedAt + CFG.filamentDelay + i * CFG.filamentStagger + CFG.filamentGrow * 0.55;
      node.reveal = smoothstep((now - due) / CFG.nodeRevealMs);

      var to = node.key === activeKey ? 1 : 0;
      node.hot = node.hotFrom + (to - node.hotFrom) * smoothstep((now - node.hotAt) / CFG.hotMs);
    }
  }

  /** 给链的生长做裁剪：只画"已经长到"的那一段。 */
  function clipToGrowth(now) {
    var t = clamp01((now - startedAt - CFG.entranceHold) / CFG.entranceGrow);
    var e = easeOutCubic(t);
    var mid = (topPx() + bottomPx()) / 2;
    var half = (bottomPx() - topPx()) / 2 * e;

    ctx.beginPath();
    ctx.rect(0, mid - half, W, half * 2);
    ctx.clip();
  }

  /* ============================================================
     对外
     ============================================================ */

  function resize() {
    if (!canvas) {
      return;
    }

    W = window.innerWidth || 1920;
    H = window.innerHeight || 1080;

    /* DPR 封顶 1.5：CEF 的离屏渲染再高的倍率只是白烧 CPU，
       而背景全是低对比的软结构，1.5 和 2 肉眼分不出来。 */
    dpr = Math.min(1.5, window.devicePixelRatio || 1);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    measureNodes();

    /* 尘埃只在第一次播种。拖动窗口边缘时 resize 会连着触发几十次，
       每次重掷位置的话整片星尘会不停"闪"一下 —— 那是很明显的破绽。 */
    if (!particles.length) {
      seedParticles();
    }
  }

  /** 重量节点位置。菜单卡片有缩放/位移动画时（比如打开设置）之后调一次。 */
  function sync() {
    measureNodes();
  }

  function setActive(key) {
    var next = key || null;

    if (next === activeKey) {
      return;
    }

    activeKey = next;

    /* 过渡的起点记在**这里**，不是记在下一帧。
       差别在"事件发生到下一帧之间"那段真实时间会不会被丢掉 ——
       丢掉了，第一帧永远算出 0，高亮看起来就是"没反应"。 */
    var at = performance.now();

    for (var i = 0; i < nodes.length; i++) {
      nodes[i].hotFrom = nodes[i].hot;
      nodes[i].hotAt = at;
    }

    // 涟漪只在"选中了某一项"时放，离开时安静地暗下去就好
    var node = findNode(nodes, next);
    if (node) {
      ripples.push({ y: node.y, born: at });
    }
  }

  function setMode(next) {
    var wanted = next === 'settings' ? 'settings' : 'menu';

    if (wanted === mode) {
      return;
    }

    mode = wanted;

    /* 同上：从**当前值**出发，记下开始挪的时刻。
       从当前值而不是从"上一个目标"出发，来回快速切换时不会跳。 */
    spineFrom = spineXNow;
    spineTo = mode === 'settings' ? CFG.spineXSettings : CFG.spineX;
    spineAt = performance.now();
    modeFrom = modeAmount;
  }

  function init() {
    canvas = document.getElementById('menu-bg-canvas');

    if (!canvas) {
      console.warn('[VN:bg] 找不到 #menu-bg-canvas，动态背景跳过。');
      return;
    }

    ctx = canvas.getContext('2d');

    if (!ctx) {
      console.warn('[VN:bg] 拿不到 2d 上下文，动态背景跳过。');
      return;
    }

    reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    startedAt = performance.now();

    resize();

    window.addEventListener('resize', resize);

    /* 字体加载完会把文字撑开一点，按钮的位置会跟着变 —— 重量一次。
       不重量的话节点会停在字体替换前的旧位置上，看着像"线接错了"。 */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { sync(); });
    }

    // 入场动画期间卡片在动，量到的是中间态；动画结束后再校一次
    window.setTimeout(sync, 900);

    if (reducedMotion) {
      // 只画一帧静态的：结构要在，但不动
      frameOnce();
      return;
    }

    running = true;
    rafId = window.requestAnimationFrame(frame);
  }

  /** 减少动态效果时用：把时间钉在"入场已完成"的那一刻，画一帧就收工。 */
  function frameOnce() {
    var fake = startedAt + CFG.entranceHold + CFG.entranceGrow +
      CFG.filamentDelay + CFG.filamentStagger * 8 + CFG.filamentGrow + 600;

    measureNodes();
    updateNodes(fake);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawScene(fake);
  }

  function stop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    running = false;
  }

  function debug() {
    return {
      视口: [W, H],
      dpr: dpr,
      主轴x: Math.round(spinePx()),
      模式: mode,
      当前悬停: activeKey,
      节点: nodes.map(function (n) {
        return { key: n.key, y: Math.round(n.y), reveal: +n.reveal.toFixed(2), hot: +n.hot.toFixed(2) };
      })
    };
  }
  return {
    init: init,
    sync: sync,
    stop: stop,
    setActive: setActive,
    setMode: setMode,
    debug: debug,
    config: CFG
  };
})();
