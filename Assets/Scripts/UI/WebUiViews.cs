using System;
using UnityEngine;

/// <summary>
/// Web（HTML/WebView）侧的三个视图实现。
///
/// 它们只做两件事：
///   把 C# 的调用转成 JSON 信封发给网页；
///   把网页回报的消息转回 C# 回调。
/// 不持有任何剧情状态 —— 剧情始终由 StoryManager 权威持有。
///
/// 订阅采用"每帧确保订阅"的惰性写法：WebUiBridge 是 AutoInstall 在场景加载后创建的，
/// 而这些视图由 UIManager 创建，两者的先后顺序不保证，用惰性订阅可以完全避开时序问题。
/// </summary>
public class WebDialogueView : MonoBehaviour, IDialogueView
{
    private WebUiBridge subscribedBridge;
    private Action onAdvance;

    public void ShowLine(string speakerName, string content, Action onAdvance)
    {
        this.onAdvance = onAdvance;

        var payload = JsonUtility.ToJson(new ShowPayload
        {
            speaker = speakerName ?? string.Empty,
            content = content ?? string.Empty
        });

        Post("dialogue.show", payload);
    }

    public void SetVisible(bool visible)
    {
        Post(visible ? "ui.show" : "ui.hide", "{}");
    }

    private void Update()
    {
        EnsureSubscribed();
    }

    private void OnDestroy()
    {
        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived -= HandleMessage;
            subscribedBridge = null;
        }
    }

    private void EnsureSubscribed()
    {
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

    private void Post(string type, string payload)
    {
        var bridge = WebUiBridge.Instance;
        if (bridge != null)
        {
            bridge.Post(type, payload);
        }
    }

    private void HandleMessage(string json)
    {
        if (WebUiBridge.ReadType(json) != "dialogue.advance")
        {
            return;
        }

        var handler = onAdvance;
        onAdvance = null;
        handler?.Invoke();
    }

    [Serializable]
    private class ShowPayload
    {
        public string speaker;
        public string content;
    }
}

public class WebChoiceView : MonoBehaviour, IChoiceView
{
    private WebUiBridge subscribedBridge;
    private Action<int> onSelected;

    public void ShowChoices(ChoiceOption[] choices, Action<int> onSelected)
    {
        this.onSelected = onSelected;

        var safe = choices ?? Array.Empty<ChoiceOption>();
        var options = new OptionDto[safe.Length];
        for (var i = 0; i < safe.Length; i++)
        {
            options[i] = new OptionDto
            {
                label = safe[i] != null ? safe[i].Label : string.Empty,
                next = safe[i] != null ? safe[i].NextStepId : string.Empty
            };
        }

        Post("choice.show", JsonUtility.ToJson(new ShowPayload { choices = options }));
    }

    public void SetVisible(bool visible)
    {
        // 选项的显隐完全由 choice.show / choice.selected 驱动，这里不需要额外动作
    }

    private void Update()
    {
        EnsureSubscribed();
    }

    private void OnDestroy()
    {
        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived -= HandleMessage;
            subscribedBridge = null;
        }
    }

    private void EnsureSubscribed()
    {
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

    private void Post(string type, string payload)
    {
        var bridge = WebUiBridge.Instance;
        if (bridge != null)
        {
            bridge.Post(type, payload);
        }
    }

    private void HandleMessage(string json)
    {
        if (WebUiBridge.ReadType(json) != "choice.selected")
        {
            return;
        }

        WebUiBridge.ChoiceSelectedMessage message;
        try
        {
            message = JsonUtility.FromJson<WebUiBridge.ChoiceSelectedMessage>(json);
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"[WebChoiceView] choice.selected 解析失败：{exception.Message}");
            return;
        }

        if (message == null || message.payload == null)
        {
            return;
        }

        var handler = onSelected;
        onSelected = null;
        handler?.Invoke(message.payload.index);
    }

    [Serializable]
    private class OptionDto
    {
        public string label;
        public string next;
    }

    [Serializable]
    private class ShowPayload
    {
        public OptionDto[] choices;
    }
}

public class WebEndingView : MonoBehaviour, IEndingView
{
    private WebUiBridge subscribedBridge;
    private Action onRestart;

    public void Show(string title, string message, Action onRestart)
    {
        this.onRestart = onRestart;

        var payload = JsonUtility.ToJson(new ShowPayload
        {
            title = title ?? string.Empty,
            message = message ?? string.Empty
        });

        Post("ending.show", payload);
    }

    public void SetVisible(bool visible)
    {
        // 结局界面的显隐由 ending.show 驱动
    }

    private void Update()
    {
        EnsureSubscribed();
    }

    private void OnDestroy()
    {
        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived -= HandleMessage;
            subscribedBridge = null;
        }
    }

    private void EnsureSubscribed()
    {
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

    private void Post(string type, string payload)
    {
        var bridge = WebUiBridge.Instance;
        if (bridge != null)
        {
            bridge.Post(type, payload);
        }
    }

    private void HandleMessage(string json)
    {
        if (WebUiBridge.ReadType(json) != "ending.restart")
        {
            return;
        }

        var handler = onRestart;
        onRestart = null;
        handler?.Invoke();
    }

    [Serializable]
    private class ShowPayload
    {
        public string title;
        public string message;
    }
}

/// <summary>
/// 幕标题 / 场景标题的 Web 实现。
/// 只发不收，所以比另外三个视图简单：不需要订阅桥接消息。
/// 网页端 app.js 收到 marker.show 后会显示 #chapter-banner 并在 2.6 秒后淡出。
/// </summary>
public class WebMarkerView : MonoBehaviour, IMarkerView
{
    public void ShowMarker(string title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return;
        }

        var bridge = WebUiBridge.Instance;
        if (bridge == null)
        {
            return;
        }

        bridge.Post("marker.show", JsonUtility.ToJson(new ShowPayload { title = title }));
    }

    [Serializable]
    private class ShowPayload
    {
        public string title;
    }
}

// 主菜单 / 设置的 Web 视图**不在这里**。
//
// 它们曾经和上面这五个视图挤在同一个文件里，那是个错误：主菜单属于另一个场景
// （MainMenu），把它和"游戏进行中的内容视图"放在一起，等于默认菜单是游戏 UI 的一部分。
// 现在设置只走数据通道，没有"视图"这个概念：
//   Assets/Scripts/UI/UiSettings.cs          —— 设置的数据结构（跨场景共用）
//   Assets/Scripts/UI/UiSettingsStore.cs     —— 持久化与副作用
//   Assets/Scripts/UI/WebSettingsChannel.cs  —— 与网页的设置通道（自动挂载）
//   Assets/Scripts/UI/WebSceneFlow.cs        —— 主菜单 ⇄ 游戏 的场景流转（自动挂载）
// 主菜单页面的显示逻辑则完全在 WebUI/menu/ 里。
