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
        // 走 UwbAutoInstall：启动场景立即挂一次，之后每次场景载入再挂一次。
        // 换场景后必须重挂，否则新场景里网页改的设置（音量等）落不到 Unity。
        UwbAutoInstall.Register(Install);
    }

    private static void Install()
    {
        // 先确保设置读出来了。放这里而不是 Awake：安装点跑在场景里所有组件的
        // Awake 之后，AudioListener 一定已经存在，音量能立刻落到新场景上。
        UiSettingsStore.EnsureLoaded();

        UwbAutoInstall.Attach<WebSettingsChannel>("WebSettingsChannel");
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

        // 约定：网页每次都发完整的**全部**字段。这里不做"缺字段就保持原值"的推断 ——
        // JsonUtility 对缺失的 float 字段给的是 0，靠 0 判断"没发"会把文字速度
        // 悄悄改成 0 毫秒（瞬间出字）。缺字段的代价太大，不如约定必须齐全。
        //
        // 所以：往 UiSettings 加字段时，**这里必须一起加**。
        // 漏了的话它会被写成 0（bool 是 false），而且不报任何错 ——
        // 表现就是"立绘突然不见了"这种查半天查不到的地方。
        UiSettingsStore.ApplyFrom(new UiSettings
        {
            textSpeed = payload.textSpeed,
            autoDelay = payload.autoDelay,
            volume = payload.volume,
            bgmVolume = payload.bgmVolume,
            seVolume = payload.seVolume,
            voiceVolume = payload.voiceVolume,
            fullscreen = payload.fullscreen,
            portraitVisible = payload.portraitVisible,
            portraitBrightness = payload.portraitBrightness,
            portraitSaturation = payload.portraitSaturation,
            animusTheme = payload.animusTheme,
            animusThemeMode = payload.animusThemeMode
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
        public float bgmVolume;
        public float seVolume;

        /// <summary>
        /// 语音通道。**这一条必须和网页一起加**（见上面那段"往 UiSettings
        /// 加字段时这里必须一起加"）—— 只在 C# 加、网页没发的话，
        /// JsonUtility 给缺失的 float 是 **0**，于是每次改任何设置
        /// 都会把语音音量写成 0（= 静音，而且只有以后接上语音才看得出来）。
        /// </summary>
        public float voiceVolume;
        public bool fullscreen;
        public bool portraitVisible;
        public float portraitBrightness;
        public float portraitSaturation;

        /// <summary>
        /// 归档系统的配色主题。**字符串字段也必须在这里列出来** ——
        /// JsonUtility 对缺失字段给的是 null，漏了的话每次设置变更都会
        /// 把主题重置回默认值（而且不报错）。
        /// </summary>
        public string animusTheme;

        /// <summary>
        /// 主题模式：fixed / time / story。同上 —— 它也是字符串，
        /// 漏在这里的表现更隐蔽：主题每次都退回 fixed，
        /// 也就是"跟随时间/进度选了没用，重开就变回固定"。
        /// </summary>
        public string animusThemeMode;
    }

    [Serializable]
    private class ChangedMessage
    {
        public int v;
        public string type;
        public ChangedPayload payload;
    }
}
