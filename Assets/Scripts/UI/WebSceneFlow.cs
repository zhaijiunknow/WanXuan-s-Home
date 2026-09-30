using System;
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
    [SerializeField] private string storyTitle = "坠落凡间的头号食客";
    [SerializeField] private string storySubtitle = "皖萱的家";

    private WebUiBridge subscribedBridge;
    private bool menuGreeted;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        var managers = UnityEngine.Object.FindObjectsByType<BaseUwbClientManager>(
            FindObjectsInactive.Include, FindObjectsSortMode.None);

        for (var i = 0; i < managers.Length; i++)
        {
            var manager = managers[i];
            if (manager == null || manager.GetComponent<WebSceneFlow>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<WebSceneFlow>();
            Debug.Log($"[WebSceneFlow] 已挂到 “{manager.gameObject.name}” 上。");
        }
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
            subtitle = storySubtitle
        }));
    }

    private void HandleMessage(string json)
    {
        switch (WebUiBridge.ReadType(json))
        {
            case "menu.start":
                LoadScene(mainRoomSceneName);
                break;

            case "ui.menu":
                LoadScene(mainMenuSceneName);
                break;

            case "menu.quit":
                QuitGame();
                break;
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
    }
}
