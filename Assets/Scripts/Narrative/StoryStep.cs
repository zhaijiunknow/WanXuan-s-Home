using System;
using UnityEngine;

public enum StoryStepType
{
    Dialogue,
    Narration,
    Choice,
    End,
    Marker
}

[Serializable]
public class StoryStep
{
    [SerializeField] private string stepId;
    [SerializeField] private StoryStepType stepType = StoryStepType.Dialogue;
    [SerializeField] private DialogueLine dialogue;
    [SerializeField] private string nextStepId;
    [SerializeField] private string endingTitle = "End";
    [SerializeField] [TextArea(2, 4)] private string endingMessage;
    [SerializeField] private ChoiceOption[] choices = Array.Empty<ChoiceOption>();
    [SerializeField] private string markerTitle;
    [SerializeField] [TextArea(2, 6)] private string stageNote;

    public string StepId => stepId;
    public StoryStepType StepType => stepType;
    public DialogueLine Dialogue => dialogue;
    public string NextStepId => nextStepId;
    public string EndingTitle => endingTitle;
    public string EndingMessage => endingMessage;
    public ChoiceOption[] Choices => choices;
    public string MarkerTitle => markerTitle;
    public string StageNote => stageNote;
}
