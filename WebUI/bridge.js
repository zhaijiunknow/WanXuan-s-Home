/* ============================================================
   bridge.js —— 与 Unity(C#) 的桥接层（协议，不含任何界面逻辑）
   ------------------------------------------------------------
   游戏界面（index.html）和主菜单界面（menu/index.html）**都**链接这个文件。

   为什么它是共用的：
     它是**协议**，不是 UI。信封格式、版本号、宿主探测、JS→C# 的四种发送方式，
     这些在两个界面里必须逐字一致 —— 复制成两份一定会漂移，
     而漂移的表现是"设置页能存、游戏页读不到"这种极难查的问题。

   为什么别的东西都不共用：
     菜单的 HTML/CSS/JS 和游戏的 HTML/CSS/JS 各自独立。两个界面永远不会
     同时出现在屏幕上（它们是两个场景），共用界面代码只会让归属变模糊。

   协议（版本号必须与 C# 的 WebUiBridge.BridgeVersion 一致）：
     C# → JS   { v:1, type:"…", payload:{…} }   经 window.__vnReceive 进入
     JS → C#   { v:1, type:"…", payload:{…} }   经 VNBridge.send 送出

   用法：
     VNBridge.send('menu.start', {});          // 发
     VNBridge.subscribe(function (type, payload) { ... });   // 收
     VNBridge.hasHost()                        // 页面上有没有宿主（初步判断）
     VNBridge.hostSpoken                       // C# 有没有真的开口（可靠判据）
   ============================================================ */

(function () {
  'use strict';

  /** 必须与 C# 的 WebUiBridge.BridgeVersion 一致。 */
  var VERSION = 1;

  var subscribers = [];

  /** C# 是否真的发来过消息。这是"谁在驱动剧情"唯一可靠的判据。 */
  var hostSpoken = false;

  /**
   * 页面上有没有 WebView 宿主。
   * 注意这只是**初步判断**：不同插件注入的全局名各不相同（UWB 是 uwb，
   * Vuplex 是 vuplex…），猜错会让 JS 和 C# 同时遍历剧情、互相打架。
   * 所以真正的判据是 hostSpoken —— 见 hostSpoken 的注释。
   */
  function hasHost() {
    return !!(window.uwb ||
              window.vuplex ||
              (window.chrome && window.chrome.webview) ||
              window.unityInstance);
  }

  /**
   * 发送一个消息信封。
   *
   * 依次尝试四种宿主；都不匹配就只打日志（说明正在纯浏览器里预览，
   * 此时"发出去没人接"是正常的，不该报错）。
   */
  function send(type, payload) {
    var message = JSON.stringify({
      v: VERSION,
      type: type,
      payload: payload || {}
    });

    // UnityWebBrowser (UWB)：它在页面里注入一个全局 uwb 对象。
    // 注意这不是 SendMessage：UWB 用自己的 "JS Methods" 机制，
    // C# 侧必须 browserClient.RegisterJsMethod<string>("OnWebMessage", 处理方法)，
    // 并且要把 jsMethodsEnable 设为 true（默认是关的，关了会抛 NotEnabledException）。
    // UWB 对方法有约束（必须返回 void、参数不支持数组、只支持基本类型与自定义对象），
    // 而我们统一只传一个 JSON 字符串，正好把全部约束绕开。
    if (window.uwb && typeof window.uwb.ExecuteJsMethod === 'function') {
      window.uwb.ExecuteJsMethod('OnWebMessage', message);
      return;
    }

    // Vuplex 3D WebView（Windows/macOS）
    if (window.vuplex && typeof window.vuplex.postMessage === 'function') {
      window.vuplex.postMessage(message);
      return;
    }

    // WebView2（Unity WebViewToolkit 等）
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
      window.chrome.webview.postMessage(message);
      return;
    }

    // gree/unity-webview 之类：SendMessage(对象名, 方法名, 参数)
    if (window.unityInstance && typeof window.unityInstance.SendMessage === 'function') {
      window.unityInstance.SendMessage('WebUiBridge', 'OnWebMessage', message);
      return;
    }

    console.log('[VN:bridge → C# 无宿主，仅记录] ' + message);
  }

  /**
   * 订阅来自 C# 的消息。
   * 处理函数签名：(type, payload, message) => void
   *
   * 每个订阅者都被单独 try/catch 包住：一个界面模块出错不应该让它之后的消息
   * 全部静默失效（那样排查起来会以为是 C# 没发）。
   */
  function subscribe(handler) {
    if (typeof handler === 'function') {
      subscribers.push(handler);
    }
  }

  /**
   * C# 侧通过 webView.ExecuteJs("window.__vnReceive('...')") 调用这里。
   * 参数可以是 JSON 字符串，也可以是已解析的对象。
   */
  window.__vnReceive = function (input) {
    var message;
    try {
      message = (typeof input === 'string') ? JSON.parse(input) : input;
    } catch (error) {
      console.error('[VN:bridge] 收到无法解析的消息：', input);
      return;
    }

    if (!message || !message.type) {
      return;
    }

    if (message.v !== VERSION) {
      console.warn('[VN:bridge] 协议版本不一致：收到 v' + message.v + '，期望 v' + VERSION +
                   '（C# 的 WebUiBridge.BridgeVersion 和 bridge.js 的 VERSION 必须相同）');
    }

    // 一旦 C# 主动开口，就说明剧情/菜单由它驱动。
    // 这个判据比"页面上有没有某个全局对象"可靠得多 —— 前者是事实，后者是猜测。
    hostSpoken = true;

    // hello 是**传输层**握手，不是界面消息，在这里消化掉，
    // 不下发给订阅者（否则每个界面都要写一句"忽略 hello"）。
    if (message.type === 'hello') {
      console.log('[VN:bridge] 收到 C# 握手。');
      return;
    }

    var payload = message.payload || {};

    for (var i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](message.type, payload, message);
      } catch (error) {
        console.error('[VN:bridge] 订阅者处理 “' + message.type + '” 时出错：', error);
      }
    }
  };

  window.VNBridge = {
    version: VERSION,
    hasHost: hasHost,
    send: send,
    subscribe: subscribe,
    get hostSpoken() { return hostSpoken; }
  };
})();
