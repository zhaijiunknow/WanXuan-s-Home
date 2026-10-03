/* ============================================================
   live2d.js —— 主菜单右侧的立绘（oh-my-live2d）
   ------------------------------------------------------------
   立绘**在网页里**，不在 Unity 场景里。理由：不用手写场景 YAML（立绘预制体
   在 Unity 里带着约 670 条 layer 覆盖和一批 stripped 交叉引用，手写必炸），
   而且悬停菜单项 → 她换表情是同页面直接调，不用走桥接、没有延迟。

   配置基线来自 D:\NekoClaw\PersonalPage\index.html 里一份**跑通过的**
   同模型配置（那边模型放在 l2ds/宅久/，这边由 WebUiServer 挂在 /models/ 下）。

   ## 前提：必须通过 Unity 的 WebUiServer 打开本页
   oh-my-live2d 要用 fetch 读 .moc3，而 file:// 下 CEF 一律拒绝
   （和当初 fetch('story.json') 被拒是同一个原因）。所以：
     ✅ 从 Unity 里跑 MainMenu 场景
     ❌ 直接双击 menu/index.html（菜单能显示，立绘不会出来，会看到右下角提示）
   ============================================================ */

window.MenuCharacter = (function () {
  'use strict';

  /* ============================================================
     可调参数 —— 调立绘的位置和大小只改这一段
     ------------------------------------------------------------
     position : [x, y]，相对停靠位置的偏移（像素）。负 x = 往左
     scale    : 整体缩放。0.08 是 PersonalPage 上这个模型的比例
     height   : 立绘舞台高度（像素）。这是最主要的"她有多大"的旋钮
     ============================================================ */
  var TUNING = {
    /* 位置：[x, y] 画布像素（x 往右、y 往下）。
       嫌她偏右就把 x 减小，嫌偏高就把 y 加大。
       改完在控制台执行 VN.character.reload() 立即生效。

       实测记录（别用推理，这个参数的语义和直觉不一致）：
         [820, 220] @0.30  她的脸落在画面右侧约 88% 处，身体被右边缘切掉
         [700, 120] @0.30  当前：往左、往上一点

       ⚠ 这一套是**主菜单的构图**（半身），别为了"看得见她整个人"改它 ——
       全身只在「设置 → 立绘」那一页用，由 FRAMING 那一层临时切过去
       （见下面「取景」那段），退出来还是这一套。 */
    position: [700, 120],

    /* 整体缩放。setScale(t, t) 是等比的，改它不会把人物拉变形。
       0.30 是**半身**的比例：值越大，画面里剩下的越少。
       （全身的比例大约 0.16 —— 那是由 FRAMING 算出来的，不是填在这儿的。） */
    scale: 0.30,

    /* 舞台高度：视口高度的比例。1 = 撑满。 */
    heightRatio: 1
  };

  /* 立绘的宽高比**锁定 16:9**。
     为什么这样就不会变形：库把 canvas 固定设成 width:100%/height:100%（stage 的尺寸），
     也就是"模型被压进 stage 的比例里"。窗口一变、stage 比例跟着变，人就被拉长或压扁。
     把 stage 的比例写死，模型就永远以同一个比例渲染，与窗口无关。
     而 16:9 恰好等于 CEF 的视口比例，所以盒子正好覆盖整个视口 ——
     既锁定比例，又宽到不可能裁到人。
     菜单那边（menu.css）仍然用 vw/clamp 自由适应，两者互不影响。 */
  var STAGE_ASPECT = 16 / 9;

  /* ============================================================
     取景：半身（主菜单）/ 全身（设置里的「立绘」页）
     ------------------------------------------------------------
     **主菜单那套半身取景是有意为之的**：她只占右侧、不抢戏，标题和选项
     都在左边。所以 TUNING 那三个数不动，主菜单永远用它 —— 别为了
     "看得见她整个人"去改主菜单的构图。

     例外只有一处：**「设置 → 立绘」那一页**。那一页就是在**调她**
     （亮度 / 饱和度 / 显不显示），而"调她"的前提是看得见她整个人。
     所以进那一页切成全身取景，退出来回基准。

     由谁决定：`boot.js` 的 `PAGE_MOODS.portrait.fullBody`（每页一个标志位，
     和表情/姿态在同一张表里），本文件只提供"换取景"这个能力。

     ## 为什么全身必须动 model.scale，不能靠姿态那一层的 CSS 缩放

     画布只有舞台盒那么大（16:9 铺满视口）。半身取景下她的下半身是画在
     画布**外面**的 —— 那部分根本没被渲染进去。所以用 CSS 把 canvas 缩小
     只会把上半身缩小，下半身依然不存在。**只有改模型自己的 scale
     （pixi 那一层）才能让她整个人进入画面。**

     ## 落点：算出来 + 量一次兜住

     pixi 的 Container 是绕 `model.position` 那个点缩放的，所以

         新框 = position + (旧框 - position) × 缩放比

     这是几何推导，用来算**动画的终点**（动画过程中量到的只是中间态，
     没法拿来当目标）。而"绕哪个点缩"这件事本身没实测过 ——
     所以动画停下来之后再**实量一次**、把残差补掉（settleFraming）。
     最终落点是量出来的，不是算出来的。

     单位：fill / bottomGap / rightGap 都是**画布**的比例（不是视口）。
     目标环境里两者相等；窗口比例一变就不等了 —— 舞台盒是
     "视口高 × 16:9"、右对齐，可能比视口宽，所以按画布算才对。
     ============================================================ */
  var FRAMING = {
    ms: 520,            // 切换取景的时长（和 Animus 推门那 0.5s 同一个节奏）
    fullBodyFill: 0.94, // 全身：她（或模型框）占画布高度的比例
    /* 脚离下缘 / 右缘留多少（画布宽高的比例）。
       **bottomGap 可以是负数** —— 把她的框再往下推一点。
       什么时候要这么干：如果量到的框下缘不是她的脚（画布底部有留白），
       她会看起来"悬在半空"，填 -0.04 之类就能把她踩到底。
       （判据看控制台那行日志里的实测框和她的头脚对不对得上。） */
    bottomGap: 0.004,
    rightGap: 0.015
  };

  /* 库按 TUNING 摆好的那一套（进场就是它）。懒记：第一次用它的时候才存。
     回基准、以及把结果换算回 TUNING 都用它。 */
  var framingBase = null;

  /* 现在的取景意图 / 是否已经就位过。**重复切同一个状态是空操作**：
     调用方每次重算"她该是什么样"都会调到这里，不判重的话鼠标动一下
     就会重跑一次动画。 */
  var framingWanted = false;
  var framingReady = false;
  var framingFill = null;
  var framingLogged = false;
  var framingAnim = null;    // 正在跑的插值
  var framingTimer = null;   // resize 去抖
  var framingRetry = null;   // "模型还没就绪"时的重试

  /** 记下"库按 TUNING 摆好的那一套"（只记一次）。回基准和换算都要用它。 */
  function rememberBase(model) {
    if (framingBase === null && model.scale && model.position) {
      framingBase = {
        scale: model.scale.x,
        x: model.position.x,
        y: model.position.y
      };
    }

    return framingBase;
  }

  /** 目标框 = **画布**的 CSS 尺寸；拿不到画布就退回视口（见上面那段注释）。 */
  function framingBox() {
    var canvas = document.getElementById('oml2d-canvas');

    return {
      w: canvas && canvas.clientWidth ? canvas.clientWidth : window.innerWidth,
      h: canvas && canvas.clientHeight ? canvas.clientHeight : window.innerHeight
    };
  }

  /**
   * 算目标取景，**不动模型**。拿不到模型/尺寸时返回 null（还没就绪）。
   *
   *   fullBody=true  → 全身：占画布高度的 FRAMING.fullBodyFill，下缘/右缘贴边
   *   fullBody=false → 基准：库按 TUNING 摆好的那一套（主菜单的构图）
   */
  function framingTarget(fullBody, fill) {
    var model = currentModel();

    if (!model || !model.scale || !model.position || typeof model.getBounds !== 'function') {
      return null;
    }

    var base = rememberBase(model);

    if (!base) {
      return null;
    }

    if (!fullBody) {
      return { scale: base.scale, x: base.x, y: base.y };
    }

    var box = framingBox();
    var cur = model.getBounds();

    if (!cur || !(cur.width > 0) || !(cur.height > 0)) {
      return null;
    }

    var want = Math.min(Math.max(fill || FRAMING.fullBodyFill, 0.2), 1.2) * box.h;
    var r = want / cur.height;
    var scale = model.scale.x * r;

    /* 缩放后的框：绕 model.position 那个点缩。
       这是几何推导，用来算动画终点；"绕哪个点"这个假设由
       settleFraming 的实量兜住（见上面那段注释）。 */
    var right = model.position.x + (cur.right - model.position.x) * r;
    var bottom = model.position.y + (cur.bottom - model.position.y) * r;

    return {
      scale: scale,
      x: model.position.x + (box.w - box.w * FRAMING.rightGap) - right,
      y: model.position.y + (box.h - box.h * FRAMING.bottomGap) - bottom
    };
  }

  /**
   * 动画停下之后**再量一次**，把残差补掉。
   *
   * 只有"全身"这一档需要补：基准那一档是**原样还原**库摆好的值，
   * 再对齐一次反而会把主菜单的构图改掉（那是不允许的 —— 主菜单不动）。
   */
  function settleFraming() {
    var model = currentModel();

    if (!model || !framingWanted || typeof model.getBounds !== 'function') {
      return;
    }

    var box = framingBox();
    var cur = model.getBounds();

    if (!cur || !(cur.width > 0) || !(cur.height > 0)) {
      return;
    }

    model.position.x += (box.w - box.w * FRAMING.rightGap) - cur.right;
    model.position.y += (box.h - box.h * FRAMING.bottomGap) - cur.bottom;

    if (!framingLogged) {
      framingLogged = true;
      logFraming(model);
    }
  }

  /** 把实测结果打出来：取了哪一档、实测框落在哪、偏大偏小怎么调。
      **只打一次**（这些数每次进来都一样，每次进立绘页都刷屏没意义）。 */
  function logFraming(model) {
    var box = framingBox();
    var cur = model.getBounds();

    if (!cur || !framingBase) {
      return;
    }

    console.log(
      '[VN:live2d] 全身取景（设置 → 立绘 那一页）：scale ' + framingBase.scale.toFixed(3) +
      ' → ' + model.scale.x.toFixed(3) +
      '，position [' + Math.round(framingBase.x) + ', ' + Math.round(framingBase.y) + '] → [' +
        Math.round(model.position.x) + ', ' + Math.round(model.position.y) + ']\n' +
      '  实测框 ' + Math.round(cur.width) + '×' + Math.round(cur.height) +
      '：左 ' + Math.round(cur.x) + ' / 上 ' + Math.round(cur.y) +
      ' / 右 ' + Math.round(cur.right) + ' / 下 ' + Math.round(cur.bottom) +
      '（画布 ' + Math.round(box.w) + '×' + Math.round(box.h) +
      '，视口 ' + window.innerWidth + '×' + window.innerHeight + '）\n' +
      '  她偏大/偏小：VN.character.setFraming(true, 1.05) / (true, 0.88) 换个数再调'
    );
  }

  /** 把模型挪到 target（animate=false 直接就位）。 */
  function applyFraming(target, animate) {
    var model = currentModel();

    if (!model || !target) {
      return false;
    }

    if (!animate) {
      model.scale.set(target.scale, target.scale);
      model.position.set(target.x, target.y);
      framingAnim = null;
      settleFraming();
      return true;
    }

    framingAnim = {
      fromScale: model.scale.x,
      toScale: target.scale,
      fromX: model.position.x,
      toX: target.x,
      fromY: model.position.y,
      toY: target.y,
      at: window.performance.now()
    };

    window.requestAnimationFrame(tickFraming);
    return true;
  }

  /**
   * 取景的插值循环。
   *
   * **为什么要动画**：半身 → 全身是**两倍**的大小差，硬切会像画面被撕了
   * 一下。520ms 和 Animus 推门那 0.5s、姿态那 0.55s 是同一个节奏，
   * 三件事一起动才读得出"她跟着这一页变了"。
   *
   * 缓动用的是 easeInOutCubic（和 Animus 相机那条一样）。
   */
  function tickFraming(now) {
    var a = framingAnim;
    var model = currentModel();

    if (!a) {
      return;
    }

    if (!model) {
      framingAnim = null;
      return;
    }

    var t = Math.min((now - a.at) / Math.max(FRAMING.ms, 1), 1);
    var k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    var scale = a.fromScale + (a.toScale - a.fromScale) * k;

    model.scale.set(scale, scale);
    model.position.set(
      a.fromX + (a.toX - a.fromX) * k,
      a.fromY + (a.toY - a.fromY) * k);

    if (t < 1) {
      window.requestAnimationFrame(tickFraming);
      return;
    }

    framingAnim = null;
    settleFraming();
  }

  /**
   * 模型还没就绪时的重试：500ms 一次，最多 10 秒。
   *
   * 为什么要这个：调用方（boot.js）只在"她该是什么样"**变化**时才会调到
   * `setFraming`，它没有任何理由为一个"模型还没加载完"再调一遍。
   * 少了这段，"进立绘页时模型正好没就绪"就会永远停在半身。
   */
  function retryFraming(attempt) {
    /* 就位了、或者意图已经变回基准（玩家在模型加载完之前就退出了那一页）
       → 不用再重试。 */
    if (framingReady || !framingWanted) {
      return;
    }

    var target = framingTarget(framingWanted, framingFill);

    if (target) {
      framingReady = true;
      applyFraming(target, true);
      return;
    }

    var n = attempt || 0;
    if (n > 20) {
      console.warn('[VN:live2d] 取景没做成：10 秒内没拿到模型实例，先用当前这一档。');
      return;
    }

    framingRetry = window.setTimeout(function () { retryFraming(n + 1); }, 500);
  }

  /**
   * 切换取景 —— 这是对外的唯一入口。
   *
   *   setFraming(true, 1.05)   全身（数字是占画布高度的比例）
   *   setFraming(false)        回基准（主菜单那套半身）
   *
   * **同一个状态重复切 = 空操作**（调用方每次重算都会调到这里，
   * 不判重的话鼠标动一下就会重跑一次动画）。
   */
  function setFraming(fullBody, fill) {
    var want = !!fullBody;

    if (framingReady && want === framingWanted) {
      return true;
    }

    var target = framingTarget(want, fill);

    if (!target) {
      /* 模型还没就绪。基准那一档不用重试（模型本来就在基准上）；
         全身那一档把意图记下来、自己重试 —— 见 retryFraming。 */
      framingWanted = want;
      framingFill = fill || FRAMING.fullBodyFill;
      framingReady = false;

      window.clearTimeout(framingRetry);

      if (want) {
        retryFraming(0);
      }

      return false;
    }

    window.clearTimeout(framingRetry);

    framingWanted = want;
    framingReady = true;
    framingFill = fill || FRAMING.fullBodyFill;

    return applyFraming(target, true);
  }

  /* 窗口一变，库会按 TUNING 重新摆一次模型（它自己的 resize 处理），
     我们当前的取景就被覆盖了 —— 跟着重做一次，直接就位（resize 本来就是突变）。
     延后 250ms 是为了等库先跑完。
     不用重置 framingBase：那套基准值不随窗口变，而且库"有没有真的重摆"
     不确定 —— 重算目标时是从**当前**状态算的，两种情况都对。
     监听器在 IIFE 里只注册一次（这个文件只会被求值一遍）。 */
  window.addEventListener('resize', function () {
    window.clearTimeout(framingTimer);

    framingTimer = window.setTimeout(function () {
      if (!framingReady) { return; }

      applyFraming(framingTarget(framingWanted, framingFill), false);
    }, 250);
  });

  /* ============================================================
     姿态（位置 / 大小 / 倾斜）—— 子页切换时用
     ------------------------------------------------------------
     TUNING 里那三个值是**基准**（进场就用的那套），这里这一层是
     **在基准之上叠的临时偏移**：进「设置」的某个子页时她换个站法，
     退出来回基准。基准不动，所以调姿态不会影响主菜单本来的样子。

     ## 为什么只改 :root 上的 CSS 变量，不碰元素

     和亮度 / 饱和度同一套路（见 animus/settings-module.js 那段注释）：
     canvas 是库自己插进来的，它在 resize / 换模型时会重写 element.style，
     写上去的东西会被抹掉。改成"JS 只改变量、生效的是 menu.css 里那条规则"，
     库就碰不到它了。

     ## 为什么变量用在 #oml2d-canvas 上，不是 #oml2d-stage 上

     stage 的 transform **归库所有**：bundle 里
     `@keyframes oml2d-stage-slide-in/out` 动的就是 stage 的 transform
     （滑入滑出）。我们把 transform 写在 stage 上会和那两条动画互相覆盖；
     写在 canvas 上是**叠加**关系 —— 库动 stage，我们动 canvas，各管一层。

     ## 单位

       dx / dy     视口像素（和 TUNING.position 同一套语义，正 x 往右、正 y 往下）
       scale       倍数，1 = TUNING.scale 那个大小（不是绝对缩放，是"再乘一下"）
       rotate      倾斜角，度。**正 = 顺时针**（以她脚下那条竖轴为心，头往右倒）。
                   只用来做"倾听 / 让开"这类身体语言，绝对值别超过 2 度 ——
                   多了就不像倾斜，像没对齐。
       keepVisible 留下的**可见宽度**比例（0~1）。**有它就忽略 dx。**
                   ⚠ 是"可见宽度"，**不是"露多少脸"** —— 脸在可见区靠右一侧，
                   所以 0.5 会把她的脸**整个切掉**。显示页要的是"露半张脸"，
                   那个值是 0.67（推导见 boot.js 的 PAGE_MOODS.display）。
       exit        退场：`true` = 从**画面下缘**走出去（整块往下推一个画布高）。
                   **它会覆盖 dy**（其余三项照旧生效，所以"边走边缩小"也能写）。

     ## exit：为什么是"往下走"而不是"往右切掉"

     "退场"有两种做法，选的是更贴合词义的那种：
       - `keepVisible: 0` → 往右切，看起来是**被画面裁掉**（人还"在"，只是没了）；
       - `exit: true` → 往下走，看起来是**她退场了**（有离开这个动作）。

     位移量取的是**画布高度**（`framingBox().h`），不是某个像素常数 ——
     换窗口尺寸不用跟着改。方向上：pixi/CSS 都是 y 往下为正，
     所以往下推一整个画布高就完全出了画面。

     ## keepVisible：为什么不是直接填像素

     "往右挪到只露半张脸"是**比例**意图，而换成像素需要先知道她此刻有多宽。
     那个宽度只能量（见上面 TUNING 那段：这个参数的语义和直觉不一致）。
     所以这里按实测算：取她当前的包围盒，算出**现在露在外面多宽**，
     再把其中的 (1 - keepVisible) 推出去。

     三个附带说明：
       - 它按**当前取景**量。显示页是半身档，所以量的是半身下的宽度。
       - 模型没就绪时算不出来（返回 null），这一帧就不挪 —— 下一次
         "她该是什么样"重算时会再试（悬停任意一行都会触发）。
       - **别再叠 scale / rotate**：那两个会改她的可见宽度，
         那个比例就不再是"屏幕右缘切在脸中间"这个意思了。要倾斜就把它让开。

     传 null / 不全的对象 = 那一项回基准（0, 0, 1, 0）。**全是基准时这条规则
     对画面的影响恰好为零**，所以"没在用姿态"和"没写这个功能"看起来一样。
     ============================================================ */
  /**
   * 只有"真的是个数"才认，否则用兜底值。
   *
   * ⚠ **不能写成裸 `isFinite(v)`**：`isFinite(null)` 是 `true`
   * （`null` 会被转成 0），`undefined`/空字符串同理。
   * 这一条踩过一次，代价是三个页面同时坏掉：
   * `boot.js` 给"没写这个字段"的页面返回的是 `null`，
   * 于是 `keepVisible` 被当成 `0`（= 一点都不留），她整个被推出屏幕外 ——
   * 显示页有值所以看着正常，**声音 / 文字 / 立绘** 三页一起"人不见了"。
   *
   * 项目里别处（app.js / animus.js / settings-module.js）都是
   * `typeof v === 'number' && isFinite(v)` 两道闸，这里照抄那个写法。
   */
  function numberOr(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function setPose(pose) {
    var root = document.documentElement;
    var dx = numberOr(pose && pose.dx, 0);
    var dy = numberOr(pose && pose.dy, 0);
    var scale = numberOr(pose && pose.scale, 1);
    var rotate = numberOr(pose && pose.rotate, 0);
    var keep = numberOr(pose && pose.keepVisible, null);

    if (!(scale > 0)) {
      scale = 1;
    }

    /* keepVisible 说了算的时候**忽略 dx** —— 两个一起写的话，
       "谁才是准的"说不清，而且量出来的那个显然更准。
       量不出来（模型还没就绪）时保留 dx，不把它覆盖成 0。 */
    if (keep !== null) {
      var shift = keepVisibleShift(keep);

      if (shift !== null) {
        dx = shift;
      }
    }

    /* 退场：整块往下走一整个画布高 —— 完全离开画面。
       走的距离由画布尺寸算出来，所以不是"某个像素常数"。
       它会覆盖 dy（上下不能同时既退场又留在原高度）；
       dx / scale / rotate 照旧生效，想"边走边缩小"就一起写。 */
    if (pose && pose.exit) {
      dy = framingBox().h;
    }

    root.style.setProperty('--vn-portrait-dx', dx + 'px');
    root.style.setProperty('--vn-portrait-dy', dy + 'px');
    root.style.setProperty('--vn-portrait-scale', String(scale));
    root.style.setProperty('--vn-portrait-rotate', rotate + 'deg');
  }

  /**
   * "只露出 keep（0~1）"换算成横移像素（正数 = 往右推）。
   *
   * 现在露在外面多宽 = 她（模型框）的左缘 → 「框的右缘」和「画布右缘」里更靠左的那个。
   * 要把剩下的部分再推出去 (1 - keep) 那么多。
   *
   * 拿不到模型/尺寸时返回 **null**（而不是 0）—— 调用方要能区分
   * "量不出来"和"量出来是 0"，前者不该把 dx 覆盖成 0。
   */
  function keepVisibleShift(keep) {
    var model = currentModel();
    var box = framingBox();

    if (!model || typeof model.getBounds !== 'function' || !(box.w > 0)) {
      return null;
    }

    var cur = model.getBounds();

    if (!cur || !(cur.width > 0)) {
      return null;
    }

    var visible = Math.min(cur.right, box.w) - cur.x;

    if (!(visible > 0)) {
      return null;
    }

    var k = Math.min(Math.max(keep, 0), 1);

    return visible * (1 - k);
  }

  /* ============================================================
     库的加载：优先本地，缺了才用 CDN 顶
     ------------------------------------------------------------
     发布版**必须**走本地文件（见 vendor/README.md）。CDN 只是让开发时
     不必先手工下一个文件就能看效果，而且它会一直显示一条警告条 ——
     不允许它悄悄变成正式路径。
     版本锁死不用 @latest：上游改版不该悄悄改掉这个菜单的样子。
     ============================================================ */
  var CDN_URL = 'https://unpkg.com/oh-my-live2d@0.19.3/dist/index.min.js';

  var dom = {};
  var initialized = false;
  var warningShown = '';
  var lastError = null;

  /* loadOml2d() 的**返回值**才是那个实例，模型/舞台/表情接口都在它上面。
     全局 OML2D 上只有 loadOml2d 和 _em_module（Cubism core 的 wasm 模块）——
     实测打印 Object.keys(window.OML2D) 得到的就是这两个名字。
     之前直接调 window.OML2D.getModel() 所以永远拿到空。 */
  var instance = null;

  /** 表情接口的失败诊断只打一次，否则鼠标一动就刷屏。 */
  var expressionWarned = false;

  /* 上一次**真的设下去**的表情（null = 默认）。同名不重复设，
     见 setExpression 里那一段注释（拖滑杆会一格一次地重算）。 */
  var appliedExpression = null;

  function warn(message) {
    if (!dom.warning || warningShown === message) {
      return;
    }

    warningShown = message;
    dom.warning.textContent = message;
    dom.warning.classList.remove('hidden');
    console.warn('[VN:live2d] ' + message);
  }

  function hideWarning() {
    warningShown = '';
    if (dom.warning) {
      dom.warning.classList.add('hidden');
    }
  }

  function loadLibraryFromCdn(onDone) {
    var script = document.createElement('script');
    script.src = CDN_URL;

    script.onload = function () {
      onDone(typeof window.OML2D === 'undefined'
        ? new Error('CDN 脚本加载完了但 OML2D 仍未定义')
        : null);
    };

    script.onerror = function () {
      onDone(new Error('CDN 加载失败'));
    };

    document.head.appendChild(script);
  }

  /**
   * 清掉上次会话存下来的立绘状态。
   *
   * 库里有这么一行：`const t = i2() || this.options.initialStatus` ——
   * 也就是**存下来的状态优先于配置**。所以光把 initialStatus 改成 active 还不够：
   * 上一次运行如果存了 "sleep"，这次启动仍然会读回 sleep，她还是不进来。
   * 键名我不确定，所以按名字扫一遍把 oml2d/live2d 相关的都清掉 —— 这个库
   * 在这台机器上只服务于这一个页面，清干净没有副作用。
   */
  function clearStaleStatus() {
    try {
      var doomed = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && /oml2d|live2d/i.test(key)) {
          doomed.push(key);
        }
      }

      for (var j = 0; j < doomed.length; j++) {
        window.localStorage.removeItem(doomed[j]);
      }

      if (doomed.length) {
        console.log('[VN:live2d] 已清掉上次会话保存的状态：' + doomed.join(', '));
      }
    } catch (error) {
      // localStorage 不可用（隐私模式之类）就算了，不影响加载
    }
  }

  /** 真正初始化 OML2D。local 表示库来自本地文件（只有那种情况才隐藏警告）。 */
  function start(local) {
    if (window.location.protocol === 'file:') {
      // fetch 会被拒，模型必定读不到。先说清原因，免得以为是配置写错了。
      warn(
        '当前是 file:// 打开的，浏览器会拒绝读取模型文件（.moc3 必须走 fetch）。\n' +
        '立绘只有在 Unity 里跑 MainMenu 场景时才会出现（由 WebUiServer 走 http://localhost）。'
      );
      return false;
    }

    if (local) {
      hideWarning();
    }

    try {
      clearStaleStatus();
      instance = window.OML2D.loadOml2d(buildOptions());
      initialized = true;

      /* 取景状态复位：库刚刚按 TUNING 摆过一次，所以"基准"要重新记
         （reload() 会走到这里）。**注意这里不主动做全身取景** ——
         主菜单要的就是半身，全身只由「设置 → 立绘」那一页触发。 */
      framingBase = null;
      framingWanted = false;
      framingReady = false;
      framingLogged = false;
      framingAnim = null;

      /* 表情也要重新认：模型换了一个，库那边的表情状态归零了，
         留着旧值会让"设同一个表情"被误判成"不用设"。 */
      appliedExpression = null;

      console.log(
        '[VN:live2d] 已请求加载立绘：' + modelPath() + '（库来源：' + (local ? '本地' : 'CDN') + '）' +
        ' 视口=' + window.innerWidth + 'x' + window.innerHeight +
        ' 立绘盒子=' + Math.round(window.innerHeight * TUNING.heightRatio * STAGE_ASPECT) +
        'x' + Math.round(window.innerHeight * TUNING.heightRatio)
      );

      // 头顶光圈的循环。等模型就绪后再起，所以延迟一点。
      window.setTimeout(startGlow, 800);
      return true;
    } catch (error) {
      lastError = error;
      warn('立绘初始化失败：' + (error && error.message ? error.message : String(error)));
      return false;
    }
  }

  function init() {
    dom.warning = document.getElementById('character-warning');

    if (window.location.protocol === 'file:') {
      return start(false);
    }

    if (typeof window.OML2D !== 'undefined') {
      return start(true);
    }

    // 本地文件不在 —— 先显示警告（它会一直留着），再用 CDN 把立绘拉起来。
    warn(
      '本地没有 WebUI/vendor/oh-my-live2d.min.js，暂时从 CDN 加载。\n' +
      '这只用于开发预览：发布前请把它落到本地（WebUI/vendor/README.md）。'
    );

    loadLibraryFromCdn(function (error) {
      if (error) {
        lastError = error;
        warn(
          '立绘库没加载：本地没有 vendor 文件，CDN 也失败了（' + error.message + '）。\n' +
          '下载方式见 WebUI/vendor/README.md。'
        );
        return;
      }

      start(false);
    });

    return true;
  }

  /** 模型地址。由 WebUiServer 把 Assets/Live2D/宅久运行文件/ 挂在 /models/ 下。 */
  function modelPath() {
    return '/models/2-3.model3.json';
  }

  function buildOptions() {
    // 直接用 TUNING 里的绝对像素值。
    // 舞台尺寸固定（信箱化让 CEF 视口恒为 1920x1080），所以不需要按视口比例换算。
    var viewportHeight = window.innerHeight;
    var stageWidth = viewportHeight * TUNING.heightRatio * STAGE_ASPECT;
    var stageHeight = viewportHeight * TUNING.heightRatio;
    var scale = TUNING.scale;
    var position = TUNING.position;

    return {
      /* initialStatus 必须是 active，不能抄 PersonalPage 的 "sleep"
         ------------------------------------------------------------
         库里的逻辑（从 bundle 读出来的）：

           loadModel().then(() => {
             t === "sleep"
               ? (statusBar.open(restMessage),            // 显示"看板娘休息中"
                  statusBar.setClickEvent(→ stage.slideIn()))  // 点它才滑进来
               : this.stage.slideIn();                     // 只有非 sleep 才滑入
           })

         sleep 状态下她**停在屏幕外**（stage 的 out 位置是 translateY(130%)），
         要靠点状态栏才进来。而我们在下面把 statusBar 关掉了 ——
         于是"她一直在休息、而唤醒她的按钮不存在"，屏幕右侧永远是空的。
         这就是第一版没加载出来的原因。 */
      initialStatus: 'active',

      // 停靠右侧 —— 和左列菜单形成"左选项 / 右立绘"的版式
      dockedPosition: 'right',

      transitionTime: 700,

      /* ============================================================
         关掉"看板娘挂件"那一整套 UI
         ------------------------------------------------------------
         下面的选项名和默认值不是猜的 —— 是从 bundle 里的默认配置对象
         （那个含 sayHello / dockedPosition / models 的对象）逐个读出来的。
         默认值全都是"开"，所以必须显式关掉：

           menus.disable            右侧工具栏（休息 / 换衣服 / 换模型 / 关于）
           statusBar.disable        底部状态栏
           sayHello                 打招呼气泡
           tips.welcomeTips.message 8 条默认问候语
           tips.copyTips.message    "你复制了什么内容呢?" 气泡

         两个**故意不碰**的：
           tips.idleTips.wordTheDay  默认就是 false。它就是"每日一言"，
                                     打开会去请求 https://v1.hitokoto.cn ——
                                     游戏里不该有这种外部请求，保持关闭。
           libraryUrls               默认是三个空串，空串 = 用 bundle 内联的 core。
                                     填了才会去外部取，所以保持空。
         ============================================================ */
      sayHello: false,
      statusBar: { disable: true },
      menus: { disable: true },
      tips: {
        idleTips: { wordTheDay: false, message: [] },
        /* welcomeTips.message **不能传空对象** ——
           它的合并是深合并，{} 合进默认值等于"一条都没覆盖"，8 条默认问候语照旧。
           （第一版就是这么错的，气泡显示的是默认的"这么晚还不睡吗？当心熬夜秃头哦！"）
           所以要把 8 个时段键逐个显式置空。 */
        welcomeTips: {
          message: {
            daybreak: '', morning: '', noon: '', afternoon: '',
            dusk: '', night: '', lateNight: '', weeHours: ''
          }
        },
        copyTips: { message: [] }
      },

      models: [
        {
          name: '宅久',
          path: modelPath(),
          // 全部用上面按视口比例算出来的值，不要再用绝对像素 ——
          // 直接用 TUNING 里的绝对像素值（舞台尺寸固定，不需要按视口比例换算）。
          position: position,
          scale: scale,
          mobileScale: scale * 0.75,
          stageStyle: {
            // 宽高比锁定 16:9 —— 宽度由高度推出来，不跟随窗口变化。
            // 这是"立绘永不变形"的实现，理由见上面 STAGE_ASPECT 的注释。
            height: Math.round(stageHeight),
            width: Math.round(stageWidth)
          }
        }
      ]
    };
  }

  /* ============================================================
     头顶光圈的呼吸循环（发光循环）
     ------------------------------------------------------------
     为什么不用库的动作系统：`2-3.model3.json` 里**没有 Motions 段**，
     一个动作文件都没引用，所以运行时**装不上**那 4 个 motion3.json。
     而 `expressions/发光循环.exp3.json` 只是把 Param54 设成 0（Add）——
     等于什么都不做。所以"发光循环"这个名字在两处都拿不到效果。

     但这条循环本身极简单，来自 发光循环.motion3.json：
         Segments: [0, (0,0), (0.667,0), (2,1)]
     即 Param54 在前 1/3 周期保持 0，后 2/3 线性升到 1，然后归零重来。

     所以直接按同一条曲线驱动参数即可 —— 而且周期由我们定，
     "间隔长一点"就是一个数字，不用去改模型资产。

     改 periodSeconds 即可：越大，她头顶的光涨得越慢、间隔越长。
     ============================================================ */
  var GLOW = {
    paramId: 'Param54',
    periodSeconds: 6,     // 原来动作里是 2 秒；这里放慢到 6 秒
    flatFraction: 0.3333, // 前 1/3 保持 0（对应原曲线 0.667 / 2）
    enabled: true
  };

  /** 取 Cubism 的核心模型（设参数用）。 */
  function currentCoreModel() {
    var model = currentModel();
    if (!model) {
      return null;
    }

    try {
      return model.internalModel && model.internalModel.coreModel
        ? model.internalModel.coreModel
        : null;
    } catch (error) {
      return null;
    }
  }

  /** 按曲线把 Param54 推到当前应有的值。 */
  function tickGlow() {
    if (!GLOW.enabled || !initialized) {
      return;
    }

    var core = currentCoreModel();
    if (!core || typeof core.setParameterValueById !== 'function') {
      return;
    }

    var phase = (window.performance.now() / 1000) % GLOW.periodSeconds / GLOW.periodSeconds;
    var value = phase < GLOW.flatFraction
      ? 0
      : (phase - GLOW.flatFraction) / (1 - GLOW.flatFraction);

    try {
      core.setParameterValueById(GLOW.paramId, value);
    } catch (error) {
      // 参数名不存在就算了，不要刷屏
    }
  }

  /* 挂载状态。不用定时器 —— 定时器会被库自己的更新循环覆盖掉。 */
  var glowAttached = false;
  var glowRetry = null;

  /**
   * 把 tickGlow 挂到库的 beforeModelUpdate 事件上。
   *
   * ⚠ 时机是关键。库的 InternalModel.update() 顺序是：
   *     emit('afterMotionUpdate')
   *     saveParam()
   *     expressionManager.update()      ← 表情在这里写参数
   *     updateFocus() / 自然动作 / physics / pose
   *     emit('beforeModelUpdate')       ← 只有这之后写的值不会被覆盖
   *     coreModel.update()              ← 参数在这里被读走并生效
   *
   * 所以：
   *   - 用 setInterval 每 16ms 写 → 写进去就被覆盖，表现是"完全没效果"
   *   - 挂 afterMotionUpdate → 会被紧跟着的表情更新覆盖
   *   - 挂 beforeModelUpdate → 正确 ✓
   *
   * 模型实例要等加载完才有，所以挂不上就重试。
   */
  function attachGlow() {
    if (glowAttached || !GLOW.enabled) {
      return true;
    }

    var model = currentModel();
    var internalModel = model && model.internalModel;

    if (!internalModel || typeof internalModel.on !== 'function') {
      return false;
    }

    internalModel.on('beforeModelUpdate', tickGlow);
    glowAttached = true;

    console.log('[VN:live2d] 头顶光圈循环已挂到 beforeModelUpdate：' + GLOW.paramId +
      '，周期 ' + GLOW.periodSeconds + ' 秒');

    return true;
  }

  function startGlow(attempt) {
    if (glowAttached) {
      return;
    }

    if (attachGlow()) {
      return;
    }

    var n = attempt || 0;
    if (n > 40) {
      console.warn('[VN:live2d] 光圈循环挂载失败：10 秒内没拿到 internalModel。');
      return;
    }

    glowRetry = window.setTimeout(function () { startGlow(n + 1); }, 250);
  }

  /**
   *
   * 正确的路径是 **instance.models.model** —— 这是实测出来的，不是猜的：
   * 把 loadOml2d() 返回值的成员打出来得到
   *   globalStyle, stage, statusBar, tips, menus, models, pixiApp,
   *   _modelIndex, _modelClothesIndex, version, options, events
   * 其中 `models` 是模型包装类，它内部的 `model` 就是 Live2DModel
   *（bundle 里 setScale / setPosition / playMotion 操作的都是 this.model）。
   *
   * 注意全局 `OML2D` 上**只有** loadOml2d 和 _em_module，
   * 而 `getModel` 这个名字在实例上也不存在 —— 两处都试过、都拿不到。
   * 所以这里按实测结果写，并保留 getModel 作为后备（万一以后版本加回来）。
   */
  function currentModel() {
    if (!instance) {
      return null;
    }

    try {
      if (instance.models && instance.models.model) {
        return instance.models.model;
      }
    } catch (error) {
      // 继续试后备路径
    }

    try {
      if (typeof instance.getModel === 'function') {
        return instance.getModel();
      }
    } catch (error) {
      // 都没有就返回 null，由调用方打诊断
    }

    return null;
  }

  /**
   * 恢复**默认**表情（不挂任何 expression）。成功返回 true。
   *
   * 为什么单独一条路：`setExpression(undefined)` 不报错、但什么都不做 ——
   * 库那边按名字/索引找不到定义就直接返回 false（见 setExpression 里那段）。
   * 这一条踩过：划过「退出游戏」（空虚眼）之后把鼠标移开时，
   * "清掉表情"那句是空转，她还挂着空虚眼。
   *
   * `ExpressionManager.resetExpression()` 才是对的（bundle 里确实有这个方法）。
   * 拿不到它时返回 false，由调用方决定怎么退。
   */
  function resetExpression(model) {
    try {
      var motionManager = model.internalModel && model.internalModel.motionManager;
      var manager = motionManager && motionManager.expressionManager;

      if (manager && typeof manager.resetExpression === 'function') {
        manager.resetExpression();
        console.log('[VN:live2d] 表情 → （默认）（走 expressionManager.resetExpression）');
        return true;
      }
    } catch (error) {
      console.warn('[VN:live2d] expressionManager.resetExpression() 抛错：', error);
    }

    return false;
  }

  /**
   * 切换表情。name 传空 / null = **恢复默认**（走 resetExpression，见上）。
   *
   * 两条路径都试，因为 om-my-live2d 没有把表情接口写进它自己的 API 列表：
   *   1. pixi-live2d-display 的便捷方法 model.expression(name)
   *   2. 退化路径：直接摸到内部的 ExpressionManager.setExpression(name)
   * 两条都不行就返回 false 并打一次日志 —— 不静默失败，否则排查起来
   * 会以为是"悬停没触发"，而实际是接口名不对。
   *
   * 模型里的表情名（来自 2-3.model3.json）：
   *   发光循环 / 困困眼 / 死鱼眼 / 空虚眼
   */
  function setExpression(name) {
    var want = name || null;

    if (!initialized) {
      if (!expressionWarned) {
        expressionWarned = true;
        console.warn('[VN:live2d] 换表情被调用，但立绘还没初始化完成（initialized=false）。');
      }
      return false;
    }

    var model = currentModel();

    if (!model) {
      if (!expressionWarned) {
        expressionWarned = true;

        // 仍然拿不到就继续把成员名打出来，不要回退到猜。
        var omlKeys = [];
        var instKeys = [];
        try {
          omlKeys = Object.keys(window.OML2D);
          instKeys = instance ? Object.keys(instance) : ['（instance 为空）'];
        } catch (error) {
          omlKeys = ['（读不到）'];
        }

        console.warn(
          '[VN:live2d] instance.getModel() 返回空，拿不到模型实例。\n' +
          'OML2D 上的成员：' + omlKeys.join(', ') + '\n' +
          'loadOml2d() 返回值上的成员：' + instKeys.join(', ')
        );
      }

      return false;
    }

    /* 同一个表情不重复设。**必须放在"已经拿到模型"之后** ——
       放在最前面的话，模型没就绪时那次调用会被记成"已应用"，
       等模型真的加载好就再也不会设了（表现是"她一直是默认表情"）。

       为什么必须去重：拖滑杆时每一格刻度都会重算一次她该是什么样
       （见 boot.js 的 VALUE_MOODS → byValue），不去重的话控制台会被刷屏，
       而且库每收到一次都会重头淡入一遍 —— 看着一直在抖。 */
    if (want === appliedExpression) {
      return true;
    }

    /* ============================================================
       "恢复默认表情"走的是**另一条路** —— 这一条踩过，记在这儿
       ------------------------------------------------------------
       `model.expression(undefined)` **不报错、但什么都不做**：
       库那边按名字/索引找不到对应的表情定义就直接返回 false。
       症状：划过「退出游戏」（空虚眼）之后把鼠标移开时，
       "清掉表情"这一句是空转，她**还挂着空虚眼**。
       更糟的是我们把它记成了"已应用"，之后连重试都不会有。

       正确做法是 `ExpressionManager.resetExpression()`（bundle 里有）。
       ============================================================ */
    if (want === null) {
      if (resetExpression(model)) {
        appliedExpression = null;
        return true;
      }

      /* 退路：老写法。**它在实测里不会清掉表情**，所以特意打一条警告 ——
         这是"恢复默认失效"唯一的线索（不然只能看到她从上一页带着表情回来）。 */
      if (typeof model.expression === 'function') {
        try {
          model.expression(undefined);
          appliedExpression = null;
          console.warn(
            '[VN:live2d] 恢复默认表情走了退路（model.expression(undefined)）。\n' +
            '这个写法在实测里**不会清掉表情**，所以她可能还挂着上一个（比如划过某一格之后没清掉的那张脸）。\n' +
            '原因通常是库版本里 ExpressionManager.resetExpression 不存在。'
          );
          return true;
        } catch (error) {
          console.warn('[VN:live2d] model.expression(undefined) 抛错：', error);
        }
      }

      return false;
    }

    if (typeof model.expression === 'function') {
      try {
        model.expression(want);
        appliedExpression = want;
        console.log('[VN:live2d] 表情 → ' + want + '（走 model.expression）');
        return true;
      } catch (error) {
        console.warn('[VN:live2d] model.expression() 抛错：', error);
      }
    }

    try {
      var motionManager = model.internalModel && model.internalModel.motionManager;
      var manager = motionManager && motionManager.expressionManager;
      if (manager && typeof manager.setExpression === 'function') {
        manager.setExpression(want);
        appliedExpression = want;
        console.log('[VN:live2d] 表情 → ' + want + '（走 expressionManager）');
        return true;
      }
    } catch (error) {
      console.warn('[VN:live2d] expressionManager.setExpression() 抛错：', error);
    }

    // 两条路都不通 —— 把 model 上真实存在的成员打出来，别让人猜。
    // 只打一次，避免鼠标一动就刷屏。
    if (!expressionWarned) {
      expressionWarned = true;
      var keys = [];
      try {
        keys = Object.keys(model);
      } catch (error) {
        keys = [];
      }

      console.warn(
        '[VN:live2d] 没找到表情接口（model.expression 和 expressionManager 都不存在）。\n' +
        'model 上的成员：' + keys.join(', ') +
        '\ninternalModel 上：' + (model.internalModel ? Object.keys(model.internalModel).join(', ') : '（无）')
      );
    }

    return false;
  }

  /** OML2D 的模型实例。API 名字我还没核对过，所以先原样交出去，别在这里猜。 */
  function model() {
    if (!initialized) {
      return null;
    }

    return currentModel();
  }

  function isReady() {
    return initialized;
  }

  return {
    init: init,
    isReady: isReady,
    model: model,
    setExpression: setExpression,
    /* 姿态（位置 / 大小 / 倾斜）。传 null = 回基准。
       调参时在控制台直接调：
         VN.character.setPose({ dx: -24, dy: -6, scale: 1.05, rotate: -1.6 }) */
    setPose: setPose,
    /* 取景（半身 / 全身）。主菜单不调它（默认就是半身）；
       只有「设置 → 立绘」那一页会调 setFraming(true) —— 见 boot.js。
         VN.character.setFraming(true, 1.05)   ← 全身，占画布高 105%
         VN.character.setFraming(true, 0.88)   ← 全身，小一点
         VN.character.setFraming(false)        ← 回主菜单那套半身 */
    setFraming: setFraming,
    framing: FRAMING,
    tuning: TUNING,
    error: function () { return lastError; },

    // 调试用：控制台里改完 TUNING 直接 VN.character.reload() 重来
    reload: function () {
      if (window.OML2D && window.OML2D.destroy) {
        try { window.OML2D.destroy(); } catch (error) { /* 没起来过就无所谓 */ }
      }
      initialized = false;
      return init();
    }
  };
})();
