using System;

/// <summary>
/// UI 视图接缝。
///
/// 存在的理由：UI 有两套实现——原生 Unity UI 和 HTML/WebView——而 StoryManager 不该知道
/// 用的是哪一套。UIManager 只依赖这三个接口，运行时决定接哪一个实现。
///
/// 代价极低：现有的 DialogueUI / ChoiceUI / EndingUI 的方法签名原本就与这三个接口一致，
/// 加上接口名即可，方法体一行都不用改。
///
/// 注意：Unity 无法在 Inspector 里直接序列化接口引用（[SerializeReference] 不支持
/// UnityEngine.Object 派生类型），所以 UIManager 必须为每种实现各留一个具体类型的字段，
/// 在运行时挑选。这是引擎限制，不是设计偷懒。
/// </summary>
public interface IDialogueView
{
    void ShowLine(string speakerName, string content, Action onAdvance);

    void SetVisible(bool visible);
}

public interface IChoiceView
{
    void ShowChoices(ChoiceOption[] choices, Action<int> onSelected);

    void SetVisible(bool visible);
}

public interface IEndingView
{
    void Show(string title, string message, Action onRestart);

    void SetVisible(bool visible);
}

/// <summary>
/// 幕标题 / 场景标题的显示通道。
///
/// 存在的理由：StoryStep.MarkerTitle 一直是被导入后从未被运行时消费的死数据 ——
/// StoryManager 执行 Marker 步骤时只调 Advance()，标题根本没人看。
/// 这个接口就是它唯一的消费点。
///
/// 原生 Unity UI 没有对应的实现（本来就没有章节标题这个界面元素），
/// 所以 Unity 后端下 markerView 为 null、ShowMarker 直接返回 —— 这是预期行为，不是漏做。
/// </summary>
public interface IMarkerView
{
    void ShowMarker(string title);
}

// 主菜单 / 设置的接口**不在这里**。
//
// 原因：那两块界面属于另一个场景（MainMenu），和这一组"游戏进行中的内容视图"
// 不是一回事。把它们放进同一个文件，就等于默认"菜单是游戏 UI 的一部分"，
// 而这正是要拆开的东西。设置的数据与通道在：
//   Assets/Scripts/UI/UiSettings.cs          —— 设置的数据结构（跨场景共用）
//   Assets/Scripts/UI/UiSettingsStore.cs     —— 持久化与副作用
//   Assets/Scripts/UI/WebSettingsChannel.cs  —— 与网页的设置通道（自动挂载）
//   Assets/Scripts/UI/WebSceneFlow.cs        —— 主菜单 ⇄ 游戏 的场景流转（自动挂载）
