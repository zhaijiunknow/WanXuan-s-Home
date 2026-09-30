using System;
using UnityEngine;

/// <summary>
/// UI 后端。StoryManager 只跟 UIManager 打交道，不知道底层用的是哪一套。
/// </summary>
public enum UiBackend
{
    /// <summary>原生 Unity UI（DialogueUI / ChoiceUI / EndingUI）。</summary>
    Unity,

    /// <summary>HTML / WebView（WebDialogueView / WebChoiceView / WebEndingView）。</summary>
    Web
}

/// <summary>
/// UI 门面。对外只暴露"显示对话 / 选项 / 结局"，对内可以把调用转给任意一套实现。
///
/// 这是"HTML 前端"与"原生 UI"的切换点：
///   把 backend 设成 Web，界面就交给网页；设回 Unity，立刻回到原生实现。
/// 由于 StoryManager 从不直接接触具体视图类，切换不会碰到任何剧情逻辑。
///
/// 重要：本类必须留在 Assets/Scripts/Managers/UIManager.cs。
/// MainRoom 场景里的 UIManager 组件按本文件 .meta 的 GUID 绑定，把类挪到别的文件
/// 会让该组件变成 missing script。
/// </summary>
public class UIManager : MonoBehaviour
{
    [Header("后端")]
    [SerializeField] private UiBackend backend = UiBackend.Unity;

    [Header("原生 Unity UI")]
    [SerializeField] private DialogueUI dialogueUI;
    [SerializeField] private ChoiceUI choiceUI;
    [SerializeField] private EndingUI endingUI;

    [Header("Web UI（选 Web 后端时使用；留空会在运行时自动创建）")]
    [SerializeField] private WebDialogueView webDialogueUI;
    [SerializeField] private WebChoiceView webChoiceUI;
    [SerializeField] private WebEndingView webEndingUI;
    [SerializeField] private WebMarkerView webMarkerView;

    // Unity 无法在 Inspector 里序列化接口引用（[SerializeReference] 不支持
    // UnityEngine.Object 派生类型），所以每种实现各留一个具体字段，运行时挑一个赋给接口字段。
    // 接口字段的 != null 是引用比较（不走 UnityEngine.Object 的重载），
    // 对这些与场景同生命周期的对象来说正确且更可预测。
    private IDialogueView dialogueView;
    private IChoiceView choiceView;
    private IEndingView endingView;
    private IMarkerView markerView;

    private GameManager gameManager;

    public UiBackend Backend => backend;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;

        ResolveViews();
        HideInactiveBackend();

        if (dialogueView != null)
        {
            dialogueView.SetVisible(false);
        }

        if (choiceView != null)
        {
            choiceView.SetVisible(false);
        }

        if (endingView != null)
        {
            endingView.SetVisible(false);
        }
    }

    public void ShowDialogue(DialogueLine line, Action onAdvance)
    {
        HideChoices();
        HideEnding();

        if (dialogueView == null || line == null)
        {
            return;
        }

        dialogueView.ShowLine(line.SpeakerName, line.Content, onAdvance);
    }

    public void HideDialogue()
    {
        if (dialogueView != null)
        {
            dialogueView.SetVisible(false);
        }
    }

    public void ShowChoices(ChoiceOption[] choices, Action<int> onSelected)
    {
        HideDialogue();
        HideEnding();

        if (choiceView == null)
        {
            return;
        }

        choiceView.ShowChoices(choices, onSelected);
    }

    public void HideChoices()
    {
        if (choiceView != null)
        {
            choiceView.SetVisible(false);
        }
    }

    public void ShowEnding(string title, string message, Action onRestart)
    {
        HideDialogue();
        HideChoices();

        if (endingView == null)
        {
            return;
        }

        endingView.Show(title, message, onRestart);
    }

    public void HideEnding()
    {
        if (endingView != null)
        {
            endingView.SetVisible(false);
        }
    }

    /// <summary>
    /// 显示幕标题 / 场景标题。数据源是 StoryStep.MarkerTitle。
    /// 注意：Unity 后端下 markerView 为 null（原生界面本来就没有章节标题元素），
    /// 所以这里直接返回、什么也不做 —— 这是预期行为。
    /// </summary>
    public void ShowMarker(string title)
    {
        if (markerView == null || string.IsNullOrWhiteSpace(title))
        {
            return;
        }

        markerView.ShowMarker(title);
    }

    // 主菜单 / 设置**不在这里**。
    //
    // 它们曾经由本类持有，那是个错误：主菜单是一个独立场景（MainMenu），
    // 而本类活在游戏场景（MainRoom）里。让游戏场景的 UI 管理者去操心菜单，
    // 等于把两个场景的 UI 混在一起 —— 而这两套界面本来不该互相知道对方存在。
    //
    // 现在设置完全走数据通道，与本类无关：
    //   UiSettings.cs          —— 设置的数据结构（跨场景共用）
    //   UiSettingsStore.cs     —— 持久化与副作用（音量 / 全屏）
    //   WebSettingsChannel.cs  —— 与网页的 settings.request / settings.changed 通道
    //   WebSceneFlow.cs        —— 主菜单 ⇄ 游戏 的场景流转
    // 这四个都是自动挂载的，不需要在本类里做任何转发。

    /// <summary>运行时切换后端。切完会重新解析视图并收起另一套。</summary>
    public void SetBackend(UiBackend newBackend)
    {
        backend = newBackend;
        ResolveViews();
        HideInactiveBackend();
    }

    private void ResolveViews()
    {
        dialogueView = null;
        choiceView = null;
        endingView = null;
        markerView = null;

        if (backend == UiBackend.Web)
        {
            EnsureWebViews();

            if (webDialogueUI != null)
            {
                dialogueView = webDialogueUI;
            }

            if (webChoiceUI != null)
            {
                choiceView = webChoiceUI;
            }

            if (webEndingUI != null)
            {
                endingView = webEndingUI;
            }

            if (webMarkerView != null)
            {
                markerView = webMarkerView;
            }

            return;
        }

        if (dialogueUI != null)
        {
            dialogueView = dialogueUI;
        }

        if (choiceUI != null)
        {
            choiceView = choiceUI;
        }

        if (endingUI != null)
        {
            endingView = endingUI;
        }
    }

    /// <summary>
    /// Web 后端下，如果 Inspector 里没挂视图，就在本物体上自动创建。
    /// 这样不必往场景里手工加三个组件（也无法手写场景 YAML —— 新脚本的 GUID 要等 Unity 导入才知道）。
    /// </summary>
    private void EnsureWebViews()
    {
        if (webDialogueUI == null)
        {
            webDialogueUI = gameObject.AddComponent<WebDialogueView>();
        }

        if (webChoiceUI == null)
        {
            webChoiceUI = gameObject.AddComponent<WebChoiceView>();
        }

        if (webEndingUI == null)
        {
            webEndingUI = gameObject.AddComponent<WebEndingView>();
        }

        if (webMarkerView == null)
        {
            webMarkerView = gameObject.AddComponent<WebMarkerView>();
        }
    }

    /// <summary>
    /// 收起没在用的一套。否则切到 Web 后，场景里原有的原生 UI 仍会画在画面上，
    /// 变成两套界面叠在一起。
    /// </summary>
    private void HideInactiveBackend()
    {
        if (backend == UiBackend.Web)
        {
            if (dialogueUI != null)
            {
                dialogueUI.SetVisible(false);
            }

            if (choiceUI != null)
            {
                choiceUI.SetVisible(false);
            }

            if (endingUI != null)
            {
                endingUI.SetVisible(false);
            }

            return;
        }

        if (webDialogueUI != null)
        {
            webDialogueUI.SetVisible(false);
        }

        if (webChoiceUI != null)
        {
            webChoiceUI.SetVisible(false);
        }

        if (webEndingUI != null)
        {
            webEndingUI.SetVisible(false);
        }
    }
}
