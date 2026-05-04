using System;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;
using TMPro;

public class DialogueUI : MonoBehaviour
{
    [SerializeField] private GameObject root;
    [SerializeField] private TMP_Text nameText;
    [SerializeField] private TMP_Text dialogueText;
    [SerializeField] private Button advanceButton;

    private UnityAction advanceHandler;

    private void Awake()
    {
        if (advanceButton != null)
        {
            advanceButton.onClick.AddListener(HandleAdvanceClicked);
        }
    }

    private void OnDestroy()
    {
        if (advanceButton != null)
        {
            advanceButton.onClick.RemoveListener(HandleAdvanceClicked);
        }
    }

    public void ShowLine(string speakerName, string content, Action onAdvance)
    {
        SetVisible(true);

        if (nameText != null)
        {
            var hasSpeaker = !string.IsNullOrWhiteSpace(speakerName);
            nameText.gameObject.SetActive(hasSpeaker);
            nameText.text = speakerName;
        }

        if (dialogueText != null)
        {
            dialogueText.text = content;
        }

        advanceHandler = onAdvance != null ? new UnityAction(onAdvance) : null;
    }

    public void SetVisible(bool visible)
    {
        if (root != null)
        {
            root.SetActive(visible);
            return;
        }

        gameObject.SetActive(visible);
    }

    private void HandleAdvanceClicked()
    {
        advanceHandler?.Invoke();
    }
}
