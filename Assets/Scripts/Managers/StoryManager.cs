using System;
using System.Collections.Generic;
using UnityEngine;

public class StoryManager : MonoBehaviour
{
    [SerializeField] private StoryAsset openingStory;

    private readonly Dictionary<string, int> stepLookup = new();
    private GameManager gameManager;
    private StoryAsset currentStory;
    private int currentStepIndex = -1;

    public StoryAsset OpeningStory => openingStory;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
    }

    public void PlayOpening()
    {
        PlayStory(openingStory);
    }

    public void PlayStory(StoryAsset story)
    {
        gameManager.UIManager.HideEnding();

        if (story == null || story.Steps == null || story.Steps.Length == 0)
        {
            currentStory = null;
            currentStepIndex = -1;
            gameManager.UIManager.HideDialogue();
            gameManager.UIManager.HideChoices();
            return;
        }

        currentStory = story;
        BuildLookup(story);
        JumpToIndex(0);
    }

    public void RestartCurrentStory()
    {
        PlayStory(currentStory ?? openingStory);
    }

    public void Advance()
    {
        if (currentStory == null)
        {
            return;
        }

        var step = GetCurrentStep();
        if (step == null)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(step.NextStepId))
        {
            JumpToStep(step.NextStepId);
            return;
        }

        JumpToIndex(currentStepIndex + 1);
    }

    public void SelectChoice(int choiceIndex)
    {
        var step = GetCurrentStep();
        if (step == null || step.StepType != StoryStepType.Choice)
        {
            return;
        }

        var choices = step.Choices;
        if (choices == null || choiceIndex < 0 || choiceIndex >= choices.Length)
        {
            return;
        }

        var selected = choices[choiceIndex];
        if (selected == null || string.IsNullOrWhiteSpace(selected.NextStepId))
        {
            return;
        }

        JumpToStep(selected.NextStepId);
    }

    private void BuildLookup(StoryAsset story)
    {
        stepLookup.Clear();

        var steps = story.Steps;
        for (var i = 0; i < steps.Length; i++)
        {
            var step = steps[i];
            if (step == null || string.IsNullOrWhiteSpace(step.StepId))
            {
                continue;
            }

            stepLookup[step.StepId] = i;
        }
    }

    private StoryStep GetCurrentStep()
    {
        if (currentStory == null || currentStepIndex < 0 || currentStepIndex >= currentStory.Steps.Length)
        {
            return null;
        }

        return currentStory.Steps[currentStepIndex];
    }

    private void JumpToStep(string stepId)
    {
        if (string.IsNullOrWhiteSpace(stepId) || !stepLookup.TryGetValue(stepId, out var index))
        {
            FinishStory();
            return;
        }

        JumpToIndex(index);
    }

    private void JumpToIndex(int index)
    {
        if (currentStory == null || index < 0 || index >= currentStory.Steps.Length)
        {
            FinishStory();
            return;
        }

        currentStepIndex = index;
        ExecuteStep(currentStory.Steps[index]);
    }

    private void ExecuteStep(StoryStep step)
    {
        if (step == null)
        {
            FinishStory();
            return;
        }

        switch (step.StepType)
        {
            case StoryStepType.Dialogue:
            case StoryStepType.Narration:
                ShowDialogue(step.Dialogue);
                break;
            case StoryStepType.Marker:
                Advance();
                break;
            case StoryStepType.Choice:
                ShowChoice(step.Choices);
                break;
            case StoryStepType.End:
                ShowEnding(step.EndingTitle, step.EndingMessage);
                break;
            default:
                throw new ArgumentOutOfRangeException();
        }
    }

    private void ShowDialogue(DialogueLine line)
    {
        if (line == null)
        {
            Advance();
            return;
        }

        gameManager.EnvironmentManager.SetBackground(line.Background);
        gameManager.CharacterManager.SetExpression(line.ExpressionId);
        gameManager.AudioManager.PlaySe(line.SoundEffect);
        gameManager.UIManager.ShowDialogue(line, Advance);
    }

    private void ShowChoice(ChoiceOption[] choices)
    {
        gameManager.UIManager.ShowChoices(choices, SelectChoice);
    }

    private void ShowEnding(string title, string message)
    {
        gameManager.UIManager.ShowEnding(title, message, RestartCurrentStory);
    }

    private void FinishStory()
    {
        currentStepIndex = -1;
        gameManager.UIManager.ShowEnding("End", string.Empty, RestartCurrentStory);
    }
}
