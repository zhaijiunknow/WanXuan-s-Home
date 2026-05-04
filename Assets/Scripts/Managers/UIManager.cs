using System;
using UnityEngine;

public class UIManager : MonoBehaviour
{
    [SerializeField] private DialogueUI dialogueUI;
    [SerializeField] private ChoiceUI choiceUI;
    [SerializeField] private EndingUI endingUI;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;

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
    }

    public void ShowDialogue(DialogueLine line, Action onAdvance)
    {
        HideChoices();
        HideEnding();

        if (dialogueUI == null || line == null)
        {
            return;
        }

        dialogueUI.ShowLine(line.SpeakerName, line.Content, onAdvance);
    }

    public void HideDialogue()
    {
        if (dialogueUI != null)
        {
            dialogueUI.SetVisible(false);
        }
    }

    public void ShowChoices(ChoiceOption[] choices, Action<int> onSelected)
    {
        HideDialogue();
        HideEnding();

        if (choiceUI == null)
        {
            return;
        }

        choiceUI.ShowChoices(choices, onSelected);
    }

    public void HideChoices()
    {
        if (choiceUI != null)
        {
            choiceUI.SetVisible(false);
        }
    }

    public void ShowEnding(string title, string message, Action onRestart)
    {
        HideDialogue();
        HideChoices();

        if (endingUI == null)
        {
            return;
        }

        endingUI.Show(title, message, onRestart);
    }

    public void HideEnding()
    {
        if (endingUI != null)
        {
            endingUI.SetVisible(false);
        }
    }
}
