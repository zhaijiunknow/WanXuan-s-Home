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

    /// <summary>是否全屏。编辑器里不会真的切，见 UiSettingsStore.ApplyToUnity。</summary>
    public bool fullscreen;

    /// <summary>当前设置的副本。用来做"以谁为基线"的比较，避免把引用传出去被改坏。</summary>
    public UiSettings Clone()
    {
        return new UiSettings
        {
            textSpeed = textSpeed,
            autoDelay = autoDelay,
            volume = volume,
            fullscreen = fullscreen
        };
    }
}
