/* ============================================================
   settings-view.js —— 设置界面（只属于 menu/index.html）
   ------------------------------------------------------------
   独立于 menu-view.js：它不认识主菜单，主菜单也不认识它。
   两者唯一的交集是"设置盖在主菜单上面"这个视觉效果，
   而那条关系只写在 boot.js 里（以及下面 show/hide 里的 body 类）。

   **它不负责保存。** 存储位置在 C#（PlayerPrefs）：
     网页是 file:// 加载的，各浏览器对 file:// 的 localStorage 处理不一致
     （有的按目录隔离、有的直接禁用），存档不能赌这个。
   所以流程是：本地立刻生效（手感要马上有反馈）→ 通知 C# → C# 落盘并回执。

   它存的是**物理量**（每字多少毫秒、音量 0..1），不是滑杆刻度（0..100）。
   滑杆刻度只是给人"慢/快"的直觉，物理量才是 C# 和 JS 都能直接用的东西。
   ============================================================ */

window.SettingsView = (function () {
  'use strict';

  /* 滑杆区间。改这里就等于改"最快/最慢能调到多少"。 */
  var SPEED_SLOW_MS = 120;   // 滑杆 0
  var SPEED_FAST_MS = 8;     // 滑杆 100
  var AUTO_MIN_MS = 200;     // 滑杆 0
  var AUTO_MAX_MS = 3000;    // 滑杆 100

  /** 与 C# 的 UiSettings 字段初值保持一致。 */
  var DEFAULTS = {
    textSpeed: 34,
    autoDelay: 900,
    volume: 1,
    fullscreen: false
  };

  var dom = {};
  var inputs = {};
  var outputs = {};

  /** 当前值（真值）。HTML 上的滑杆只是它的一个视图。 */
  var current = {
    textSpeed: DEFAULTS.textSpeed,
    autoDelay: DEFAULTS.autoDelay,
    volume: DEFAULTS.volume,
    fullscreen: DEFAULTS.fullscreen
  };

  /** 玩家改了设置的通知。由 boot.js 填。 */
  var handlers = {
    changed: null,
    back: null
  };

  // ---------------------------------------------------------------
  // 换算：毫秒 ↔ 滑杆 0..100
  // ---------------------------------------------------------------

  function clampNumber(value, min, max) {
    if (value < min) { return min; }
    if (value > max) { return max; }
    return value;
  }

  function speedToSlider(ms) {
    var t = (SPEED_SLOW_MS - ms) / (SPEED_SLOW_MS - SPEED_FAST_MS);
    return clampNumber(Math.round(t * 100), 0, 100);
  }

  function sliderToSpeed(value) {
    return Math.round(SPEED_SLOW_MS - (value / 100) * (SPEED_SLOW_MS - SPEED_FAST_MS));
  }

  function delayToSlider(ms) {
    var t = (ms - AUTO_MIN_MS) / (AUTO_MAX_MS - AUTO_MIN_MS);
    return clampNumber(Math.round(t * 100), 0, 100);
  }

  function sliderToDelay(value) {
    return Math.round(AUTO_MIN_MS + (value / 100) * (AUTO_MAX_MS - AUTO_MIN_MS));
  }

  // ---------------------------------------------------------------
  // 显示
  // ---------------------------------------------------------------

  /** 把 current 刷到滑杆和数值标签上。 */
  function render() {
    inputs.textSpeed.value = speedToSlider(current.textSpeed);
    inputs.autoDelay.value = delayToSlider(current.autoDelay);
    inputs.volume.value = Math.round(current.volume * 100);
    inputs.fullscreen.checked = !!current.fullscreen;

    // 显示人能读的量：每秒多少字比"每字 34 毫秒"直观得多。
    var charsPerSecond = current.textSpeed > 0 ? Math.round(1000 / current.textSpeed) : 0;
    outputs.textSpeed.textContent = charsPerSecond + ' 字/秒';
    outputs.autoDelay.textContent = (current.autoDelay / 1000).toFixed(1) + ' 秒';
    outputs.volume.textContent = Math.round(current.volume * 100) + '%';
  }

  // ---------------------------------------------------------------
  // 数据进出
  // ---------------------------------------------------------------

  /**
   * 从 C# 同步设置。字段缺失就保持原值 —— 这样以后加新设置项时，
   * 旧版 C# 发来的消息不会把新字段清成 0。
   */
  function apply(next) {
    if (!next) {
      return;
    }

    if (typeof next.textSpeed === 'number' && isFinite(next.textSpeed)) {
      current.textSpeed = clampNumber(next.textSpeed, SPEED_FAST_MS, SPEED_SLOW_MS);
    }
    if (typeof next.autoDelay === 'number' && isFinite(next.autoDelay)) {
      current.autoDelay = clampNumber(next.autoDelay, AUTO_MIN_MS, AUTO_MAX_MS);
    }
    if (typeof next.volume === 'number' && isFinite(next.volume)) {
      current.volume = clampNumber(next.volume, 0, 1);
    }
    if (typeof next.fullscreen === 'boolean') {
      current.fullscreen = next.fullscreen;
    }

    render();
  }

  /** 读滑杆 → current。 */
  function readFromDom() {
    current.textSpeed = sliderToSpeed(parseInt(inputs.textSpeed.value, 10));
    current.autoDelay = sliderToDelay(parseInt(inputs.autoDelay.value, 10));
    current.volume = clampNumber(parseInt(inputs.volume.value, 10) / 100, 0, 1);
    current.fullscreen = !!inputs.fullscreen.checked;
  }

  function emitChanged() {
    if (typeof handlers.changed === 'function') {
      handlers.changed({
        textSpeed: current.textSpeed,
        autoDelay: current.autoDelay,
        volume: current.volume,
        fullscreen: current.fullscreen
      });
    }
  }

  function onInputChanged() {
    readFromDom();

    // 再渲染一次：滑杆的整数刻度换算成毫秒往往会落到两个刻度之间，
    // 这一句让数值标签（"29 字/秒"）显示的是**真正生效的值**，而不是滑杆位置暗示的值。
    // 因为换算是稳定的（毫秒 → 滑杆 → 毫秒 是不动点），这不会把滑杆弹来弹去。
    render();

    emitChanged();
  }

  function resetToDefaults() {
    current.textSpeed = DEFAULTS.textSpeed;
    current.autoDelay = DEFAULTS.autoDelay;
    current.volume = DEFAULTS.volume;
    current.fullscreen = DEFAULTS.fullscreen;

    render();
    emitChanged();
  }

  // ---------------------------------------------------------------
  // 显隐
  // ---------------------------------------------------------------

  function show() {
    render();

    dom.layer.classList.remove('hidden');

    // 让主菜单把卡片收起来。两层半透明卡片叠在一起会互相透出文字，看着很脏；
    // 留着 #menu-layer 当背景幕布，只藏卡片，就还是"设置盖在主菜单上"的层次感。
    // 这个类名对应 settings.css 里的 body.settings-open #menu-card。
    document.body.classList.add('settings-open');
  }

  function hide() {
    dom.layer.classList.add('hidden');
    document.body.classList.remove('settings-open');
  }

  function isVisible() {
    return !dom.layer.classList.contains('hidden');
  }

  function bind() {
    // 用 input 而不是只等 change：拖动滑杆时要实时生效，
    // change 要等松手才触发，调文字速度时没手感。
    Object.keys(inputs).forEach(function (key) {
      inputs[key].addEventListener('input', onInputChanged);
      inputs[key].addEventListener('change', onInputChanged);
    });

    document.getElementById('settings-reset').addEventListener('click', function (event) {
      event.stopPropagation();
      resetToDefaults();
    });

    document.getElementById('settings-back').addEventListener('click', function (event) {
      event.stopPropagation();
      if (typeof handlers.back === 'function') {
        handlers.back();
      }
    });
  }

  function init() {
    dom.layer = document.getElementById('settings-layer');

    inputs.textSpeed = document.getElementById('set-text-speed');
    inputs.autoDelay = document.getElementById('set-auto-delay');
    inputs.volume = document.getElementById('set-volume');
    inputs.fullscreen = document.getElementById('set-fullscreen');

    outputs.textSpeed = document.getElementById('out-text-speed');
    outputs.autoDelay = document.getElementById('out-auto-delay');
    outputs.volume = document.getElementById('out-volume');

    bind();
    render();
  }

  return {
    handlers: handlers,
    init: init,
    show: show,
    hide: hide,
    isVisible: isVisible,
    apply: apply,
    resetToDefaults: resetToDefaults,
    /** 当前设置的副本（只读用途）。 */
    get: function () {
      return {
        textSpeed: current.textSpeed,
        autoDelay: current.autoDelay,
        volume: current.volume,
        fullscreen: current.fullscreen
      };
    }
  };
})();
