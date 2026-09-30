/* ============================================================
   stage.js —— 1920x1080 画布等比缩放（布局原语）
   ------------------------------------------------------------
   游戏界面（index.html）和主菜单界面（menu/index.html）**都**链接这个文件。

   为什么它值得单独一个文件：
     两个界面的设计基准都是 1920x1080，页面上所有尺寸都按这个基准写死。
     等比缩放这件事必须逐字一致 —— 一旦两边算得不一样，同一个面板在两页上
     会有不同大小，而这种差异肉眼很难判断是谁错了。

   用法：
     页面里放一个 <div id="stage">，CSS 写死 width/height 1920/1080 + transform-origin: top left，
     然后：VNStage.fit(document.getElementById('stage'));
     窗口 resize 时再调一次。
   ============================================================ */

(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 1080;

  /**
   * 把画布等比缩放到当前窗口，并居中。
   * 取 width/height 两个比例里**较小**的那个（contain），保证整块画布都可见 ——
   * 宁可有黑边，也不要裁掉边缘的控件（裁掉的按钮点不到，是最糟的失败模式）。
   */
  function fit(element) {
    if (!element) {
      return;
    }

    var scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
    var scaledWidth = DESIGN_WIDTH * scale;
    var scaledHeight = DESIGN_HEIGHT * scale;

    element.style.transform = 'scale(' + scale + ')';
    element.style.left = Math.round((window.innerWidth - scaledWidth) / 2) + 'px';
    element.style.top = Math.round((window.innerHeight - scaledHeight) / 2) + 'px';
  }

  window.VNStage = {
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    fit: fit
  };
})();
