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

    /// <summary>
    /// 当前正在播的剧本。暂停菜单的「记忆序列」要用它列出所有幕。
    /// 没在播任何剧本时是 null（比如刚进主菜单场景）。
    /// </summary>
    public StoryAsset CurrentStory => currentStory;

    /// <summary>
    /// 当前步骤在 CurrentStory.Steps 里的下标。**-1 表示还没开始播**。
    /// 暂停菜单用它判断哪一幕"已归档"、哪一幕"正在读取"。
    /// </summary>
    public int CurrentStepIndex => currentStepIndex;

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
        PlayStory(story, null);
    }

    /// <summary>
    /// 播放剧本。startStepId 非空时从该步骤开始（读档用），找不到就退回开头。
    ///
    /// 为什么做成参数而不是"先 PlayStory 再 JumpToStep"：那样会先把第 0 步
    /// 执行一遍（屏幕闪一下第一句台词）再跳到存档点，读档时观感很差。
    /// </summary>
    public void PlayStory(StoryAsset story, string startStepId)
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

        if (!string.IsNullOrWhiteSpace(startStepId) && stepLookup.ContainsKey(startStepId))
        {
            JumpToStep(startStepId);
            return;
        }

        JumpToIndex(0);
    }

    /// <summary>读档：从存档点继续。</summary>
    public void PlayFrom(string stepId)
    {
        PlayStory(openingStory, stepId);
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

        var step = currentStory.Steps[index];
        RememberProgress(step);
        ExecuteStep(step);
    }

    /// <summary>
    /// 记录进度。
    ///
    /// 挂在 JumpToIndex 上是因为它是**所有**步骤变化的唯一漏斗
    ///（Advance / SelectChoice / JumpToStep / 开场都经过它），
    /// 挂在这里就不可能有哪条路径漏存。
    ///
    /// 只记玩家能"看见并停留"的步骤：
    ///   Marker 会立刻自动 Advance（存了马上被下一步覆盖，没有意义）
    ///   End 存了会让「继续游戏」直接重播结局 —— 那不是玩家想要的继续点
    /// </summary>
    private void RememberProgress(StoryStep step)
    {
        if (step == null)
        {
            return;
        }

        if (step.StepType == StoryStepType.Dialogue ||
            step.StepType == StoryStepType.Narration ||
            step.StepType == StoryStepType.Choice)
        {
            StorySaveStore.Save(step.StepId);
        }
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
                // 幕标题 / 场景标题。这是 MarkerTitle 唯一的消费点 ——
                // 在此之前它只被导入、从未被运行时使用，属于死数据。
                gameManager.UIManager.ShowMarker(step.MarkerTitle);
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
