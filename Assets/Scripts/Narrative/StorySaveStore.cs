using UnityEngine;

/// <summary>
/// 剧情存档。**单一存档位**（自动存档），静态类。
///
/// ---------------------------------------------------------------------------
/// 为什么只有一个槽位
/// ---------------------------------------------------------------------------
/// 这是一部短篇 VN（约 100–120 分钟），玩家不会同时开好几条线。
/// 业界同类短篇 VN 的惯例就是"一个继续游戏"，多槽位带来的存档界面、
/// 覆盖确认、时间戳这些成本换不来多少价值。
/// 真要多槽位，把 PrefKey 里加上槽位号即可，接口形状不用改。
///
/// ---------------------------------------------------------------------------
/// 为什么是静态类
/// ---------------------------------------------------------------------------
/// 存档要跨场景：主菜单场景读它来决定「继续游戏」能不能点，
/// 游戏场景写它。两个场景里的 MonoBehaviour 互不相识，
/// 而静态状态的寿命正好是这一局游戏 —— 和 UiSettingsStore 同一个理由。
///
/// 存 PlayerPrefs，不存网页 localStorage：理由同 UiSettingsStore
/// （页面是 file:// 加载的，localStorage 不可靠）。
/// </summary>
public static class StorySaveStore
{
    private const string PrefKeyStepId = "wanxuan.save_step_id";

    /// <summary>
    /// 主菜单点「继续游戏」时设置，游戏场景启动时读走并清空。
    ///
    /// 为什么不直接让游戏场景去读 SavedStepId：那样"重新开始游戏"也会
    /// 从存档点开始 —— 因为游戏场景无法区分"我是被继续游戏叫起来的"还是
    /// "我是被开始游戏叫起来的"。用一个一次性的交接变量把这个意图显式传过去，
    /// 两个入口就不会互相污染。
    /// </summary>
    public static string PendingResumeStepId;

    /// <summary>存档里的步骤 id（没有存档时是空串）。</summary>
    public static string SavedStepId => PlayerPrefs.GetString(PrefKeyStepId, string.Empty);

    /// <summary>有没有可继续的存档。「继续游戏」按钮靠它决定可不可点。</summary>
    public static bool HasSave => !string.IsNullOrEmpty(SavedStepId);

    /// <summary>记录当前进度。</summary>
    public static void Save(string stepId)
    {
        if (string.IsNullOrWhiteSpace(stepId))
        {
            return;
        }

        PlayerPrefs.SetString(PrefKeyStepId, stepId);
        PlayerPrefs.Save();
    }

    /// <summary>清空存档（通关、或玩家主动重开时调用）。</summary>
    public static void Clear()
    {
        PlayerPrefs.DeleteKey(PrefKeyStepId);
        PlayerPrefs.Save();
        PendingResumeStepId = null;
    }

    /// <summary>取出并清空"要继续到哪一步"的交接值。取完就必须清，否则下一次开始游戏也会续上。</summary>
    public static string ConsumePendingResume()
    {
        var stepId = PendingResumeStepId;
        PendingResumeStepId = null;
        return stepId;
    }
}
