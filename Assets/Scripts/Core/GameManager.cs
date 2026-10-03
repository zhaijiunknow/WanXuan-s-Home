using System.Collections;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    [Header("Managers")]
    [SerializeField] private StoryManager storyManager;
    [SerializeField] private CharacterManager characterManager;
    [SerializeField] private UIManager uiManager;
    [SerializeField] private AudioManager audioManager;
    [SerializeField] private EnvironmentManager environmentManager;

    [Header("Startup")]
    [SerializeField] private bool playOnStart = true;

    public StoryManager StoryManager => storyManager;
    public CharacterManager CharacterManager => characterManager;
    public UIManager UIManager => uiManager;
    public AudioManager AudioManager => audioManager;
    public EnvironmentManager EnvironmentManager => environmentManager;

    private void Awake()
    {
        BindManagers();
    }

    private void Start()
    {
        if (!playOnStart || storyManager == null)
        {
            return;
        }

        StartCoroutine(StartStoryAfterTransition());
    }

    /// <summary>
    /// 等过场演完再开始剧情 —— 也就是"**色块全部消失之后**才开始加载剧本"。
    ///
    /// 为什么必须在这儿等，而不是让它照常开始、只把画面挡着：
    /// 剧情一开跑就会往网页推 story.load / dialogue.show，那些内容在过场期间
    /// 是藏在色块底下的 —— 等色块退完，第一句可能已经播到一半了。
    /// 所以要让**剧本本身**晚一步开始，而不是让画面晚一步露出来。
    ///
    /// 另外这里用协程而不是直接调：StartStory 会"取走并清空"一次性的续玩点
    /// （StorySaveStore.PendingResumeStepId），而过场那边要用同一个续玩点去推
    /// "这次进的是哪一幕"（见 ChapterTransition.ChapterKeyForEntry）——
    /// 必须等它读完，否则章节配方会认成第一幕。过场不存在时 IsBusy 恒为 false，
    /// 所以直接开 MainRoom 的场景照常立刻开始。
    /// </summary>
    private IEnumerator StartStoryAfterTransition()
    {
        while (ChapterTransition.IsBusy)
        {
            yield return null;
        }

        StartStory();
    }

    /// <summary>
    /// 开始剧情。公开出来是为了让"非自动开始"的入口复用同一条路径
    /// （调试快捷键、以后的读档、章节跳转）。
    ///
    /// 注意这里**没有**主菜单逻辑：主菜单是另一个场景（MainMenu），
    /// 由 WebSceneFlow 负责载入本场景，本类不需要知道菜单存在过。
    /// </summary>
    public void StartStory()
    {
        if (storyManager == null)
        {
            return;
        }

        // 主菜单点「继续游戏」时会留下一个一次性的续玩点
        //（StorySaveStore.PendingResumeStepId）。这里用"取走并清空"的语义，
        // 所以「开始游戏」走同一个入口也不会意外续上旧进度。
        var resumeStepId = StorySaveStore.ConsumePendingResume();

        if (!string.IsNullOrWhiteSpace(resumeStepId))
        {
            storyManager.PlayFrom(resumeStepId);
            return;
        }

        storyManager.PlayOpening();
    }

    private void BindManagers()
    {
        if (storyManager != null)
        {
            storyManager.Initialize(this);
        }

        if (characterManager != null)
        {
            characterManager.Initialize(this);
        }

        if (uiManager != null)
        {
            uiManager.Initialize(this);
        }

        if (audioManager != null)
        {
            audioManager.Initialize(this);
        }

        if (environmentManager != null)
        {
            environmentManager.Initialize(this);
        }
    }
}
