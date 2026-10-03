using System;

/// <summary>
/// 玩家可调的设置项。
///
/// 字段名与单位必须和 WebUI 里 `settings.apply` / `settings.changed` 的 payload
/// 一一对应 —— 两边共用同一份 JSON，字段名对不上就会静默失效
/// （JsonUtility 忽略未知字段，结果就是"设置改了但没保存"，而且不报任何错）。
///
/// 单位选择的原则：存物理量（毫秒、0..1）而不是界面量（滑杆刻度）。
/// 界面上"文字速度"是 0..100 的滑杆，但真正有意义的是"每字多少毫秒"，
/// 后者 C# 和 JS 都能直接用，不需要两边各维护一套换算。
///
/// 本类不属于任何场景 —— 主菜单场景和游戏场景都要用它，所以它是纯数据类，
/// 持久化与副作用在 UiSettingsStore 里。
/// </summary>
[Serializable]
public class UiSettings
{
    /// <summary>打字机每字间隔（毫秒）。越小越快。</summary>
    public float textSpeed = 34f;

    /// <summary>自动播放模式下，一句话读完后额外等待的毫秒数。</summary>
    public float autoDelay = 900f;

    /// <summary>主音量，0..1（直接作用到 AudioListener.volume）。</summary>
    public float volume = 1f;

    /// <summary>音乐通道，0..1。实际音量 = 主音量 × 本值（见 AudioManager.ApplyVolumes）。</summary>
    public float bgmVolume = 1f;

    /// <summary>音效通道，0..1。实际音量 = 主音量 × 本值。</summary>
    public float seVolume = 1f;

    /// <summary>
    /// 语音通道，0..1。实际音量 = 主音量 × 本值。
    ///
    /// **现在还没有语音资源**（剧本里只有【BGM】和音效），这个字段先接着 ——
    /// 「声音」页多一条「语音音量」，AudioManager 为它留了第三个 AudioSource
    /// （场景里没接就自己建一个，所以加这条通道**不需要动场景文件**）。
    ///
    /// 以后台词语音接进来时，**立绘的口型也从这条通道取幅度**：
    /// 只跟语音，不跟 BGM / 音效 —— 否则她会跟着背景音乐一直动嘴。
    /// </summary>
    public float voiceVolume = 1f;

    /// <summary>是否全屏。编辑器里不会真的切，见 UiSettingsStore.ApplyToUnity。</summary>
    public bool fullscreen;

    /// <summary>
    /// 归档系统（Animus）的配色主题：noon / evening / lamp / rain。
    ///
    /// 四套 = 客厅的四种光（午后晴 / 傍晚暖光 / 夜小灯 / 雨夜）。
    /// **默认「午后」**（noon）—— 第一次打开游戏看到的就是它：
    /// 剧本 1-1【场景】客厅 / 午后 / 晴，故事是从那束光开始的，
    /// 两个结局收束（5A-3 / 5B-3）也回到同一束光。
    /// 这个初值必须和 WebUI settings-module.js 里的 DEFAULT_THEME 一致。
    ///
    /// 存字符串而不是枚举：取值由 WebUI 那边定义，枚举一改名就得两边一起改；
    /// 字符串不认识时 UiSettingsStore.Clamp 会夹回默认值
    /// （旧的 warm / cream / dusk 就是这么被淘汰掉的）。
    ///
    /// 它**不影响 Unity 的任何状态** —— 只改网页里 #animus 的 data-theme。
    /// 放这里是为了和其它设置一样落进 PlayerPrefs（网页自己存不可靠）。
    /// </summary>
    public string animusTheme = "noon";

    /// <summary>
    /// 谁来决定用哪一套主题：fixed / time / story。
    ///
    ///   fixed  玩家在「界面主题」里自己挑（默认）
    ///   time   按本机时钟的一张**写死的时刻表**：
    ///          06:30–16:30 午后 / 16:30–18:30 傍晚 / 18:30–19:30 夜 /
    ///          19:30–05:30 雨夜 / 05:30–06:30 夜
    ///   story  按剧情现在读到的场景光照（剧本每一步都带 background，
    ///          场景描述里连"雨"都写了）
    ///
    /// **两种跟随模式算不出依据时，什么都不换 —— 沿用界面上正在用的那一套。**
    /// 不退回 animusTheme 也不退回出厂默认：读到雨夜那一段时屋子是雨夜，
    /// 这时进度临时拿不到，跳成别的颜色比不变更糟。
    /// C# 不参与这个判断，写在这里只是为了让读这份结构的人知道规矩；
    /// 真正的解析在 WebUI 的 settings-module.js（renderedTheme）。
    ///
    /// 同样只影响网页里的 #animus，不动 Unity 的任何状态。
    /// </summary>
    public string animusThemeMode = "fixed";

    /* ------------------------------------------------------------------
       下面三条只作用在**网页里的立绘**上（主菜单页右侧那位）。
       游戏页没有网页立绘，所以那一页的设置里不会出现「立绘」子页 ——
       字段仍然存在，只是没人读。这样两页共用同一份 UiSettings，
       不需要为"哪个场景有哪些设置"再维护第二张表。
       ------------------------------------------------------------------ */

    /// <summary>是否显示立绘。关掉之后右侧完全让给背景。</summary>
    public bool portraitVisible = true;

    /// <summary>立绘亮度，0.45..1.55（1 = 原样）。</summary>
    public float portraitBrightness = 1f;

    /// <summary>立绘饱和度，0..1.6（1 = 原样，0 = 黑白）。</summary>
    public float portraitSaturation = 1f;

    /// <summary>当前设置的副本。用来做"以谁为基线"的比较，避免把引用传出去被改坏。</summary>
    public UiSettings Clone()
    {
        return new UiSettings
        {
            textSpeed = textSpeed,
            autoDelay = autoDelay,
            volume = volume,
            bgmVolume = bgmVolume,
            seVolume = seVolume,
            voiceVolume = voiceVolume,
            fullscreen = fullscreen,
            animusTheme = animusTheme,
            animusThemeMode = animusThemeMode,
            portraitVisible = portraitVisible,
            portraitBrightness = portraitBrightness,
            portraitSaturation = portraitSaturation
        };
    }
}
