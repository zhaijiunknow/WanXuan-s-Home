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
        if (!playOnStart)
        {
            return;
        }

        storyManager.PlayOpening();
    }

    private void BindManagers()
    {
        storyManager.Initialize(this);
        characterManager.Initialize(this);
        uiManager.Initialize(this);
        audioManager.Initialize(this);
        environmentManager.Initialize(this);
    }
}
