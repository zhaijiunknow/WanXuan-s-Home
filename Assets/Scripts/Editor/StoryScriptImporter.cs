using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;

public static class StoryScriptImporter
{
    private const string SourcePath = "D:/Unity/Project/WanXuan-s-Home/完整剧本_长篇版.txt";
    private const string AssetPath = "Assets/Data/Story/WanXuanLongStory.asset";

    [MenuItem("WanXuan/Import Long Story")]
    public static void ImportLongStory()
    {
        if (!File.Exists(SourcePath))
        {
            Debug.LogError($"Story source not found: {SourcePath}");
            return;
        }

        EnsureFolder("Assets/Data");
        EnsureFolder("Assets/Data/Story");

        var importResult = StoryScriptParser.ParseFromFile(SourcePath);
        var asset = AssetDatabase.LoadAssetAtPath<StoryAsset>(AssetPath);
        if (asset == null)
        {
            asset = ScriptableObject.CreateInstance<StoryAsset>();
            AssetDatabase.CreateAsset(asset, AssetPath);
        }

        SetField(asset, "storyId", "wanxuan_long_story");
        SetField(asset, "storyTitle", "坠落凡间的头号食客");
        SetField(asset, "steps", BuildSteps(importResult));

        EditorUtility.SetDirty(asset);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log($"Imported story to {AssetPath} with {importResult.Steps.Count} steps.");
    }

    private static StoryStep[] BuildSteps(StoryImportResult result)
    {
        var steps = new StoryStep[result.Steps.Count];
        for (var i = 0; i < result.Steps.Count; i++)
        {
            var imported = result.Steps[i];
            var step = new StoryStep();
            SetField(step, "stepId", imported.StepId);
            SetField(step, "stepType", imported.StepType);
            SetField(step, "nextStepId", imported.NextStepId ?? string.Empty);
            SetField(step, "endingTitle", imported.EndingTitle ?? "End");
            SetField(step, "endingMessage", imported.EndingMessage ?? string.Empty);
            SetField(step, "markerTitle", imported.MarkerTitle ?? string.Empty);
            SetField(step, "stageNote", imported.StageNote ?? string.Empty);
            SetField(step, "choices", BuildChoices(imported.Choices));

            if (imported.StepType == StoryStepType.Dialogue || imported.StepType == StoryStepType.Narration)
            {
                var line = new DialogueLine();
                SetField(line, "speakerName", imported.SpeakerName ?? string.Empty);
                SetField(line, "content", imported.Content ?? string.Empty);
                SetField(line, "expressionId", imported.ExpressionId ?? string.Empty);
                SetField(line, "background", imported.Background);
                SetField(line, "soundEffect", null);
                SetField(step, "dialogue", line);
            }

            steps[i] = step;
        }

        return steps;
    }

    private static ChoiceOption[] BuildChoices(ImportedChoiceOption[] importedChoices)
    {
        if (importedChoices == null || importedChoices.Length == 0)
        {
            return Array.Empty<ChoiceOption>();
        }

        var choices = new ChoiceOption[importedChoices.Length];
        for (var i = 0; i < importedChoices.Length; i++)
        {
            var choice = new ChoiceOption();
            SetField(choice, "label", importedChoices[i].Label ?? string.Empty);
            SetField(choice, "nextStepId", importedChoices[i].NextStepId ?? string.Empty);
            choices[i] = choice;
        }

        return choices;
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path))
        {
            return;
        }

        var parent = Path.GetDirectoryName(path)?.Replace("\\", "/");
        var folderName = Path.GetFileName(path);
        if (!string.IsNullOrWhiteSpace(parent) && !string.IsNullOrWhiteSpace(folderName))
        {
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, folderName);
        }
    }

    private static void SetField(object target, string fieldName, object value)
    {
        var field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
        field?.SetValue(target, value);
    }
}
