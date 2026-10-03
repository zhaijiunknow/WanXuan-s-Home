using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
using VoltstroStudios.UnityWebBrowser.Core;

/// <summary>
/// 场景流转：主菜单 ⇄ 游戏。
///
/// 关键设计：**这个组件在哪个场景都一样工作**，靠 AutoInstall 自动挂载，
/// 所以不需要在任何场景 YAML 里引用它的脚本 GUID。
/// 这一点很重要 —— 手写场景文件时引用一个"还没被 Unity 导入过"的脚本 GUID
/// 是做不到的（GUID 要等导入才知道），AutoInstall 正好绕开这个限制。
///
/// 它处理三条消息：
///   menu.start  →  载入游戏场景
///   ui.menu     →  载入主菜单场景（游戏里点「主菜单」）
///   menu.quit   →  退出游戏
/// 并在主菜单场景里主动下发一次 menu.show，把标题交给网页。
///
/// 标题写在字段初值里而不是 HTML 里：改标题不用碰前端。
/// 想让策划在 Inspector 里改，可以在主菜单场景里手工把本组件加到
/// UWB 物体上 —— AutoInstall 发现有现成的就不会再建一个，你就能编辑它了。
/// </summary>
public class WebSceneFlow : MonoBehaviour
{
    [Header("场景名（必须出现在 Build Settings 里，否则载入会失败）")]
    [SerializeField] private string mainMenuSceneName = "MainMenu";
    [SerializeField] private string mainRoomSceneName = "MainRoom";

    [Header("主菜单文案（下发到网页，网页里不写死）")]
    [SerializeField] private string storyTitle = "甜味的坠落";
    [SerializeField] private string storySubtitle = "皖萱的家";

    private WebUiBridge subscribedBridge;
    private bool menuGreeted;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        // 走 UwbAutoInstall：启动场景立即挂一次，之后每次场景载入再挂一次。
        // 本组件是切场景的发起方，它在不在直接决定能不能回到主菜单。
        UwbAutoInstall.Register(() => UwbAutoInstall.Attach<WebSceneFlow>("WebSceneFlow"));
    }

    private void Update()
    {
        EnsureSubscribed();
        GreetMenuOnce();
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

    /// <summary>
    /// 主菜单场景里下发一次 menu.show。
    /// 网页自己也有一份兜底标题，所以菜单不会因为这条消息晚到而空着 ——
    /// 这条消息只是把"最终文案"的权威交回 C#。
    /// </summary>
    private void GreetMenuOnce()
    {
        if (menuGreeted || subscribedBridge == null)
        {
            return;
        }

        if (SceneManager.GetActiveScene().name != mainMenuSceneName)
        {
            return;
        }

        menuGreeted = true;
        subscribedBridge.Post("menu.show", JsonUtility.ToJson(new MenuPayload
        {
            title = storyTitle,
            subtitle = storySubtitle,
            // 让网页知道「继续游戏」能不能点。存档的有无只有 C# 知道
            //（PlayerPrefs），网页不该自己去猜。
            hasSave = StorySaveStore.HasSave
        }));
    }

    private void HandleMessage(string json)
    {
        switch (WebUiBridge.ReadType(json))
        {
            case "menu.start":
                LoadScene(mainRoomSceneName);
                break;

            // 「继续游戏」：把存档点交接给游戏场景，再切过去。
            // 不在这里直接跳步 —— 剧情推进归 StoryManager，本组件只管场景。
            case "menu.continue":
                if (!StorySaveStore.HasSave)
                {
                    Debug.LogWarning("[WebSceneFlow] 收到 menu.continue 但没有存档，忽略。");
                    break;
                }

                StorySaveStore.PendingResumeStepId = StorySaveStore.SavedStepId;
                LoadScene(mainRoomSceneName);
                break;

            case "ui.menu":
                LoadScene(mainMenuSceneName);
                break;

            // 章节跳跃：从章节选择那条时间线上点某一段，从那里接着读。
            //
            // 复用「继续游戏」那一套交接：把目标 stepId 放进 StorySaveStore
            // 的待续位，换到游戏场景后由 GameManager.StartStory() 取走并
            // PlayFrom。**不在这里直接跳步** —— 剧情推进归 StoryManager。
            case "menu.chapter":
            case "story.jump":
                var target = ReadStepId(json);
                if (string.IsNullOrEmpty(target))
                {
                    Debug.LogWarning("[WebSceneFlow] 章节跳跃没带 stepId，忽略。");
                    break;
                }

                StorySaveStore.PendingResumeStepId = target;
                LoadScene(mainRoomSceneName);
                break;

            case "menu.quit":
                QuitGame();
                break;

            // 暂停菜单的「记忆序列」。网页在 bridge 模式下**没有剧本**
            // （C# 一步步推），所以进度这东西只能由这边算好发过去。
            case "story.progress.request":
                PostProgress();
                break;
        }
    }

    /// <summary>
    /// 把整条剧情按"幕"（Marker 步）列出来，每幕标上 done / current / locked。
    ///
    /// 状态在**这一层**判定而不是在网页里：网页拿到的应该是一张已经算好的表，
    /// 它只需要画出来 —— 这是本项目一贯的分工（C# 是权威，JS 是哑视图）。
    ///
    /// 判据是"幕的起始下标 vs 当前步下标"：
    ///   起始下标 &lt; 当前 → 已经走过（done）
    ///   最后一个起始下标 ≤ 当前 → 正在读这一幕（current）
    ///   其余 → 还没解锁（locked）
    ///
    /// 注意这里**不区分周目**：走分支结局时，"另一条分支的那一幕"仍会被算成
    /// locked，这是对的（这一周目确实没读到）。以后要做全收集图鉴，
    /// 得另外记一份跨周目的已读集合。
    /// </summary>
    private void PostProgress()
    {
        var manager = FindStoryManager();

        if (manager == null || manager.CurrentStory == null || manager.CurrentStory.Steps == null)
        {
            // 主动发一条空表，而不是不回。不回的话网页会一直停在"正在读取"
            // 直到超时 —— 那 1 秒多的空白看着像卡住了。
            //
            // **但空表也要把存档锚点带上。** 主菜单场景永远走这一条：
            // 没有锚点的话网页只能把每一章都当成"没进度"，
            // 于是章名全露（章节页就在主菜单里，等于开局剧透）。
            // 有了锚点，读过的章才写得出名字，没读到的显示「???」。
            Post("story.progress", JsonUtility.ToJson(new ProgressPayload
            {
                savedStepId = StorySaveStore.SavedStepId
            }));
            return;
        }

        var steps = manager.CurrentStory.Steps;
        var currentIndex = manager.CurrentStepIndex;

        var markers = new List<int>();
        for (var i = 0; i < steps.Length; i++)
        {
            if (steps[i] != null && steps[i].StepType == StoryStepType.Marker)
            {
                markers.Add(i);
            }
        }

        // 当前所在的幕 = 最后一个"起始下标不晚于当前步"的 marker
        var activeMarker = -1;
        for (var i = 0; i < markers.Count; i++)
        {
            if (currentIndex >= 0 && markers[i] <= currentIndex)
            {
                activeMarker = i;
            }
        }

        var payload = new ProgressPayload { savedStepId = StorySaveStore.SavedStepId };
        for (var i = 0; i < markers.Count; i++)
        {
            var step = steps[markers[i]];

            payload.chapters.Add(new ChapterPayload
            {
                id = step.StepId,
                title = string.IsNullOrEmpty(step.MarkerTitle) ? step.StepId : step.MarkerTitle,
                state = i < activeMarker ? "done" : (i == activeMarker ? "current" : "locked")
            });
        }

        payload.progress = steps.Length > 0 && currentIndex >= 0
            ? (float)currentIndex / steps.Length
            : 0f;

        Post("story.progress", JsonUtility.ToJson(payload));
    }

    /// <summary>
    /// 找当前场景里的 StoryManager。
    ///
    /// 每一帧都找一次是可以接受的：只有玩家打开暂停菜单时才会走到这里，
    /// 而且 FindFirstObjectByType 在只有一个 GameManager 的场景里很便宜。
    /// 不做缓存是因为场景切换后旧引用会变成已销毁对象，缓存反而容易留坑。
    /// </summary>
    private static StoryManager FindStoryManager()
    {
        var gameManager = UnityEngine.Object.FindFirstObjectByType<GameManager>();
        return gameManager != null ? gameManager.StoryManager : null;
    }

    private void Post(string type, string payloadJson)
    {
        if (subscribedBridge != null)
        {
            subscribedBridge.Post(type, payloadJson);
        }
    }

    /// <summary>
    /// 从桥接消息里取 payload.stepId。
    ///
    /// 单独抽出来而不是顺手 FromJson 一个匿名类：这条消息是**网页主动发**的，
    /// 解析失败时我们要能安静地忽略（并且打一条警告），而不是抛在半路上 ——
    /// 抛出去会把这个事件里其它的订阅者一起打断。
    /// </summary>
    private static string ReadStepId(string json)
    {
        try
        {
            var message = JsonUtility.FromJson<JumpMessage>(json);
            return message != null && message.payload != null ? message.payload.stepId : null;
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"[WebSceneFlow] 章节跳跃消息解析失败：{exception.Message}");
            return null;
        }
    }

    private void LoadScene(string sceneName)
    {
        if (string.IsNullOrWhiteSpace(sceneName))
        {
            return;
        }

        if (SceneManager.GetActiveScene().name == sceneName)
        {
            // 已经在这个场景里了。重复 LoadScene 会把当前进度洗掉，
            // 而"点主菜单时正好在主菜单"是完全可能的（连点两下）。
            return;
        }

        // 场景名写错或没加进 Build Settings 时，LoadScene 会抛异常且很难看出原因。
        // 这里先检查一次，给一条能直接照做的报错。
        if (!Application.CanStreamedLevelBeLoaded(sceneName))
        {
            Debug.LogError(
                $"[WebSceneFlow] 载入 “{sceneName}” 失败：该场景不在 Build Settings 里。" +
                "请打开 File > Build Profiles（或 Build Settings）把场景加进去。");
            return;
        }

        Debug.Log($"[WebSceneFlow] 载入场景 “{sceneName}”。");
        SceneManager.LoadScene(sceneName);
    }

    private void QuitGame()
    {
#if UNITY_EDITOR
        // 编辑器里 Application.Quit() 是空操作，停止播放才是"退出"该有的表现
        UnityEditor.EditorApplication.isPlaying = false;
#else
        Application.Quit();
#endif
    }

    [Serializable]
    private class MenuPayload
    {
        public string title;
        public string subtitle;

        /// <summary>有没有存档。网页用它决定「继续游戏」是可用还是灰着。</summary>
        public bool hasSave;
    }

    /// <summary>
    /// 暂停菜单「记忆序列」的数据。
    ///
    /// 字段名必须和 WebUI 里 memory-module.js 读的完全一致 ——
    /// 那边同时接受 id / Id 两种写法，但新增字段时别指望这个兜底。
    /// JsonUtility 不会序列化空 List，所以 chapters 一定要 new 出来。
    /// </summary>
    [Serializable]
    private class ProgressPayload
    {
        public List<ChapterPayload> chapters = new List<ChapterPayload>();
        public float progress;

        /// <summary>
        /// 存档停在哪一个 stepId 上（没有存档就是空串）。
        ///
        /// **主菜单场景全靠它。** 那个场景里没有 StoryManager（剧本在游戏场景里），
        /// 上面那张表根本算不出来 —— 但 PlayerPrefs 里的存档是随时读得到的。
        /// 网页手里本来就有完整剧本（WebUI/story.js），拿到这个锚点就能自己
        /// 查出来"哪几章读过了、哪几章没读到"。
        ///
        /// 权威没有转移：**C# 权威的是"读到哪了"这个事实**，
        /// 网页只是把这个事实翻译成一张表。
        /// </summary>
        public string savedStepId;
    }

    [Serializable]
    private class ChapterPayload
    {
        public string id;
        public string title;

        /// <summary>done / current / locked</summary>
        public string state;
    }

    /// <summary>章节跳跃：menu.chapter / story.jump，payload 只有一个 stepId。</summary>
    [Serializable]
    private class JumpMessage
    {
        public int v;
        public string type;
        public JumpPayload payload;
    }

    [Serializable]
    private class JumpPayload
    {
        public string stepId;
    }
}
