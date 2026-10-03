/* ============================================================
   皖萱的家 · VN 前端逻辑
   ------------------------------------------------------------
   核心设计：两种运行模式，同一份视图代码。

     standalone —— 浏览器里 JS 自己遍历剧本（用于视觉/节奏评审，无需 Unity）
     bridge     —— 接进 Unity 后，剧本遍历完全由 C# 的 StoryManager 负责，
                   JS 退化为"哑视图"：只渲染 + 回报玩家事件。

   这样做的好处：以后无论换成 Vuplex / UWB / 还是回退到原生 Unity UI，
   需要改的只有"谁遍历剧本"这一件事，UI 表现层不动。

   桥接协议（与 C# 侧约定，版本号必须一致）：
     C# → JS   story.load / marker.show / dialogue.show / choice.show
               / ending.show / ui.hide / ui.show
     JS → C#   ready / dialogue.advance / dialogue.typingComplete
               / choice.selected / ending.restart
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */

  // 设计基准 1920x1080。缩放由共用的 stage.js 负责（见 fitStage），
  // 这里保留常量只是为了让下面写布局相关代码时有个可读的参照。
  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 1080;

  // 协议版本号**不在这里**。它在共用的 bridge.js 里（VNBridge.version），
  // 主菜单界面用的是同一个 —— 版本号分成两份一定会漂移。

  // 文字速度 / 自动播放间隔的**合理区间**（毫秒）。
  //
  // 注意：换算成滑杆刻度（0..100）的逻辑**不在这里** —— 滑杆只存在于
  // Animus 的设置页（animus/settings-module.js），本页只消费毫秒这个物理量。
  // 这里保留区间只是为了钳制 C# 发来的值：万一存档被手改成 0，
  // 打字机会变成"瞬间出字"，钳一下至少还看得出是设置不对劲而不是游戏坏了。
  // 这几个数字必须和 animus/settings-module.js 里的同名常量一致。
  var SPEED_SLOW_MS = 120;
  var SPEED_FAST_MS = 8;
  var AUTO_MIN_MS = 200;
  var AUTO_MAX_MS = 3000;

  // 中文标点后额外停顿，让朗读节奏更像人说话而不是打字机
  var PUNCTUATION_PAUSE = {
    '。': 240, '！': 250, '？': 250, '…': 200,
    '—': 150, '，': 95, '、': 95, '：': 95, '；': 110,
    '“': 60, '”': 130, '\n': 280
  };

  // 剧本里的表情标注 → 策划案里的表情名。
  // 注意：这三个还**没有**映射到 2-3.moc3 实际的四个表情资源
  // （发光循环 / 困困眼 / 死鱼眼 / 空虚眼），映射表待定。
  var EXPRESSION_NAMES = { 'A': '圣洁', 'B': '灿烂', 'C': '委屈' };

  var THEMES = ['room', 'cocoa', 'cream'];
  var THEME_LABELS = {
    room: '木牌（场景衍生 · 默认）',
    cocoa: '暖棕（深色 · 磨砂玻璃）',
    cream: '奶油（浅色 · 磨砂玻璃）'
  };
  var BACKDROP_CLASSES = ['backdrop-day', 'backdrop-evening', 'backdrop-night'];
  var BACKGROUND_CLASS = { day: 'backdrop-day', evening: 'backdrop-evening', night: 'backdrop-night' };

  /* ============================================================
     右下角那行操作提示（`#hint`）
     ------------------------------------------------------------
     **它必须跟着当前状态走。** 原来它是一条写死在 index.html 里的
     「点击 / 空格 继续」，于是选项页和结局页上都在说同一句话 ——
     而那两个状态下"点击继续"是**做不到**的（advance() 见到选项层 /
     结局层就直接返回）。屏幕上写一件按不出的事，比不写更糟。

     三种状态三句话，见 setHint()。
     ============================================================ */
  var HINT_DIALOGUE = '点击 / 空格 继续';

  /* ============================================================
     交接那层光（主菜单 → 游戏的无缝切换，后半段）
     ------------------------------------------------------------
     `index.html` 里它是 `covered`（第一帧就亮着），所以从主菜单过来时，
     Unity 换场景 + 这一页的加载过程全被它盖住 —— 那正是硬切会露出来的地方。
     收掉的时机：
       - 第一句话显示出来（showDialogue）—— 正好的那一下
       - 或者 HANDOFF_FALLBACK_MS 兜底：C# 万一没推 dialogue.show
         （存档坏了 / 桥接断了），玩家不能一直盯着一整块光

     ⚠ 那层光的样子（色值、时长）在 theme.css，和主菜单页共用一份；
       主菜单那半段在 menu/boot.js 的 leaveToGame()。
     ============================================================ */
  var HANDOFF_FALLBACK_MS = 2500;
  var handoffDropped = false;

  function dropHandoffVeil() {
    if (handoffDropped || !dom.handoffVeil) {
      return;
    }

    handoffDropped = true;

    /* ⚠ 本页**没有被那层光盖住**的时候，不要播"界面落位"。
       为什么：`game-arrive` 是从 opacity 0 开始的，而对话框那时**已经画出来了** ——
       对一个已经可见的元素重播入场动画，看起来就是"闪一下"。
       进游戏的过场现在由 Unity 侧的 ChapterTransition 负责（色块退完才放行剧本），
       所以本页的 veil 一直是透明的（没有 .covered），这里就不该再动它。
       浏览器里预览、或者以后没有那层过场时，veil 会带 .covered，那时才播落位动画。 */
    var wasCovered = dom.handoffVeil.classList.contains('covered');
    dom.handoffVeil.classList.remove('covered');

    if (!wasCovered) {
      return;
    }

    /* 光在收的同时**让界面自己落位**（对话框从下往上落一点、控制条稍后淡入，
       规则在 style.css 的 `body.handoff-arriving`）。 */
    document.body.classList.add('handoff-arriving');

    window.setTimeout(function () {
      document.body.classList.remove('handoff-arriving');
    }, 1000);
  }

  /* ============================================================
     反方向：游戏 → 主菜单（同一层光的另一半）
     ------------------------------------------------------------
     和 menu/boot.js 的 leaveToGame() 是同一件事的反方向，理由也一样：
     换场景要时间 —— 主菜单场景里的 WebView 是全新对象，CEF 要重新启动、
     主菜单页要重新加载，中间那 1~3 秒屏幕上是空的。
     **先把光升起来，再发消息**；先发的话玩家看到的是"本页没了、房间还在原地"。

     Unity 侧还有一层同色的光（Assets/Scripts/UI/HandoffVeil.cs）会在换场景那一帧
     接住，一直亮到主菜单页发来 ready —— 所以这里只要把本页这层升起来，
     两层光的交接就看不出接缝。

     四个出口都走这里：暂停菜单那颗「回主菜单」、暂停菜单瓦片里的「回主菜单」、
     控制条上那颗、以及 M 键。

     ⚠ 300ms = 本页那层光升起来的时长（style.css 的 body.leaving-to-menu）。
        改这里要连着 style.css 一起改。
        退出游戏（menu.quit）**不走这里**：那是退出进程，不需要过场。
     ============================================================ */
  var LEAVING_TO_MENU_MS = 300;
  var leavingToMenu = false;

  function leaveToMenu() {
    /* 连按两下不该发两条消息 */
    if (leavingToMenu) {
      return;
    }

    /* 浏览器里预览时没有宿主，发了也没人接 —— 那就别演退场，
       否则页面会亮成一片然后停在那里（同 leaveToGame）。 */
    if (!VNBridge.hasHost()) {
      console.log('[VN] 没有宿主（浏览器预览），ui.menu 不发送、也不演退场。');
      return;
    }

    leavingToMenu = true;

    /* 暂停菜单先收掉：要盖住的是**游戏画面**，不是菜单自己。 */
    if (window.Animus && typeof Animus.close === 'function') {
      Animus.close();
    }

    /* **升光，不切黑。**
       和主菜单页的退场是同一套：先让当前主题的那片光铺满，再发消息 ——
       C# 就在这片光里换场景（Unity 侧的 MosaicReveal 铺的是同一片光），
       然后由主菜单场景补上动态（光一块块让开 → 马赛克 → 变清晰 → 出 UI）。
       规则在 style.css 的 body.leaving-to-menu，时长和下面这个数对齐。 */
    document.body.classList.add('leaving-to-menu');

    /* 光要真的升起来：`leaving-to-menu` 只管时长（style.css），
       让它不透明的是 `.covered`（theme.css 里那条）。两个都要。 */
    if (dom.handoffVeil) {
      dom.handoffVeil.classList.add('covered');
    }

    window.setTimeout(function () {
      send('ui.menu', {});
    }, LEAVING_TO_MENU_MS);
  }

  /* ---------------- DOM ---------------- */

  var dom = {};

  /* ---------------- 状态 ---------------- */

  var state = {
    mode: 'standalone',
    story: null,
    byId: {},
    indexById: {},
    total: 0,

    currentId: null,
    currentStep: null,

    fullText: '',
    typedLength: 0,
    typing: false,
    typeTimer: null,
    autoTimer: null,

    auto: false,
    fast: false,
    hidden: false,
    hud: false,
    theme: 'room',

    /* 右下角提示**当前该是哪一句**（见 HINT_DIALOGUE / setHint）。
       存下来是为了让 toast 能回到"这一档"的那句，而不是写死回"点击继续"。 */
    hint: HINT_DIALOGUE,
    toastTimer: null,

    /* 打开暂停菜单时"是不是菜单把自动播放停掉的"。
       有这个标记才能做到：玩家自己按 A 关掉的自动，不会因为开关一次菜单被打开。 */
    autoPausedByMenu: false,
    // 这两项默认关：在 MainRoom 里真实背景是 3D 房间，CSS 假背景与角色站位参考层
    // 都只是评审工具，不该在游戏里默认出现。浏览器里想看得按 B / G 手动打开。
    previewBackdrop: false,
    showGuides: false,
    fontLoaded: null,        // null=检测中 true/false=结果
    keyCount: 0,             // 收到的按键次数（诊断用，按 D 看 HUD）
    lastKey: '（无）',

    // 只读镜像：设置由 C# 持有（UiSettingsStore + PlayerPrefs），
    // 这里存的是 C# 通过 settings.apply 下发的副本，只影响打字机节奏和自动播放间隔。
    // 设置界面在**主菜单场景**里，本页不提供设置界面。
    //   textSpeed  每字毫秒
    //   autoDelay  自动播放的基础等待毫秒
    //   volume     0..1（本页不用，只是跟 C# 保持一致）
    //   fullscreen 同上
    settings: {
      textSpeed: 34,
      autoDelay: 900,
      volume: 1,
      fullscreen: false
    },

    background: 'day'
  };

  /* ============================================================
     初始化
     ============================================================ */

  function init() {
    cacheDom();
    bindEvents();
    bindPauseHandlers();
    fitStage();

    // 若宿主（Unity）已注入桥接对象，直接进入 bridge 模式。
    // VNBridge.hasHost() 只是**初步判断**，真正的判据是"收到过 C# 的消息"
    // （VNBridge.hostSpoken）—— 见下面 3 秒兜底那段。
    state.mode = VNBridge.hasHost() ? 'bridge' : 'standalone';

    applyTheme(state.theme);

    // 初值同步到控制条与元素可见性。
    // 两处都要做：控制条按钮的激活状态，以及元素本身的 hidden 类
    //（HTML 里已带 hidden 防闪烁，这里保证与状态一致）。
    setControlActive('backdrop', state.previewBackdrop);
    setControlActive('guides', state.showGuides);
    dom.backdrop.classList.toggle('hidden', !state.previewBackdrop);
    dom.characterSlot.classList.toggle('hidden', !state.showGuides);
    updateHud();
    detectFont();

    /* 「画好了」—— Unity 侧那层光（HandoffVeil.cs）等的就是这一条，收到才敢收光。
       进游戏时 CEF 要在这个场景里重新启动，那 1~3 秒屏幕上什么都没有。

       **要等两个 rAF 再发，不能直接发**：rAF 的回调跑在"这一帧即将被画出来"之前，
       所以在第一个 rAF 里发，画面其实还没上屏 —— 那边一收光就露出真实场景，
       紧接着本页画出来，又是一次闪白（实测过就是这个观感）。
       嵌两层就落到了**第一帧画完之后**，收光那一刻底下已经是这层同色的光了。 */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        send('ready', { mode: state.mode });
      });
    });

    /* 交接那层光的兜底：万一 C# 一直没推 dialogue.show（存档坏了、桥接断了），
       玩家不能一直盯着一整块光。正常路径在 showDialogue 里就收掉了。 */
    window.setTimeout(dropHandoffVeil, HANDOFF_FALLBACK_MS);

    // 主动问 C# 要当前设置（文字速度 / 自动播放间隔）。
    // 用"页面主动问"而不是"C# 主动推"：主动推必须踩准"网页还没加载完 /
    // 桥接还没连上"的时机，而网页自己知道自己什么时候准备好了。
    // 浏览器里没人接这条消息，state.settings 就保持 HTML 侧的默认值，不影响预览。
    send('settings.request', {});

    if (state.mode === 'standalone') {
      loadStory().then(function (story) {
        if (!story || !story.steps || !story.steps.length) {
          showToast('没有可用的剧本数据');
          return;
        }
        prepareStory(story);
        goTo(story.steps[0].id);
      });
    } else {
      // bridge 模式下等 C# 发 story.load；同时先尝试本地 story.js 供 HUD 显示进度
      loadStory().then(function (story) {
        if (story && story.steps && story.steps.length) {
          prepareStory(story, true);
        }
      });

      // 保险：如果在 3 秒内一条 C# 消息都没收到，说明这次并不是由 C# 驱动
      // （比如只是想单独看一眼界面效果），那就退回 standalone 自己播放样本，
      // 免得画面一片空白、看起来像坏了。
      window.setTimeout(function () {
        if (VNBridge.hostSpoken) {
          return;
        }

        console.log('[VN] 3 秒内没有收到 C# 消息，退回 standalone 模式，自行播放样本剧本。');
        state.mode = 'standalone';
        updateHud();

        loadStory().then(function (story) {
          if (!story || !story.steps || !story.steps.length) {
            return;
          }
          prepareStory(story);
          goTo(story.steps[0].id);
        });
      }, 3000);
    }
  }

  function cacheDom() {
    dom.stage = document.getElementById('stage');
    dom.backdrop = document.getElementById('backdrop');
    dom.characterSlot = document.getElementById('character-slot');
    dom.chapterBanner = document.getElementById('chapter-banner');
    dom.dialogueLayer = document.getElementById('dialogue-layer');
    dom.namePlate = document.getElementById('name-plate');
    dom.dialogueText = document.getElementById('dialogue-text');
    dom.advanceIndicator = document.getElementById('advance-indicator');
    dom.choiceLayer = document.getElementById('choice-layer');
    dom.endingLayer = document.getElementById('ending-layer');
    dom.endingTitle = document.getElementById('ending-title');
    dom.endingMessage = document.getElementById('ending-message');
    dom.endingRestart = document.getElementById('ending-restart');
    dom.hint = document.getElementById('hint');
    dom.controls = document.getElementById('controls');
    dom.hud = document.getElementById('dev-hud');
    dom.restoreMarker = document.getElementById('restore-marker');
    dom.handoffVeil = document.getElementById('handoff-veil');
  }

  /* ============================================================
     舞台缩放：1920x1080 等比铺满，多余的边留黑
     ============================================================ */

  function fitStage() {
    // 实现在共用的 stage.js —— 主菜单界面用的是同一个函数。
    // 两个界面的设计基准都是 1920x1080，缩放算法必须逐字一致。
    VNStage.fit(dom.stage);
  }

  /* ============================================================
     剧本数据
     ============================================================ */

  /** 动态加载一个 <script>。story.js 走这条路，因为 <script> 不受 file:// 的 CORS 限制。 */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var element = document.createElement('script');
      element.src = src;
      element.onload = function () { resolve(); };
      element.onerror = function () { reject(new Error('加载失败：' + src)); };
      document.head.appendChild(element);
    });
  }

  /** 从 story.js 读剧本。Unity 导出的内容是 window.VN_STORY = {...} */
  function loadStoryFromScript() {
    return loadScript('story.js').then(function () {
      var story = window.VN_STORY;
      if (story && story.steps && story.steps.length) {
        console.log('[VN] 已载入 story.js，共 ' + story.steps.length + ' 步');
        return story;
      }
      throw new Error('story.js 里没有有效 steps');
    });
  }

  /** 兼容 story.json（用本地 http 服务打开时可用）。 */
  function loadStoryFromFetch() {
    // file:// 下 fetch 必然被 CORS 拒绝（CEF 会把这段报错打进 Unity Console，
    // 内容是 "Access to fetch ... has been blocked by CORS policy"，看着吓人但无害）。
    // 既然注定失败，就不要发这个请求 —— 少一条误导性的红字。
    if (window.location.protocol === 'file:') {
      return Promise.reject(new Error('file:// 下跳过 fetch：必然被 CORS 拒绝'));
    }

    return fetch('story.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) { throw new Error('没有 story.json'); }
        return response.json();
      })
      .then(function (data) {
        if (data && data.steps && data.steps.length) {
          console.log('[VN] 已载入 story.json，共 ' + data.steps.length + ' 步');
          return data;
        }
        throw new Error('story.json 里没有有效 steps');
      });
  }

  function loadStory() {
    // 顺序有讲究：
    //   1) story.js  —— <script> 加载不受 file:// 的 CORS 限制。
    //                  嵌进 CEF / WebView 时只有这一条能成，fetch 必被拒。
    //   2) story.json —— 用本地 http 服务打开时的备用格式。
    //   3) 内置样本  —— 保证任何情况下打开都有东西可看。
    return loadStoryFromScript()
      .catch(function () { return loadStoryFromFetch(); })
      .catch(function () {
        var sample = window.VN_SAMPLE_STORY;
        console.log('[VN] 未找到 story.js / story.json，回退到内置样本（'
          + (sample && sample.steps ? sample.steps.length : 0) + ' 步）。'
          + ' 完整数据请用 Unity 菜单 WanXuan > 导出 Web 剧本 生成 story.js。');
        return sample || null;
      });
  }

  function prepareStory(story, forHudOnly) {
    if (!forHudOnly) { state.story = story; }
    state.byId = {};
    state.indexById = {};
    state.total = story.steps.length;

    for (var i = 0; i < story.steps.length; i++) {
      var step = story.steps[i];
      if (!step || !step.id) { continue; }
      state.byId[step.id] = step;
      state.indexById[step.id] = i;
    }
  }

  function lookup(id) {
    return (id && state.byId[id]) ? state.byId[id] : null;
  }

  /* ============================================================
     剧本遍历（仅 standalone 模式使用）
     ============================================================ */

  function goTo(id) {
    var step = lookup(id);
    var guard = 0;

    // 标记步骤不产生画面，只更新幕标题/时段，然后继续前进
    // —— 与 Unity 侧 StoryManager.ExecuteStep 对 Marker 的处理一致。
    while (step && step.type === 'marker' && guard++ < 200) {
      showChapterBanner(step.markerTitle);
      applyBackground(step.background);
      id = step.next;
      step = lookup(id);
    }

    if (!step) {
      // 悬空链接。Unity 侧 StoryManager 遇到这种情况会直接 FinishStory，
      // 这里也照做，并把问题喊出来，不要让玩家卡在一个没有反馈的画面上。
      console.warn('[VN] 悬空链接（目标不存在）：', id);
      showEnding({ endingTitle: '脚本错误', endingMessage: '剧情链接断开：' + id + '\n请重新导入剧本并查看剧本图自检日志。' });
      return;
    }

    state.currentId = id;
    state.currentStep = step;
    execute(step);
  }

  function execute(step) {
    switch (step.type) {
      case 'narration':
      case 'dialogue':
        showDialogue(step);
        break;
      case 'choice':
        showChoices(step);
        break;
      case 'end':
        showEnding(step);
        break;
      default:
        console.warn('[VN] 未知步骤类型：', step.type, step.id);
        break;
    }
  }

  /* ============================================================
     对话
     ============================================================ */

  function showDialogue(step) {
    hideChoices();
    hideEnding();
    applyBackground(step.background);
    document.body.classList.remove('ui-hidden');
    state.hidden = false;
    setControlActive('hide', false);
    dom.restoreMarker.classList.add('hidden');

    var speaker = step.speaker || '';
    if (speaker) {
      dom.namePlate.textContent = speaker;
      dom.namePlate.classList.remove('hidden');
    } else {
      dom.namePlate.classList.add('hidden');
    }

    /* 提示语回到"对话"这一档 —— 上一句可能是选项或结局页留下的。 */
    setHint(HINT_DIALOGUE);

    /* 第一句话来了 → 把那层交接的光收掉（从主菜单进来的那一下的收尾）。
       放在这里而不是 init()：要等画面真的有东西可看再收，
       否则会先露出一个空对话框、再露出文字。 */
    dropHandoffVeil();

    startTyping(step.content || '');
    updateHud();
  }

  function startTyping(text) {
    stopTyping();

    state.fullText = text;
    state.typedLength = 0;
    state.typing = true;

    dom.advanceIndicator.classList.add('hidden');
    renderText('');
    cancelAuto();

    if (state.fast) {
      completeTyping();
      return;
    }

    typeTick();
  }

  function typeTick() {
    if (!state.typing) { return; }

    if (state.typedLength >= state.fullText.length) {
      completeTyping();
      return;
    }

    var ch = state.fullText.charAt(state.typedLength);
    state.typedLength++;
    renderText(state.fullText.slice(0, state.typedLength));

    var delay = state.settings.textSpeed + (PUNCTUATION_PAUSE[ch] || 0);
    state.typeTimer = window.setTimeout(typeTick, delay);
  }

  function completeTyping() {
    stopTyping();
    state.typing = false;
    state.typedLength = state.fullText.length;
    renderText(state.fullText);
    dom.advanceIndicator.classList.remove('hidden');

    // 关键回执：打字机由前端驱动时，C# 必须知道"文字已经显示完"，
    // 否则玩家在打字过程中点击会丢事件、或自动播放会踩到节奏。
    send('dialogue.typingComplete', { stepId: state.currentId });

    if (state.auto) { scheduleAuto(); }
  }

  function stopTyping() {
    if (state.typeTimer !== null) {
      window.clearTimeout(state.typeTimer);
      state.typeTimer = null;
    }
  }

  function renderText(text) {
    dom.dialogueText.textContent = text;
    if (state.typing) {
      var caret = document.createElement('span');
      caret.className = 'caret';
      dom.dialogueText.appendChild(caret);
    }
  }

  /* ============================================================
     选项
     ============================================================ */

  function showChoices(step) {
    stopTyping();
    state.typing = false;
    cancelAuto();
    dom.dialogueLayer.classList.add('hidden');
    hideEnding();

    var choices = step.choices || [];
    dom.choiceLayer.innerHTML = '';
    dom.choiceLayer.classList.add('show');

    /* 提示语换成"选择"这一档，而且**把实际能按的键写出来** ——
       按钮右边显示的就是 A/B/C…，两边共用 choiceKeyLabel()，
       不会出现"提示里说按 A、按钮上写 B"。 */
    var keys = [];
    for (var k = 0; k < choices.length; k++) {
      keys.push(choiceKeyLabel(k));
    }
    setHint(keys.length ? '点击选择 · 或按 ' + keys.join(' / ') : '点击选择');

    for (var i = 0; i < choices.length; i++) {
      (function (index) {
        var choice = choices[index];
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'choice-button';
        button.style.animationDelay = (index * 70) + 'ms';

        var label = document.createElement('span');
        label.textContent = choice.label || '';
        button.appendChild(label);

        var key = document.createElement('span');
        key.className = 'choice-key';
        key.textContent = choiceKeyLabel(index);
        button.appendChild(key);

        button.addEventListener('click', function (event) {
          event.stopPropagation();
          selectChoice(index, choice);
        });

        dom.choiceLayer.appendChild(button);
      })(i);
    }

    updateHud();
  }

  function selectChoice(index, choice) {
    dom.choiceLayer.classList.remove('show');
    dom.choiceLayer.innerHTML = '';
    dom.dialogueLayer.classList.remove('hidden');

    /* 选项收掉之后提示要回"继续" —— 不然在下一句到达之前（桥接模式下要等 C#
       回话）右下角还写着"或按 A / B"。 */
    setHint(HINT_DIALOGUE);

    send('choice.selected', { index: index, next: choice.next || '', label: choice.label || '' });

    if (state.mode === 'standalone') {
      goTo(choice.next);
    }
  }

  function hideChoices() {
    dom.choiceLayer.classList.remove('show');
    dom.choiceLayer.innerHTML = '';
    dom.dialogueLayer.classList.remove('hidden');
    setHint(HINT_DIALOGUE);
  }

  /* ============================================================
     结局
     ============================================================ */

  function showEnding(step) {
    stopTyping();
    state.typing = false;
    cancelAuto();
    hideChoices();

    dom.endingTitle.textContent = step.endingTitle || 'End';
    dom.endingMessage.textContent = step.endingMessage || '';
    dom.endingLayer.classList.remove('hidden');

    /* 结局页上的提示**必须换掉** —— 原来这里一直写着"点击 / 空格 继续"，
       而那时候点击是不推进的（advance() 见到结局层就直接返回），
       等于屏幕上写着一件做不到的事。 */
    setHint('按 Esc 先收起这张卡');

    updateHud();
  }

  function hideEnding() {
    dom.endingLayer.classList.add('hidden');
    setHint(HINT_DIALOGUE);
  }

  function restart() {
    hideEnding();
    send('ending.restart', {});

    if (state.mode === 'standalone') {
      var first = state.story && state.story.steps && state.story.steps[0];
      if (first) { goTo(first.id); }
    }
  }

  /* ============================================================
     幕标题 / 时段
     ============================================================ */

  function showChapterBanner(title) {
    if (!title) { return; }

    dom.chapterBanner.textContent = title;
    dom.chapterBanner.classList.add('show');

    window.setTimeout(function () {
      dom.chapterBanner.classList.remove('show');
    }, 2600);
  }

  function applyBackground(background) {
    if (!background) { return; }
    state.background = background;

    if (!state.previewBackdrop) { return; }

    for (var i = 0; i < BACKDROP_CLASSES.length; i++) {
      dom.backdrop.classList.remove(BACKDROP_CLASSES[i]);
    }
    dom.backdrop.classList.add(BACKGROUND_CLASS[background] || 'backdrop-day');
  }

  /* ============================================================
     推进 / 交互
     ============================================================ */

  function advance() {
    // 打字中点击 → 先补全文字（VN 惯例）
    if (state.typing) {
      completeTyping();
      return;
    }

    if (!dom.endingLayer.classList.contains('hidden')) { return; }
    if (dom.choiceLayer.classList.contains('show')) { return; }

    send('dialogue.advance', { stepId: state.currentId });

    // bridge 模式下由 C# 决定下一步；standalone 模式自己走
    if (state.mode === 'standalone') {
      var step = state.currentStep;
      if (!step || step.type === 'end') { return; }
      goTo(step.next);
    }
  }

  function scheduleAuto() {
    cancelAuto();
    if (!state.auto) { return; }

    var textLength = state.fullText ? state.fullText.length : 0;
    var wait = state.settings.autoDelay + textLength * 55;
    state.autoTimer = window.setTimeout(advance, wait);
  }

  function cancelAuto() {
    if (state.autoTimer !== null) {
      window.clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function toggleAuto() {
    state.auto = !state.auto;
    if (state.auto && !state.typing) { scheduleAuto(); }
    if (!state.auto) { cancelAuto(); }
    setControlActive('auto', state.auto);
    showToast(state.auto ? '自动播放：开' : '自动播放：关');
  }

  function toggleFast() {
    state.fast = !state.fast;
    setControlActive('fast', state.fast);
    showToast(state.fast ? '快进：开（文字瞬间显示）' : '快进：关');
  }

  function toggleHidden() {
    state.hidden = !state.hidden;
    document.body.classList.toggle('ui-hidden', state.hidden);
    dom.restoreMarker.classList.toggle('hidden', !state.hidden);
    setControlActive('hide', state.hidden);
    send(state.hidden ? 'ui.hide' : 'ui.show', {});
  }

  function toggleTheme() {
    var next = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    state.theme = next;
    applyTheme(next);
    showToast('主题：' + (THEME_LABELS[next] || next));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function toggleBackdrop() {
    state.previewBackdrop = !state.previewBackdrop;
    dom.backdrop.classList.toggle('hidden', !state.previewBackdrop);
    setControlActive('backdrop', state.previewBackdrop);

    if (state.previewBackdrop) { applyBackground(state.background); }

    showToast(state.previewBackdrop
      ? '背景预览：开（模拟 Unity 的 World 场景）'
      : '背景预览：关（此时整页透明，接进 Unity 后 Live2D 会从这里透上来）');
  }

  // 参考层单独开关，这样想拍干净设计稿时不用连背景一起关掉
  function toggleGuides() {
    state.showGuides = !state.showGuides;
    dom.characterSlot.classList.toggle('hidden', !state.showGuides);
    setControlActive('guides', state.showGuides);
    showToast(state.showGuides
      ? '参考层：开（角色站位框 + 面部安全线）'
      : '参考层：关（干净画面，适合截图评审）');
  }

  function toggleHud() {
    state.hud = !state.hud;
    dom.hud.classList.toggle('hidden', !state.hud);
    setControlActive('hud', state.hud);
    updateHud();
  }

  function setControlActive(action, active) {
    var button = dom.controls.querySelector('[data-action="' + action + '"]');
    if (button) { button.classList.toggle('active', !!active); }
  }

  /**
   * 设右下角那行提示 —— **唯一入口**。
   *
   * 为什么要一个函数：它有三个来源（对话 / 选项 / 结局）、还有一个借用它的
   * toast，写死字符串的话就会出现"这里改对了、那里又冲回去"。
   * 存进 state.hint 之后，toast 结束能回到**当前这一档**的那句。
   */
  function setHint(text) {
    state.hint = text;

    if (dom.hint) {
      dom.hint.textContent = text;
    }
  }

  function showToast(message) {
    /* toast 借用右下角同一行（那里本来就没别的东西），2.2 秒后退回
       **当前状态该有的那句** —— 不能写死回"点击 / 空格 继续"：
       在选项页上那样回，提示就又变成一句按不出来的话了。 */
    dom.hint.textContent = message;
    dom.hint.classList.remove('hidden');

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      dom.hint.textContent = state.hint;
    }, 2200);
  }

  /* ============================================================
     开发 HUD
     ============================================================ */

  function updateHud() {
    if (!state.hud) { return; }

    var step = state.currentStep;
    var index = state.indexById[state.currentId];

    var lines = [
      'step    : ' + (state.currentId || '—'),
      '进度    : ' + (index !== undefined ? (index + 1) : '?') + ' / ' + (state.total || '?'),
      '类型    : ' + (step ? step.type : '—'),
      '背景    : ' + state.background,
      '表情    : ' + formatExpression(step),
      '模式    : ' + state.mode,
      '主题    : ' + state.theme,
      '字体    : ' + formatFontStatus(),
      '设置    : ' + state.settings.textSpeed + 'ms/字 · 自动 ' + state.settings.autoDelay + 'ms',
      '按键    : ' + state.keyCount + ' 次，最后 ' + state.lastKey
    ];

    var stageNote = step && step.stageNote ? step.stageNote : '';
    if (stageNote) {
      lines.push('演出提示:');
      stageNote.split('\n').forEach(function (line) { lines.push('  ' + line); });
    }

    dom.hud.textContent = lines.join('\n');
  }

  function formatExpression(step) {
    if (!step || !step.expression) { return '（无）'; }
    var name = EXPRESSION_NAMES[step.expression];
    return step.expression + (name ? '（' + name + '）' : '');
  }

  function formatFontStatus() {
    if (state.fontLoaded === null) { return '检测中…'; }
    return state.fontLoaded
      ? 'ChillRoundF 已加载'
      : '未加载 → 正在用系统字体（评排版时务必注意）';
  }

  /**
   * 检测工程里的 ChillRoundF 是否真的加载成功。
   * file:// 下浏览器通常以 CORS 拒绝跨目录字体文件，会静默退回系统字体 ——
   * 那样你评的就不是游戏真实字体，所以这件事必须在 HUD 里显式暴露出来。
   */
  function detectFont() {
    if (!document.fonts || !document.fonts.ready) {
      state.fontLoaded = false;
      updateHud();
      return;
    }

    document.fonts.ready.then(function () {
      try {
        state.fontLoaded = document.fonts.check('30px "ChillRoundF"');
      } catch (error) {
        state.fontLoaded = false;
      }

      if (!state.fontLoaded) {
        console.warn(
          '[VN] ChillRoundF 没有加载成功，当前中文是系统字体渲染的，评排版时请记得这一点。\n' +
          '最常见原因是 file:// 下浏览器以 CORS 拒绝了跨目录字体文件。两种解法：\n' +
          '  1) 在 WebUI 目录起静态服务后访问 http://localhost:8000 —— 相对路径即可生效；\n' +
          '  2) 把 ChillRoundF.ttf 复制到 WebUI/fonts/，并把 style.css 里 @font-face 的\n' +
          '     src 改成 url("fonts/ChillRoundF.ttf")。'
        );
      }

      updateHud();
    });
  }

  /* ============================================================
     桥接：与 C# 的通信
     ------------------------------------------------------------
     信封格式、版本号、四种发送方式、宿主探测 —— 这些都是**协议**，不是本页的
     界面逻辑，所以它们住在共用的 WebUI/bridge.js 里；主菜单界面用的是同一个文件。

     不在这里各写一份的理由：复制一定会漂移，而漂移的表现是
     "设置页能存、游戏页读不到"这种极难查的问题。
     ============================================================ */

  /** 发送一个信封。实现在 bridge.js。 */
  function send(type, payload) {
    VNBridge.send(type, payload);
  }

  /**
   * 收到 C# 的消息。由 VNBridge.subscribe 调用，签名 (type, payload, message)。
   *
   * "收到之后本页该怎么表现"（比如切成 bridge 模式）留在这里而不是 bridge.js ——
   * bridge.js 只负责"有没有收到"，怎么反应是页面自己的事。
   */
  function handleBridgeMessage(type, payload) {
    // 一旦 C# 主动开口，就切到 bridge 模式。
    // 模式判断不该靠"页面上有没有某个宿主全局对象"来猜 ——
    // 不同插件注入的全局名各不相同（UWB 是 uwb，Vuplex 是 vuplex…），
    // 猜错了会让 JS 和 C# 同时遍历剧情，两边各走各的、互相打架。
    // 正确的判据是"谁在驱动剧情"，而 C# 发来第一条消息就说明答案是它。
    if (state.mode !== 'bridge') {
      state.mode = 'bridge';
      console.log('[VN] 收到 C# 消息，切换到 bridge 模式（剧情改由 C# 驱动，JS 退化为哑视图）');
      updateHud();
    }

    // 注意：不再需要在本地记一个"C# 开口了"的标记 ——
    // bridge.js 已经在收到消息时置好了 VNBridge.hostSpoken，
    // 上面 3 秒兜底那段用的就是它。同一件事记两份是 bug 的温床。
    switch (type) {
      case 'story.load':
        if (payload.story && payload.story.steps) {
          prepareStory(payload.story);
        }
        break;

      case 'marker.show':
        showChapterBanner(payload.title || '');
        break;

      case 'dialogue.show': {
        // 注意：C# 侧不一定发 stepId（IDialogueView 接口只传说话人与正文），
        // 所以这里必须把 speaker / content 从 payload 直接带进 currentStep，
        // 否则 lookup 失败走兜底时文字会是 undefined，框里一片空白。
        var known = lookup(payload.stepId);

        state.currentId = payload.stepId || state.currentId;
        state.currentStep = {
          id: payload.stepId || state.currentId,
          type: payload.speaker ? 'dialogue' : 'narration',
          speaker: payload.speaker || '',
          content: payload.content || '',
          expression: payload.expression || (known ? known.expression : ''),
          background: payload.background || (known ? known.background : ''),
          stageNote: payload.stageNote || (known ? known.stageNote : '')
        };

        showDialogue(state.currentStep);
        break;
      }

      case 'choice.show':
        state.currentId = payload.stepId || state.currentId;
        state.currentStep = { id: payload.stepId, type: 'choice', choices: payload.choices || [] };
        showChoices(state.currentStep);
        break;

      case 'ending.show':
        showEnding({ endingTitle: payload.title, endingMessage: payload.message });
        break;

      case 'ui.hide':
        if (!state.hidden) { toggleHidden(); }
        break;

      case 'ui.show':
        if (state.hidden) { toggleHidden(); }
        break;

      // C# 持有设置（PlayerPrefs）。本页在开机时主动发一条 settings.request 问一次，
      // 之后玩家在暂停菜单里改了设置也会再收到。
      // 收到之后**两处**都要更新：
      //   applySettings     —— 本页内部的只读镜像（打字机节奏、自动播放间隔）
      //   AnimusSettings    —— 暂停菜单里那些控件的显示值
      case 'settings.apply':
        applySettings(payload.settings || payload);
        if (window.AnimusSettings) {
          AnimusSettings.apply(payload.settings || payload);
        }
        break;

      // C# 算好的记忆序列（暂停菜单的主视图）。网页不自己算 ——
      // bridge 模式下本页根本没有剧本，只有 C# 知道走到哪了。
      case 'story.progress':
        if (window.AnimusMemory) {
          AnimusMemory.setProgress(payload);
        }
        break;

      default:
        console.warn('[VN] 未知的桥接消息：', type);
        break;
    }
  }

  VNBridge.subscribe(handleBridgeMessage);

  /* ============================================================
     设置（只读消费）
     ------------------------------------------------------------
     本页**没有设置界面** —— 它在主菜单场景（MainMenu）里，见 WebUI/menu/。
     本页只是设置的消费者：文字速度影响打字机的出字节奏，自动播放间隔影响自动播放。
     音量与全屏跟本页完全无关（那是 C# 直接作用到 AudioListener / Screen 上的）。

     值由 C# 下发（它才是权威，存在 PlayerPrefs 里）。开机时本页发一条
     settings.request 主动问一次，之后就只在玩家改了设置时被动收到。

     存的是**物理量**（每字多少毫秒），不是滑杆刻度 —— 滑杆只存在于设置界面，
     本页只关心"每字等多久"。
     ============================================================ */

  function clampNumber(value, min, max) {
    if (value < min) { return min; }
    if (value > max) { return max; }
    return value;
  }

  /**
   * 从 C# 同步设置。字段缺失就保持原值 —— 这样以后加新设置项时，
   * 旧版 C# 发来的消息不会把新字段清成 0。
   */
  function applySettings(next) {
    if (!next) { return; }

    var s = state.settings;

    if (typeof next.textSpeed === 'number' && isFinite(next.textSpeed)) {
      s.textSpeed = clampNumber(next.textSpeed, SPEED_FAST_MS, SPEED_SLOW_MS);
    }
    if (typeof next.autoDelay === 'number' && isFinite(next.autoDelay)) {
      s.autoDelay = clampNumber(next.autoDelay, AUTO_MIN_MS, AUTO_MAX_MS);
    }
    if (typeof next.volume === 'number' && isFinite(next.volume)) {
      s.volume = clampNumber(next.volume, 0, 1);
    }
    if (typeof next.fullscreen === 'boolean') {
      s.fullscreen = next.fullscreen;
    }

    updateHud();
  }


  /* ============================================================
     暂停菜单（Animus 归档系统）
     ------------------------------------------------------------
     界面在 animus/ 下，是**主菜单页和游戏页共用的一套**。
     本页只负责三件事：
       1. Esc 掀开它、Esc / 「继续游戏」收掉它
       2. 把瓦片上的动作翻译成桥接消息（本页不认识场景切换）
       3. 把当前进度报给顶栏（那是 C# 算的，本页只是转述）

     ## 动作也是瓦片，不是底栏按钮

     参考图里的桌面把「继续」「放弃记忆」「离开」和「归档」「物品」「数据库」
     混在**同一摞瓦片**里。所以这里也照做：注册三个 `run` 型的模块，
     它们的 order 让它们排在最上和最下，中间的才是文件夹。

     它们不是"界面"，只是三格瓦片 —— 这一点和别处的分工一致：
     界面归 animus/，流程归本文件。
     ============================================================ */

  function registerPauseTiles() {
    Animus.register({
      id: 'resume', no: '00', label: '继续游戏', order: -10,
      code: 'CMD · RESUME',
      desc: '关闭归档系统，回到刚才那一段记忆。',
      run: function () { Animus.close(); }
    });

    /* 「设置」是一格瓦片，三页在它里面 —— 和主菜单那边一致。
       摊在桌面上会让暂停菜单变成一条杂项列表，也不符合参考图的层级。 */
    Animus.register({
      id: 'settings', no: '50', label: '设置', order: 50,
      code: 'REC · 50 / OPTIONS',
      desc: '音频、文字与显示输出。游戏进行中没有网页立绘，所以这里是三页。',
      children: ['sound', 'text', 'display'],
      preview: function () {
        var s = AnimusSettings.get();
        return [
          ['主音量', Math.round(s.volume * 100) + '%'],
          ['文字', (s.textSpeed > 0 ? Math.round(1000 / s.textSpeed) : 0) + ' 字/秒']
        ];
      }
    });

    Animus.register({
      id: 'to-menu', no: '90', label: '回主菜单', order: 900,
      code: 'CMD · MAIN MENU',
      desc: '中止这一段记忆，回到标题。没有存档就不会自动续上 —— 现在还没有自动存档。',
      run: function () { leaveToMenu(); }
    });

    Animus.register({
      id: 'quit', no: '91', label: '退出游戏', order: 910,
      code: 'CMD · QUIT',
      desc: '直接退出。设置会保存，剧情进度不会。',
      run: function () { send('menu.quit', {}); }
    });
  }

  /* 三个动作瓦片只注册一次。放在脚本加载时就注册（不是等第一次开菜单），
     因为它们和设置那几页一样是"这个页面上有哪些瓦片"的一部分 ——
     后注册的话第一次打开会少几格。 */
  registerPauseTiles();

  /** 打开暂停菜单。已经开着就什么都不做（Esc 连按不会叠起来）。 */
  function openPause() {
    if (Animus.isOpen()) {
      return;
    }

    /* 进去之前先把自动播放停掉。
       不收的话：菜单盖在上面，底下的剧情还在自己往前走。 */
    state.autoPausedByMenu = state.auto;
    if (state.auto) {
      toggleAuto();
    }

    Animus.open({
      kicker: '记 忆 归 档',
      title: '暂停',
      /* 顺序由各模块的 order 决定：
           01 继续游戏 → 02 记忆序列 → 03~05 设置 → 90 回主菜单 → 91 退出
         动作在最上、最下，文件夹在中间 —— 和参考图里那摞瓦片的排法一致。

         **顶栏读数（同步率 / 章节 / 进度）不在这里给。**
         它归记忆模块（见 memory-module.js 的 pushReadout）——
         那个模块是唯一知道"读到哪一章"的地方，主菜单和游戏页都用它那一份，
         免得两处各算一套、数字对不上。open 之后要立刻 warmUp 一次，
         否则会先闪一下空读数。 */
      modules: ['resume', 'memory', 'settings', 'to-menu', 'quit'],
      escLabel: '继续',
      actions: []
    });

    if (window.AnimusMemory && typeof AnimusMemory.warmUp === 'function') {
      AnimusMemory.warmUp();
    }

    /* 「跟随进度」那一套主题的依据是"现在读到哪一步了" —— 玩家多半是
       刚读完一段剧情才按的 Esc，所以这里必须按最新的进度重算一次。
       光靠设置模块那个一分钟一次的轮询，最坏要等一分钟屋子才换光。 */
    if (window.AnimusSettings && typeof AnimusSettings.refreshTheme === 'function') {
      AnimusSettings.refreshTheme();
    }
  }

  function bindPauseHandlers() {
    Animus.handlers.action = function (id) {
      if (id === 'resume') {
        Animus.close();
      } else if (id === 'menu') {
        /* 回主菜单场景。和左下角那个「主菜单」按钮同一件事 ——
           本页只发意图，换场景是 C# 的 WebSceneFlow 干的。
           走 leaveToMenu()：它负责"先升光、再发消息"，否则那一下是硬切。 */
        leaveToMenu();
      } else if (id === 'quit') {
        send('menu.quit', {});
      }
    };

    /* 关掉之后恢复自动播放。
       只在"是菜单把它停掉的"情况下恢复 —— 玩家自己按 A 关掉的自动
       不该因为开关一次菜单就被打开。 */
    Animus.handlers.closed = function () {
      if (state.autoPausedByMenu && !state.auto) {
        toggleAuto();
      }
      state.autoPausedByMenu = false;
    };

    /* 设置改了：本地立刻生效（手感要马上有反馈），再通知 C# 落盘。
       C# 会回一条 settings.apply 做最终确认，那时界面上显示的就是真值。 */
    AnimusSettings.handlers.changed = function (settings) {
      applySettings(settings);
      send('settings.changed', settings);
    };

    /* 切到记忆序列那一页时**重新问一次进度**。
       玩家可能是读了档之后才打开的暂停菜单，之前问的那次已经过期。
       （顶栏读数不在这里刷 —— 它归记忆模块，C# 一回话它自己就更新了，
       见 memory-module.js 的 pushReadout。） */
    Animus.handlers.page = function (id) {
      if (id === 'memory' || id === 'chapters') {
        send('story.progress.request', {});
      }
    };
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  /**
   * 第 index 个选项的键位提示（A / B / C…）。
   *
   * **提示语和按钮右边那个小字共用它** —— 一个公式写两遍，
   * 迟早出现"提示里让你按 A、按钮上写的是别的"。
   */
  function choiceKeyLabel(index) {
    return String.fromCharCode(65 + index);
  }

  /**
   * 把按键换成选项序号，认不出来返回 -1。
   *
   * **字母是主路径**：按钮右边那个小字（`.choice-key`）显示的就是 A/B/C…，
   * 提示语里说的也是它 —— 屏幕上写着 A、按 A 却没反应，是这一版之前的实际状况
   * （那时只认 1-9）。数字留着当兼容，两套都认。
   */
  function choiceIndexFromKey(key) {
    if (!key) {
      return -1;
    }

    if (key >= '1' && key <= '9') {
      return parseInt(key, 10) - 1;
    }

    var upper = key.toUpperCase();

    if (upper >= 'A' && upper <= 'Z') {
      return upper.charCodeAt(0) - 65;
    }

    return -1;
  }

  function bindEvents() {
    window.addEventListener('resize', fitStage);

    // 键盘探针（捕获阶段，任何处理之前先记录）。
    // 用途：按 D 打开 HUD 就能看出按键到底有没有送进来 ——
    //   「按键 : 0 次」        → 按键没到网页，问题在 Unity 侧的转发
    //   「按键 : 3 次，最后 …」 → 按键到了，那问题就在前端的事件处理
    document.addEventListener('keydown', function (event) {
      state.keyCount++;
      state.lastKey = event.key + '  (code ' + event.code + ')';
      updateHud();
    }, true);

    // 点击舞台推进；但点控件/选项/结局按钮时不算
    dom.stage.addEventListener('click', function (event) {
      if (event.target.closest('#controls, #choice-layer, #ending-layer, #hud, #dev-hud')) { return; }
      if (state.hidden) { toggleHidden(); return; }
      advance();
    });

    dom.endingRestart.addEventListener('click', function (event) {
      event.stopPropagation();
      restart();
    });

    dom.controls.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) { return; }
      event.stopPropagation();

      switch (button.getAttribute('data-action')) {
        case 'auto':     toggleAuto(); break;
        case 'fast':     toggleFast(); break;
        case 'hide':     toggleHidden(); break;
        case 'theme':    toggleTheme(); break;
        case 'backdrop': toggleBackdrop(); break;
        case 'guides':   toggleGuides(); break;
        case 'hud':      toggleHud(); break;
        case 'menu':
          // 回主菜单场景。**不是本页切界面** —— 主菜单是另一个场景
          // （MainMenu），由 C# 的 WebSceneFlow 负责换场景。
          // 本页只发一个意图，不做任何界面切换；过场交给 leaveToMenu()。
          leaveToMenu();
          break;
      }
    });

    document.addEventListener('keydown', function (event) {
      /* 暂停菜单开着的时候，本页**一律不处理键盘**。
         它盖在最上面，此时空格/回车/1-9 该由菜单自己消化 ——
         不拦的话在菜单里按空格会顺手把底下的剧情翻一页。
         （Animus 自己的监听在另一条链上，不受这里影响。） */
      if (window.Animus && Animus.isOpen()) {
        return;
      }

      /* 选项键位：字母（屏幕上写的就是 A/B/C…）和数字都认 —— 见
         choiceIndexFromKey。**只在选项层开着的时候拦**：
         不然平时按 F / B / G 这些开发开关会被它吃掉。 */
      if (dom.choiceLayer.classList.contains('show')) {
        var pick = choiceIndexFromKey(event.key);

        if (pick >= 0) {
          var buttons = dom.choiceLayer.querySelectorAll('.choice-button');

          if (pick < buttons.length) {
            buttons[pick].click();
            event.preventDefault();
            return;
          }
        }
      }

      switch (event.key) {
        case ' ':
        case 'Enter':
          event.preventDefault();
          if (state.hidden) { toggleHidden(); } else { advance(); }
          break;
        case 'Escape':
          /* Esc 有三层，从下往上：先关结局页，再开/关暂停菜单。
             收掉的动作由 Animus 自己处理（它会回调 handlers.closed）。

             **必须 preventDefault**：Animus 自己也监听 Esc，而它的监听是在
             本文件之后注册的，所以同一个 Esc 会先到这里、再到它那里。
             不标记"已处理"的话，这里刚把菜单打开，它那边立刻又关掉。 */
          if (!dom.endingLayer.classList.contains('hidden')) {
            hideEnding();
          } else if (Animus.isOpen()) {
            Animus.close();
          } else {
            openPause();
          }
          event.preventDefault();
          break;
        case 'h': case 'H': toggleHidden(); break;
        case 't': case 'T': toggleTheme(); break;
        case 'd': case 'D': toggleHud(); break;
        case 'a': case 'A': toggleAuto(); break;
        case 'f': case 'F': toggleFast(); break;
        case 'b': case 'B': toggleBackdrop(); break;
        case 'g': case 'G': toggleGuides(); break;

        case 'm': case 'M':
          // M 键 = 回主菜单场景（和左下角那个「主菜单」按钮同一件事）。
          // 本页**没有**菜单界面，所以这里不会"切出菜单来"，而是请求换场景。
          // 浏览器里预览时没人接这条消息，只会看到一条控制台日志 —— 这是对的，
          // 主菜单是独立页面，在浏览器里直接打开 menu/index.html 看即可。
          leaveToMenu();
          break;
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 调试用：在控制台里可直接操作
  window.VN = {
    state: state,
    goTo: goTo,
    advance: advance,
    send: send,
    applySettings: applySettings,
    // 桥接层本身也暴露出来（版本号、hostSpoken、手动发消息都在它身上）
    bridge: VNBridge
  };
})();
