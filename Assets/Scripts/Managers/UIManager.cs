using UnityEngine;

public class UIManager : MonoBehaviour
{
    [SerializeField] private DialogueUI dialogueUI;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
        dialogueUI.SetVisible(false);
    }

    public void ShowDialogue(DialogueLine line, System.Action onAdvance)
    {
        dialogueUI.ShowLine(line.SpeakerName, line.Content, onAdvance);
    }

    public void HideDialogue()
    {
        dialogueUI.SetVisible(false);
    }
}
