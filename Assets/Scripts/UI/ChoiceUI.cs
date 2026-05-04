using System;
using UnityEngine;
using TMPro;
using UnityEngine.UI;

public class ChoiceUI : MonoBehaviour
{
    [SerializeField] private GameObject root;
    [SerializeField] private TMP_Text promptText;
    [SerializeField] private Button[] optionButtons;
    [SerializeField] private TMP_Text[] optionLabels;

    private Action<int> onSelected;

    public void ShowChoices(ChoiceOption[] choices, Action<int> callback)
    {
        onSelected = callback;
        SetVisible(true);

        if (promptText != null)
        {
            promptText.text = string.Empty;
        }

        var safeChoices = choices ?? Array.Empty<ChoiceOption>();
        for (var i = 0; i < optionButtons.Length; i++)
        {
            var button = optionButtons[i];
            if (button == null)
            {
                continue;
            }

            var isActive = i < safeChoices.Length && safeChoices[i] != null;
            button.gameObject.SetActive(isActive);
            button.onClick.RemoveAllListeners();

            if (!isActive)
            {
                continue;
            }

            var index = i;
            button.onClick.AddListener(() => HandleSelected(index));

            if (optionLabels != null && i < optionLabels.Length && optionLabels[i] != null)
            {
                optionLabels[i].text = safeChoices[i].Label;
            }
        }
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

    private void HandleSelected(int index)
    {
        onSelected?.Invoke(index);
    }
}
