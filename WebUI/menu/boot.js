/* ============================================================
   boot.js —— 主菜单页的**唯一协调者**
   ------------------------------------------------------------
   menu-view.js 不知道设置存在，settings-view.js 不知道主菜单存在。
   这一层是唯一同时认识两套界面的地方，也是唯一认识 C# 的地方。

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
     悬停选项 → 立绘换表情
     ------------------------------------------------------------
     表情名来自模型自己的 2-3.model3.json，四个是：
       发光循环 / 困困眼 / 死鱼眼 / 空虚眼

     ⚠ 这张表**是按名字猜的**，不是核对过的产物。
       另外这三个名字也正好是策划案里 `表情A/B/C`（圣洁 / 灿烂 / 委屈）一直对不上的
       那一组 —— 现在可以在页面里逐个悬停看实际效果，然后回来把这张表定死，
       顺便把策划案里的 A/B/C 也对上。

       离开所有选项时传 null → 恢复默认表情。
     ============================================================ */
  var EXPRESSIONS = {
    start: '发光循环',    // 开始游戏 —— 大概是最有精神的一个
    settings: '困困眼',   // 设置 —— 偏平淡
    quit: '死鱼眼'        // 退出 —— 最低落/最无所谓的那个
  };

  /** 把两套界面接起来。这是整个文件存在的理由。 */
  function bindHandlers() {
    MainMenuView.handlers.start = function () {
      // 先收菜单再发消息：换场景要等 C# 走完，中间这段空白不该还压着一个菜单。
      MainMenuView.hide();
      VNBridge.send('menu.start', {});
    };

    MainMenuView.handlers.settings = function () {
      // 纯显示层的事，不走 C#。设置页是主菜单页的一部分，切来切去不需要惊动 Unity。
      SettingsView.show();
    };

    /* 鼠标进出一个选项 → 她换表情。
       映射表在上面的 EXPRESSIONS；界面（menu-view.js）只上报"悬停了哪一项"，
       不知道也不关心这会让她变成什么表情。 */
    MainMenuView.handlers.hover = function (key) {
      MenuCharacter.setExpression(key ? EXPRESSIONS[key] : null);
    };

    MainMenuView.handlers.quit = function () {
      if (VNBridge.hasHost()) {
        VNBridge.send('menu.quit', {});
      } else {
        // 浏览器里没有"退出"这回事，说清楚总比按钮点了没反应好
        MainMenuView.setHint('（正在浏览器里预览，退出按钮只在 Unity 内生效）');
      }
    };

    SettingsView.handlers.back = function () {
      SettingsView.hide();
    };

    SettingsView.handlers.changed = function (settings) {
      // 名字用 settings.changed 而不是 settings.set：
      // 这是"通知 C# 我改了"，不是"命令 C# 去改"。C# 收到后自己决定要不要落盘、
      // 要不要真的切全屏，并且会回一条 settings.apply 做最终确认。
      VNBridge.send('settings.changed', settings);
    };
  }

  function handleBridgeMessage(type, payload) {
    switch (type) {
      case 'menu.show':
        MainMenuView.setText(payload.title, payload.subtitle);
        break;

      case 'settings.apply':
        // C# 把设置对象直接当 payload 发（形如 {textSpeed:34,…}），
        // 也接受包一层 settings 的形态。
        SettingsView.apply(payload.settings || payload);
        break;

      default:
        console.warn('[VN:menu] 未知的桥接消息：', type);
        break;
    }
  }

  function init() {
    MainMenuView.init();
    SettingsView.init();

    // 右侧立绘。失败不会抛出来 —— live2d.js 自己会在右下角显示原因，
    // 菜单本体继续可用（没有立绘也不该连菜单都进不去）。
    MenuCharacter.init();

    bindHandlers();
    VNBridge.subscribe(handleBridgeMessage);

    // Esc 关掉设置页（最上面那一层）。主菜单本身不响应 Esc —— 那是标题界面，
    // 按 Esc 就退出的行为会让人误触。
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && SettingsView.isVisible()) {
        SettingsView.hide();
        event.preventDefault();
      }
    });

    // 主动问 C# 要当前设置，而不是等 C# 推。
    // 主动推必须踩准"网页还没加载完 / 桥接还没连上"的时机，两个场景里这个时机
    // 还不一样；网页自己知道自己什么时候准备好了，所以让网页开口问。
    VNBridge.send('settings.request', {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 调试用：控制台里可直接操作。
  // 调立绘位置/大小：改 live2d.js 顶部的 TUNING，然后 VN.character.reload()
  window.VN = {
    menu: MainMenuView,
    settings: SettingsView,
    character: MenuCharacter,
    bridge: VNBridge
  };
})();
