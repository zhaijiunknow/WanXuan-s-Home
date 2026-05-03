using System.Collections.Generic;
using UnityEngine;

public class StoryManager : MonoBehaviour
{
    [SerializeField] private List<DialogueLine> openingLines = new();

    private GameManager gameManager;
    private int currentIndex = -1;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
    }

    public void PlayOpening()
    {
        if (openingLines.Count == 0)
        {
            return;
        }

        currentIndex = -1;
        Advance();
    }

    public void Advance()
    {
        currentIndex++;

        if (currentIndex >= openingLines.Count)
        {
            gameManager.UIManager.HideDialogue();
            return;
        }

        var line = openingLines[currentIndex];
        gameManager.EnvironmentManager.SetBackground(line.Background);
        gameManager.CharacterManager.SetExpression(line.ExpressionId);
        gameManager.AudioManager.PlaySe(line.SoundEffect);
        gameManager.UIManager.ShowDialogue(line, Advance);
    }
}
