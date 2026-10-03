using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
using VoltstroStudios.UnityWebBrowser.Core;

/// <summary>
/// 把"往 UWB 组件上补挂我们自己写的组件"这件事集中到一处。
///
/// ---------------------------------------------------------------------------
/// 为什么需要它：RuntimeInitializeOnLoadMethod 一次运行只跑一次
/// ---------------------------------------------------------------------------
/// WebUiServer / WebUiBridge / WebInputFix / WebSettingsChannel / WebSceneFlow
/// 原先各自用
///     [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
/// 自动挂载。这个特性**只在启动时触发一次**，只覆盖启动时的第一个场景。
///
/// 而本工程是运行时切场景：MainMenu --(点开始游戏)--> MainRoom。
/// 新场景里的 UWB 对象是**全新**的（BrowserController），老的那台连同挂在上面的
/// 组件一起被销毁，于是游戏场景里一个组件都没有 —— 网页因此跑在 standalone
/// （自己放本地 story.js）。表现上"能玩"，但 C# 那条链在游戏里是断的：
/// 继续游戏续读到存档步、章节跳跃、文字速度等设置下发，全都到不了游戏页。
///
/// ---------------------------------------------------------------------------
/// 做成"每次场景载入都补挂"之后，必须配的另一半在 WebUiBridge 里
/// ---------------------------------------------------------------------------
/// 一旦游戏场景也有了桥，C# 就会开始往这个页面推剧情 —— 而推早了会**静默丢掉**：
/// 引擎级就绪（ReadySignalReceived）只代表 CEF 进程起来了，网页脚本那时还没跑完，
/// 消息会被执行成 "Uncaught TypeError: window.__vnReceive is not a function"。
/// 实测过一次（只有挂载、没有闸门）：开场四条（握手 / story.load / 幕标题 / 第一句）
/// 全丢，玩家看到空白对话框、点一下直接到第二句。
/// 所以 `WebUiBridge` 的发送闸门加了"等网页自己发来的 ready"。
/// **这两件事是一套，动一个要连着看另一个。**
///
/// ---------------------------------------------------------------------------
/// 做法：挂 SceneManager.sceneLoaded
/// ---------------------------------------------------------------------------
/// 每个组件在自己的 AutoInstall 里调 Register(安装函数)：立即执行一次
/// （等价于原来的 AfterSceneLoad 行为，启动场景照旧），之后每次场景载入再执行一次。
///
/// sceneLoaded 在场景对象的 Awake/OnEnable 之后、Start 之前触发，
/// 而 UWB 是在 Start 里把 initialUrl 当命令行参数交给 CEF 引擎的 ——
/// 所以这时候改 initialUrl 仍然早于引擎读参数，页面不会先按 file:// 载一次。
/// 安装函数必须幂等：各组件内部本来就有 GetComponent&lt;T&gt;() != null 的判重。
/// </summary>
public static class UwbAutoInstall
{
    private static readonly List<Action> installers = new List<Action>();
    private static bool hooked;

    /// <summary>
    /// 注册一个安装函数：立即跑一次（覆盖启动场景），此后每次场景载入再跑一次。
    /// </summary>
    public static void Register(Action install)
    {
        if (install == null || installers.Contains(install))
        {
            return;
        }

        installers.Add(install);
        install();

        if (hooked)
        {
            return;
        }

        hooked = true;
        SceneManager.sceneLoaded += OnSceneLoaded;
    }

    /// <summary>
    /// 找到场景里所有 UWB 客户端管理器（含未激活的），给还没有 T 的那些补挂一个 T。
    /// 返回**找到的管理器个数**，方便调用方打诊断日志区分
    /// "根本没找到 UWB 组件" 和 "找到了但已经挂过"。
    /// </summary>
    public static int Attach<T>(string label) where T : Component
    {
        // 必须写全 UnityEngine.Object：这些文件同时 using System 和 UnityEngine，
        // 直接写 Object 会在 System.Object 和 UnityEngine.Object 之间产生 CS0104 歧义。
        var managers = UnityEngine.Object.FindObjectsByType<BaseUwbClientManager>(
            FindObjectsInactive.Include, FindObjectsSortMode.None);

        for (var i = 0; i < managers.Length; i++)
        {
            var manager = managers[i];
            if (manager == null || manager.GetComponent<T>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<T>();
            Debug.Log($"[{label}] 已挂到 “{manager.gameObject.name}” 上。");
        }

        return managers.Length;
    }

    private static void OnSceneLoaded(Scene scene, LoadSceneMode mode)
    {
        for (var i = 0; i < installers.Count; i++)
        {
            installers[i]();
        }
    }
}
