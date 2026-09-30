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
