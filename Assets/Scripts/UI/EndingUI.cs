using System;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;
using TMPro;

public class EndingUI : MonoBehaviour
{
    [SerializeField] private GameObject root;
    [SerializeField] private TMP_Text titleText;
    [SerializeField] private TMP_Text messageText;
    [SerializeField] private Button restartButton;

    private UnityAction restartHandler;

    private void Awake()
    {
        if (restartButton != null)
        {
            restartButton.onClick.AddListener(HandleRestartClicked);
        }
    }

    private void OnDestroy()
    {
        if (restartButton != null)
        {
            restartButton.onClick.RemoveListener(HandleRestartClicked);
        }
    }

    public void Show(string title, string message, Action onRestart)
    {
        SetVisible(true);

        if (titleText != null)
        {
            titleText.text = title;
        }

        if (messageText != null)
        {
            messageText.text = message;
        }

        restartHandler = onRestart != null ? new UnityAction(onRestart) : null;
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

    private void HandleRestartClicked()
    {
        restartHandler?.Invoke();
    }
}
