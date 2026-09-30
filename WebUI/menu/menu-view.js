/* ============================================================
   menu-view.js —— 主菜单界面（只属于 menu/index.html）
   ------------------------------------------------------------
   这一套界面只知道"有三个按钮被点了"，不知道点了之后会发生什么：
   它不碰 C#、不碰设置、不碰场景切换。那些都由 boot.js 决定。

   这样分的理由：主菜单以后大概率要改（加"继续游戏""读档""CG 鉴赏"），
   而"点了开始游戏之后做什么"是流程问题，改流程不该动界面代码。
   ============================================================ */

window.MainMenuView = (function () {
  'use strict';

  var dom = {};

  /** 当前悬停/聚焦的选项 key，用来去重。 */
  var hovered = null;

  /** 排查探针：各只打一次。查到原因后可以删掉。 */
  var probeMove = false;
  var probeHover = false;

  /** 按钮被点的通知。由 boot.js 填，界面自己不认识它们的目的地。 */
  var handlers = {
    start: null,
    settings: null,
    quit: null,
    /* 鼠标进出选项的通知。参数是按钮的 data-menu 值（'start' / 'settings' / 'quit'），
       离开时传 null。界面不知道"悬停该让她做什么表情"——那是 boot.js 的事。 */
    hover: null
  };

  /** 通知一次悬停状态。key 为 null 表示离开了所有选项。 */
  function emitHover(key) {
    if (typeof handlers.hover === 'function') {
      handlers.hover(key);
    }
  }

  function keyOf(element) {
    var button = element && element.closest ? element.closest('button[data-menu]') : null;
    return button ? button.getAttribute('data-menu') : null;
  }

  function cacheDom() {
    dom.layer = document.getElementById('menu-layer');
    dom.title = document.getElementById('menu-title');
    dom.subtitle = document.getElementById('menu-subtitle');
    dom.buttons = document.getElementById('menu-buttons');
  }

  function bind() {
    dom.buttons.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-menu]');
      if (!button) {
        return;
      }

      // 不让点击冒泡出去：菜单背后的层不该因为"点了按钮"而收到任何东西
      event.stopPropagation();

      var handler = handlers[button.getAttribute('data-menu')];
      if (typeof handler === 'function') {
        handler();
      }
    });

    /* ---- 事件到达探针（各打一次，排查用） ----
       目的：把"鼠标事件没到网页"和"事件到了但被别的东西挡住"分开。
       分不出来就会一直在错的那一层改。 */
    document.addEventListener('mousemove', function () {
      if (!probeMove) {
        probeMove = true;
        console.log('[VN:menu] 探针：页面收到 mousemove —— 鼠标事件能到网页。');
      }
    });

    /* ---- 悬停 / 聚焦 → 通知外面（boot.js 拿它去切立绘表情） ----
       用 mouseover 委托而不是 mouseenter：后者不冒泡，得给每个按钮单独绑。
       而且这里会**去重**，否则在同一个按钮内部移动鼠标会连着触发几十次。 */
    dom.buttons.addEventListener('mouseover', function (event) {
      if (!probeHover) {
        probeHover = true;
        console.log('[VN:menu] 探针：选项区收到 mouseover，target=<' +
          (event.target && event.target.tagName) + ' class="' +
          (event.target && event.target.className) + '">');
      }

      setHovered(keyOf(event.target));
    });

    // 离开整个选项区才恢复。mouseleave 不冒泡，所以直接绑在容器上。
    dom.buttons.addEventListener('mouseleave', function () {
      setHovered(null);
    });

    // 键盘走 ↑↓ 时也要有反应。focusout 只在焦点真的离开整个选项区时才恢复，
    // 否则在按钮之间移动会"恢复默认 → 立刻换表情"闪一下。
    dom.buttons.addEventListener('focusin', function (event) {
      setHovered(keyOf(event.target));
    });

    dom.buttons.addEventListener('focusout', function (event) {
      if (!dom.buttons.contains(event.relatedTarget)) {
        setHovered(null);
      }
    });
  }

  /** 记下当前悬停的项，只在**变化时**通知外面。 */
  function setHovered(key) {
    if (key === hovered) {
      return;
    }

    hovered = key;
    emitHover(key);
  }

  /** 标题由 C# 下发。空值不覆盖兜底文案 —— 宁可显示 HTML 里写的，也不要空白。 */
  function setText(title, subtitle) {
    if (title) {
      dom.title.textContent = title;
    }
    if (subtitle) {
      dom.subtitle.textContent = subtitle;
    }
  }

  /** 临时改副标题（用于"退出按钮在浏览器里无效"这类提示）。 */
  function setHint(text) {
    dom.subtitle.textContent = text;
  }

  function show() {
    dom.layer.classList.remove('hidden');
  }

  function hide() {
    dom.layer.classList.add('hidden');
  }

  function isVisible() {
    return !dom.layer.classList.contains('hidden');
  }

  /**
   * ↑↓ 在选项间移动焦点，回车激活（button 的原生行为）。
   *
   * 不做"自己维护一个选中索引"那套：焦点本身就是浏览器管的状态，
   * 而 :focus-visible 的样式和 :hover 是同一套（见 menu.css），
   * 所以键盘和鼠标走的是同一条视觉路径，不会出现两套高亮逻辑打架。
   */
  function bindKeys() {
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      // 设置页盖着的时候不接管方向键 —— 那边有自己的焦点要走
      if (!isVisible()) {
        return;
      }

      var buttons = dom.buttons.querySelectorAll('button[data-menu]');
      if (!buttons.length) {
        return;
      }

      var current = Array.prototype.indexOf.call(buttons, document.activeElement);
      var next;

      if (event.key === 'ArrowDown') {
        next = current < 0 ? 0 : (current + 1) % buttons.length;
      } else {
        next = current <= 0 ? buttons.length - 1 : current - 1;
      }

      event.preventDefault();   // 否则页面会试图滚动
      buttons[next].focus();
    });
  }

  function init() {
    cacheDom();
    bind();
    bindKeys();
    show();

    // 开局把焦点放在第一项：键盘党可以立刻回车，鼠标用户也一眼看出"这里是选项"。
    var first = dom.buttons.querySelector('button[data-menu]');
    if (first) {
      first.focus();
    }
  }

  return {
    handlers: handlers,
    init: init,
    show: show,
    hide: hide,
    isVisible: isVisible,
    setText: setText,
    setHint: setHint
  };
})();
