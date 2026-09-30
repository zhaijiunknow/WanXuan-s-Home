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
    private const string PrefKeyFullscreen = "wanxuan.fullscreen";

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
            current.fullscreen = PlayerPrefs.GetInt(PrefKeyFullscreen, defaults.fullscreen ? 1 : 0) != 0;

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
        current.fullscreen = updated.fullscreen;

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
        current.fullscreen = defaults.fullscreen;

        ApplyToUnity();
        Save();
    }

    /// <summary>
    /// 把设置里真正会改变 Unity 状态的那两项落下去。
    /// 界面只管显示，副作用统一在这里做。
    /// </summary>
    public static void ApplyToUnity()
    {
        AudioListener.volume = Mathf.Clamp01(current.volume);

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

    private static void Clamp(UiSettings target)
    {
        target.textSpeed = Mathf.Clamp(target.textSpeed, 1f, 500f);
        target.autoDelay = Mathf.Clamp(target.autoDelay, 0f, 20000f);
        target.volume = Mathf.Clamp01(target.volume);
    }

    private static void Save()
    {
        PlayerPrefs.SetFloat(PrefKeyTextSpeed, current.textSpeed);
        PlayerPrefs.SetFloat(PrefKeyAutoDelay, current.autoDelay);
        PlayerPrefs.SetFloat(PrefKeyVolume, current.volume);
        PlayerPrefs.SetInt(PrefKeyFullscreen, current.fullscreen ? 1 : 0);
        PlayerPrefs.Save();
    }
}
