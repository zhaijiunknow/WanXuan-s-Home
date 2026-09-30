using System;
using UnityEngine;
using VoltstroStudios.UnityWebBrowser.Core;

/// <summary>
/// 设置的桥接通道。**两个场景共用同一个组件**，靠 AutoInstall 自动挂载。
///
/// 它回答两类消息：
///   settings.request  →  回一条 settings.apply（当前真值）
///   settings.changed  →  收下玩家的改动，钳制 / 落盘 / 作用到 Unity，再回一条 settings.apply 确认
///
/// 为什么做成"页面主动问"而不是"C# 主动推"：
///   主动推必须踩准"网页还没加载完 / 桥接还没连上"的时机，而这个时机在两个场景里
///   各不相同（主菜单场景几乎没有加载时间，游戏场景要等 StoryAsset）。改成页面加载完
///   自己问一句，时机问题就不存在了 —— 网页知道自己什么时候准备好了，C# 不用猜。
///
/// 挂载方式与 WebUiBridge / WebInputFix 一致：AfterSceneLoad 时找 UWB 组件，
/// 找到就挂上去。所以**任何**含 UWB 的场景都自动获得设置能力，不需要改场景 YAML。
/// </summary>
public class WebSettingsChannel : MonoBehaviour
{
    private WebUiBridge subscribedBridge;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        // 先确保设置读出来了。放这里而不是 Awake：AfterSceneLoad 跑在场景里所有
        // 组件的 Awake 之后，AudioListener 一定已经存在，音量能立刻落到新场景上。
        UiSettingsStore.EnsureLoaded();

        // 必须写全 UnityEngine.Object：本文件同时 using System 和 UnityEngine，
        // 直接写 Object 会在 System.Object 和 UnityEngine.Object 之间产生 CS0104 歧义。
        var managers = UnityEngine.Object.FindObjectsByType<BaseUwbClientManager>(
            FindObjectsInactive.Include, FindObjectsSortMode.None);

        for (var i = 0; i < managers.Length; i++)
        {
            var manager = managers[i];
            if (manager == null || manager.GetComponent<WebSettingsChannel>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<WebSettingsChannel>();
            Debug.Log($"[WebSettingsChannel] 已挂到 “{manager.gameObject.name}” 上。");
        }
    }

    /// <summary>把当前设置发给网页。网页的滑杆初值应当来自这里，而不是 HTML 上写死的默认值。</summary>
    public static void Push()
    {
        var bridge = WebUiBridge.Instance;
        if (bridge == null)
        {
            return;
        }

        // UiSettings 是顶层 [Serializable] 类，JsonUtility 直接支持。
        // 网页端同时接受 payload 和 payload.settings 两种形态。
        bridge.Post("settings.apply", JsonUtility.ToJson(UiSettingsStore.Current));
    }

    private void Update()
    {
        // 惰性订阅：WebUiBridge 也是 AutoInstall 建的，两个 AfterSceneLoad 回调的
        // 先后顺序没有保证。用"每帧确保订阅"就完全避开了时序问题（与 WebUiViews 同一套写法）。
        var bridge = WebUiBridge.Instance;
        if (bridge == subscribedBridge)
        {
            return;
        }

        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived -= HandleMessage;
        }

        subscribedBridge = bridge;

        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived += HandleMessage;
        }
    }

    private void OnDestroy()
    {
        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived -= HandleMessage;
            subscribedBridge = null;
        }
    }

    private void HandleMessage(string json)
    {
        switch (WebUiBridge.ReadType(json))
        {
            case "settings.request":
                Push();
                break;

            case "settings.changed":
                HandleChanged(json);
                break;
        }
    }

    private void HandleChanged(string json)
    {
        ChangedMessage message;
        try
        {
            message = JsonUtility.FromJson<ChangedMessage>(json);
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"[WebSettingsChannel] settings.changed 解析失败：{exception.Message}");
            return;
        }

        var payload = message != null ? message.payload : null;
        if (payload == null)
        {
            return;
        }

        // 约定：网页每次都发完整的四项。这里不做"缺字段就保持原值"的推断 ——
        // JsonUtility 对缺失的 float 字段给的是 0，靠 0 判断"没发"会把文字速度
        // 悄悄改成 0 毫秒（瞬间出字）。缺字段的代价太大，不如约定必须齐全。
        UiSettingsStore.ApplyFrom(new UiSettings
        {
            textSpeed = payload.textSpeed,
            autoDelay = payload.autoDelay,
            volume = payload.volume,
            fullscreen = payload.fullscreen
        });

        // 回一条确认。这不是多余的：界面上显示的是"44%"这种二次加工过的值，
        // 让 C# 把钳制后的真值发回去，界面才不会自己算出一套和存档不一致的数。
        // 网页收到 settings.apply 只会刷新显示、不会再回发，所以这个环不会自激。
        Push();
    }

    [Serializable]
    private class ChangedPayload
    {
        public float textSpeed;
        public float autoDelay;
        public float volume;
        public bool fullscreen;
    }

    [Serializable]
    private class ChangedMessage
    {
        public int v;
        public string type;
        public ChangedPayload payload;
    }
}
