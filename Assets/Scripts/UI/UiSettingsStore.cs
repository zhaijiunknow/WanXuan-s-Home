using System;
using UnityEngine;

/// <summary>
/// 设置的唯一权威，静态类。
///
/// 为什么是**静态**而不是 MonoBehaviour：主菜单是一个独立场景，游戏是另一个场景，
/// 两个场景里的组件互不相识，而设置必须跨场景是同一份。静态状态的寿命正好和
/// 这一局游戏一致 —— 够用，而且不需要 DontDestroyOnLoad 那套搬运。
///
/// 为什么不存网页的 localStorage：页面是 `file://` 加载的，各浏览器对 `file://`
/// 的 localStorage 处理不一致（有的按目录隔离、有的直接禁用），存档不能赌这个。
/// PlayerPrefs 是这里唯一可靠的位置。
///
/// 为什么副作用（音量 / 全屏）集中在这里而不是各自的界面里：
/// 界面会被换掉（HTML 换成原生 UI），存档和"真的改 Unity 状态"不应该跟着被换掉。
/// </summary>
public static class UiSettingsStore
{
    private const string PrefKeyTextSpeed = "wanxuan.text_speed";
    private const string PrefKeyAutoDelay = "wanxuan.auto_delay";
    private const string PrefKeyVolume = "wanxuan.volume";
    private const string PrefKeyBgmVolume = "wanxuan.bgm_volume";
    private const string PrefKeySeVolume = "wanxuan.se_volume";
    private const string PrefKeyVoiceVolume = "wanxuan.voice_volume";
    private const string PrefKeyFullscreen = "wanxuan.fullscreen";
    private const string PrefKeyAnimusTheme = "wanxuan.animus_theme";
    private const string PrefKeyAnimusThemeMode = "wanxuan.animus_theme_mode";
    private const string PrefKeyPortraitVisible = "wanxuan.portrait_visible";
    private const string PrefKeyPortraitBrightness = "wanxuan.portrait_brightness";
    private const string PrefKeyPortraitSaturation = "wanxuan.portrait_saturation";

    /// <summary>
    /// 设置变了。**跨场景**通知用。
    ///
    /// 存在的理由：设置面板在主菜单场景里，而 AudioSource 在游戏场景里，
    /// 两个场景的组件互不相识。没有这条事件，在那个场景改了音量，
    /// 这个场景的声音不会有任何变化 —— 而界面上看起来一切正常。
    ///
    /// 订阅方必须记得退订（见 AudioManager.OnDestroy）：静态事件的寿命
    /// 比场景长，不退订会攒下一堆已经被销毁的 MonoBehaviour。
    /// </summary>
    public static event Action Changed;

    /// <summary>默认值。顺带充当"恢复默认"的数据源，不要在这里直接改，改 UiSettings 的字段初值。</summary>
    private static readonly UiSettings defaults = new UiSettings();

    private static readonly UiSettings current = new UiSettings();

    private static bool loaded;

    public static UiSettings Current => current;

    /// <summary>
    /// 从 PlayerPrefs 读一次并作用到 Unity。重复调用是安全的（只会真正读一次）。
    /// 每个场景加载后都会调一次 —— 因为 AudioListener 是**每个场景**各一份的，
    /// 光在启动时设一次音量，换场景之后新场景的 AudioListener 会回到 1.0。
    /// </summary>
    public static void EnsureLoaded()
    {
        if (!loaded)
        {
            loaded = true;

            current.textSpeed = PlayerPrefs.GetFloat(PrefKeyTextSpeed, defaults.textSpeed);
            current.autoDelay = PlayerPrefs.GetFloat(PrefKeyAutoDelay, defaults.autoDelay);
            current.volume = PlayerPrefs.GetFloat(PrefKeyVolume, defaults.volume);
            current.bgmVolume = PlayerPrefs.GetFloat(PrefKeyBgmVolume, defaults.bgmVolume);
            current.seVolume = PlayerPrefs.GetFloat(PrefKeySeVolume, defaults.seVolume);
            current.voiceVolume = PlayerPrefs.GetFloat(PrefKeyVoiceVolume, defaults.voiceVolume);
            current.fullscreen = PlayerPrefs.GetInt(PrefKeyFullscreen, defaults.fullscreen ? 1 : 0) != 0;
            current.animusTheme = PlayerPrefs.GetString(PrefKeyAnimusTheme, defaults.animusTheme);
            current.animusThemeMode = PlayerPrefs.GetString(PrefKeyAnimusThemeMode, defaults.animusThemeMode);
            current.portraitVisible = PlayerPrefs.GetInt(PrefKeyPortraitVisible, defaults.portraitVisible ? 1 : 0) != 0;
            current.portraitBrightness = PlayerPrefs.GetFloat(PrefKeyPortraitBrightness, defaults.portraitBrightness);
            current.portraitSaturation = PlayerPrefs.GetFloat(PrefKeyPortraitSaturation, defaults.portraitSaturation);

            Clamp(current);
        }

        ApplyToUnity();
    }

    /// <summary>接受一份来自界面的设置：钳制 → 作用到 Unity → 落盘。</summary>
    public static void ApplyFrom(UiSettings updated)
    {
        if (updated == null)
        {
            return;
        }

        // 钳制放在这一层，不放在界面里：无论设置从哪来（网页滑杆、原生按钮、
        // 被手改坏的 PlayerPrefs），进到 current 的一定是合法值。
        current.textSpeed = updated.textSpeed;
        current.autoDelay = updated.autoDelay;
        current.volume = updated.volume;
        current.bgmVolume = updated.bgmVolume;
        current.seVolume = updated.seVolume;
        current.voiceVolume = updated.voiceVolume;
        current.fullscreen = updated.fullscreen;
        current.animusTheme = updated.animusTheme;
        current.animusThemeMode = updated.animusThemeMode;
        current.portraitVisible = updated.portraitVisible;
        current.portraitBrightness = updated.portraitBrightness;
        current.portraitSaturation = updated.portraitSaturation;

        Clamp(current);
        ApplyToUnity();
        Save();
    }

    /// <summary>恢复默认值并落盘。</summary>
    public static void ResetToDefaults()
    {
        current.textSpeed = defaults.textSpeed;
        current.autoDelay = defaults.autoDelay;
        current.volume = defaults.volume;
        current.bgmVolume = defaults.bgmVolume;
        current.seVolume = defaults.seVolume;
        current.voiceVolume = defaults.voiceVolume;
        current.fullscreen = defaults.fullscreen;
        current.animusTheme = defaults.animusTheme;
        current.animusThemeMode = defaults.animusThemeMode;
        current.portraitVisible = defaults.portraitVisible;
        current.portraitBrightness = defaults.portraitBrightness;
        current.portraitSaturation = defaults.portraitSaturation;

        ApplyToUnity();
        Save();
    }

    /// <summary>
    /// 把设置里真正会改变 Unity 状态的那几项落下去。
    /// 界面只管显示，副作用统一在这里做。
    /// </summary>
    public static void ApplyToUnity()
    {
        AudioListener.volume = Mathf.Clamp01(current.volume);

        // 分通道的音量落在 AudioManager 上（它持有 AudioSource，而且是每个场景一份），
        // 这里只负责"叫它一声"。
        Changed?.Invoke();

        // 编辑器里改 Screen.fullScreen 会把 Game 视图本身切成全屏，调试时非常碍事，
        // 所以只在构建出来的版本里真正切。
        if (Application.isEditor)
        {
            return;
        }

        if (Screen.fullScreen != current.fullscreen)
        {
            Screen.fullScreen = current.fullscreen;
        }
    }

    /// <summary>
    /// 界面主题的白名单。
    ///
    /// 四套 = 客厅的四种光（午后晴 / 傍晚暖光 / 夜小灯 / 雨夜），
    /// 对应剧本里四段不同的时间。
    ///
    /// **这是唯一的一份白名单。** 网页那边（animus/settings-module.js 的
    /// ROWS.options）必须和它一致 —— 不一致的表现是"在设置里选了主题，
    /// 重开又变回去"：网页把值报上来，这里认不出就当垃圾值丢掉、退回默认。
    /// 加第五套主题时**两个地方都要加**，还得在 animus.css 里补一块。
    ///
    /// 旧存档里存的 "warm" / "cream" / "dusk" 会走到"认不出"那条路，
    /// 自动退回默认值 —— 这是对的：那三套已经不存在了。
    /// </summary>
    private static readonly string[] AnimusThemes = { "noon", "evening", "lamp", "rain" };

    private static bool IsKnownAnimusTheme(string value)
    {
        if (string.IsNullOrEmpty(value)) { return false; }

        for (int i = 0; i < AnimusThemes.Length; i++)
        {
            if (AnimusThemes[i] == value) { return true; }
        }

        return false;
    }

    /// <summary>
    /// 主题模式：谁来决定用哪一套。
    ///
    /// fixed  玩家在「界面主题」里自己挑（默认）
    /// time   按本机时钟（白天 / 黄昏 / 夜里）
    /// story  按剧情现在读到的场景光照
    ///
    /// 和 AnimusThemes 一样，网页那边的 ROWS.options 必须和这张表一致。
    /// 认不出的值退回 fixed —— 而不是退回某一套主题：模式没了还能手挑，
    /// 模式串错了却当成主题用，表现就是"设置界面显示得莫名其妙"。
    /// </summary>
    private static readonly string[] AnimusThemeModes = { "fixed", "time", "story" };

    private static bool IsKnownAnimusThemeMode(string value)
    {
        if (string.IsNullOrEmpty(value)) { return false; }

        for (int i = 0; i < AnimusThemeModes.Length; i++)
        {
            if (AnimusThemeModes[i] == value) { return true; }
        }

        return false;
    }

    private static void Clamp(UiSettings target)
    {
        target.textSpeed = Mathf.Clamp(target.textSpeed, 1f, 500f);
        target.autoDelay = Mathf.Clamp(target.autoDelay, 0f, 20000f);
        target.volume = Mathf.Clamp01(target.volume);
        target.bgmVolume = Mathf.Clamp01(target.bgmVolume);
        target.seVolume = Mathf.Clamp01(target.seVolume);
        target.voiceVolume = Mathf.Clamp01(target.voiceVolume);
        target.portraitBrightness = Mathf.Clamp(target.portraitBrightness, 0.45f, 1.55f);
        target.portraitSaturation = Mathf.Clamp(target.portraitSaturation, 0f, 1.6f);

        // 主题只认下面表里那几个值。存档被手改成别的字符串时，界面不该跟着一起坏。
        if (!IsKnownAnimusTheme(target.animusTheme))
        {
            target.animusTheme = defaults.animusTheme;
        }

        if (!IsKnownAnimusThemeMode(target.animusThemeMode))
        {
            target.animusThemeMode = defaults.animusThemeMode;
        }
    }

    private static void Save()
    {
        PlayerPrefs.SetFloat(PrefKeyTextSpeed, current.textSpeed);
        PlayerPrefs.SetFloat(PrefKeyAutoDelay, current.autoDelay);
        PlayerPrefs.SetFloat(PrefKeyVolume, current.volume);
        PlayerPrefs.SetFloat(PrefKeyBgmVolume, current.bgmVolume);
        PlayerPrefs.SetFloat(PrefKeySeVolume, current.seVolume);
        PlayerPrefs.SetFloat(PrefKeyVoiceVolume, current.voiceVolume);
        PlayerPrefs.SetInt(PrefKeyFullscreen, current.fullscreen ? 1 : 0);
        // 主题可能是 null（旧存档 / 手改坏），落盘前兜一下
        PlayerPrefs.SetString(PrefKeyAnimusTheme, current.animusTheme ?? defaults.animusTheme);
        PlayerPrefs.SetString(PrefKeyAnimusThemeMode, current.animusThemeMode ?? defaults.animusThemeMode);
        PlayerPrefs.SetInt(PrefKeyPortraitVisible, current.portraitVisible ? 1 : 0);
        PlayerPrefs.SetFloat(PrefKeyPortraitBrightness, current.portraitBrightness);
        PlayerPrefs.SetFloat(PrefKeyPortraitSaturation, current.portraitSaturation);
        PlayerPrefs.Save();
    }
}
