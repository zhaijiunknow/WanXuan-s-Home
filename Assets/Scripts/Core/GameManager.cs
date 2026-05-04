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
