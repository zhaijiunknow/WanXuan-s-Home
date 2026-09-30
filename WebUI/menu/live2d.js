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
         [700, 120] @0.30  当前：往左、往上一点 */
    position: [700, 120],

    /* 整体缩放。setScale(t, t) 是等比的，改它不会把人物拉变形。
       这是"半身"的主要旋钮：值越大，只有上半身在画面里。 */
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
   * 切换表情。name 传空 / null 表示恢复默认表情。
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

    if (typeof model.expression === 'function') {
      try {
        model.expression(name || undefined);
        console.log('[VN:live2d] 表情 → ' + (name || '（默认）') + '（走 model.expression）');
        return true;
      } catch (error) {
        console.warn('[VN:live2d] model.expression() 抛错：', error);
      }
    }

    try {
      var motionManager = model.internalModel && model.internalModel.motionManager;
      var manager = motionManager && motionManager.expressionManager;
      if (manager && typeof manager.setExpression === 'function') {
        manager.setExpression(name || undefined);
        console.log('[VN:live2d] 表情 → ' + (name || '（默认）') + '（走 expressionManager）');
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
