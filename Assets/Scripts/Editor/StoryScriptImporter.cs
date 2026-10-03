using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEngine;

public static class StoryScriptImporter
{
    // 剧本源文件在项目根目录下的候选文件名，按顺序查找。
    // 不要改回硬编码绝对路径：换机器或重命名后导入菜单会静默失效。
    private static readonly string[] SourceFileCandidates =
    {
        "完整剧本.txt",
        "完整剧本_长篇版.txt"
    };

    private const string AssetPath = "Assets/Data/Story/WanXuanLongStory.asset";

    [MenuItem("WanXuan/Import Long Story")]
    public static void ImportLongStory()
    {
        var sourcePath = ResolveSourcePath();
        if (sourcePath == null)
        {
            Debug.LogError(
                "未找到剧本源文件。请在项目根目录放置以下任意一个文件后重试：\n  " +
                string.Join("\n  ", SourceFileCandidates) +
                "\n项目根目录：" + GetProjectRoot());
            return;
        }

        EnsureFolder("Assets/Data");
        EnsureFolder("Assets/Data/Story");

        BackupExistingAsset();

        var importResult = StoryScriptParser.ParseFromFile(sourcePath);
        var asset = AssetDatabase.LoadAssetAtPath<StoryAsset>(AssetPath);
        if (asset == null)
        {
            asset = ScriptableObject.CreateInstance<StoryAsset>();
            AssetDatabase.CreateAsset(asset, AssetPath);
        }

        var steps = BuildSteps(importResult);

        SetField(asset, "storyId", "wanxuan_long_story");
        SetField(asset, "storyTitle", "甜味的坠落");
        SetField(asset, "steps", steps);

        EditorUtility.SetDirty(asset);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log($"Imported story to {AssetPath} with {steps.Length} steps. Source: {sourcePath}");

        ReportGraphHealth(steps);
    }

    private static string GetProjectRoot()
    {
        // Application.dataPath 形如 <项目根>/Assets
        return Path.GetDirectoryName(Application.dataPath);
    }

    /// <summary>
    /// 覆盖导入前把现有剧本资产原样备份到 &lt;项目根&gt;/Backups。
    /// 放在 Assets 之外，因此不会被 Unity 导入、也不会污染资源列表。
    /// 剧本有 1300+ 步，解析器一旦改动带来副作用，没有版本控制就很难回退。
    /// </summary>
    private static void BackupExistingAsset()
    {
        var projectRoot = GetProjectRoot();
        if (string.IsNullOrEmpty(projectRoot))
        {
            return;
        }

        var sourceAssetFullPath = Path.GetFullPath(Path.Combine(projectRoot, AssetPath));
        if (!File.Exists(sourceAssetFullPath))
        {
            return;
        }

        try
        {
            var backupDirectory = Path.Combine(projectRoot, "Backups");
            Directory.CreateDirectory(backupDirectory);

            var backupPath = Path.Combine(
                backupDirectory,
                $"WanXuanLongStory_{DateTime.Now:yyyyMMdd_HHmmss}.asset");

            File.Copy(sourceAssetFullPath, backupPath, true);

            Debug.Log($"已备份原剧本资产到：{backupPath}");
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"备份原剧本资产失败，仍会继续导入：{exception.Message}");
        }
    }

    private static string ResolveSourcePath()
    {
        var projectRoot = GetProjectRoot();
        if (string.IsNullOrEmpty(projectRoot))
        {
            return null;
        }

        foreach (var candidate in SourceFileCandidates)
        {
            var fullPath = Path.Combine(projectRoot, candidate);
            if (File.Exists(fullPath))
            {
                return fullPath;
            }
        }

        return null;
    }

    /// <summary>
    /// 导入后自检剧本图：从第 0 步出发遍历 NextStepId 与所有选项分支，
    /// 报告无法到达的孤儿步骤、指向不存在步骤的悬空链接、以及两个结局是否可达。
    /// 这类问题在 1300+ 步的数据里靠肉眼几乎不可能发现，但会让玩家卡死或看不到结局。
    /// </summary>
    private static void ReportGraphHealth(StoryStep[] steps)
    {
        if (steps == null || steps.Length == 0)
        {
            Debug.LogError("剧本图为空，导入结果不可用。");
            return;
        }

        var indexByStepId = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < steps.Length; i++)
        {
            var id = steps[i] != null ? steps[i].StepId : null;
            if (!string.IsNullOrWhiteSpace(id))
            {
                indexByStepId[id] = i;
            }
        }

        var reachable = new bool[steps.Length];
        var dangling = new List<string>();
        var pending = new Stack<int>();
        pending.Push(0);

        while (pending.Count > 0)
        {
            var index = pending.Pop();
            if (index < 0 || index >= steps.Length || reachable[index])
            {
                continue;
            }

            reachable[index] = true;

            var step = steps[index];
            if (step == null)
            {
                continue;
            }

            var targets = new List<string>();
            if (!string.IsNullOrWhiteSpace(step.NextStepId))
            {
                targets.Add(step.NextStepId);
            }

            if (step.Choices != null)
            {
                foreach (var choice in step.Choices)
                {
                    if (choice != null && !string.IsNullOrWhiteSpace(choice.NextStepId))
                    {
                        targets.Add(choice.NextStepId);
                    }
                }
            }

            foreach (var target in targets)
            {
                if (indexByStepId.TryGetValue(target, out var nextIndex))
                {
                    pending.Push(nextIndex);
                }
                else
                {
                    dangling.Add($"{step.StepId} -> {target}");
                }
            }
        }

        // 孤立步骤分两类：
        //   - 内容步骤（对话/旁白/选项/结局）不可达 = 玩家永远看不到的剧情，属于真问题；
        //   - 标记步骤不可达 = 只是幕标题/场景标题这类纯标签，本身不产生任何画面，
        //     它的下游内容会单独出现在内容步骤里，所以单独列出、不算错误。
        var orphanContent = new List<string>();
        var orphanMarkers = new List<string>();
        for (var i = 0; i < steps.Length; i++)
        {
            if (reachable[i])
            {
                continue;
            }

            var step = steps[i];
            var id = step != null ? step.StepId : "<null>";
            if (step != null && step.StepType == StoryStepType.Marker)
            {
                orphanMarkers.Add(id);
            }
            else
            {
                orphanContent.Add(id);
            }
        }

        var choiceCount = 0;
        var endingIds = new List<string>();
        foreach (var step in steps)
        {
            if (step == null)
            {
                continue;
            }

            if (step.StepType == StoryStepType.Choice)
            {
                choiceCount++;
            }
            else if (step.StepType == StoryStepType.End)
            {
                endingIds.Add(step.StepId);
            }
        }

        var report = new StringBuilder();
        report.AppendLine("===== 剧本图自检 =====");
        report.AppendLine($"总步骤：{steps.Length}　选项点：{choiceCount}　结局：{endingIds.Count}");

        if (dangling.Count == 0)
        {
            report.AppendLine("悬空链接：无");
        }
        else
        {
            report.AppendLine($"悬空链接：{dangling.Count} 处（运行时会直接跳到 End，必须修）");
            foreach (var item in dangling)
            {
                report.AppendLine("  ! " + item);
            }
        }

        if (orphanContent.Count == 0)
        {
            report.AppendLine("孤立内容步骤：无（全部可达）");
        }
        else
        {
            report.AppendLine($"孤立内容步骤：{orphanContent.Count} 个（玩家永远看不到这些剧情，必须修）");
            var preview = Math.Min(orphanContent.Count, 20);
            for (var i = 0; i < preview; i++)
            {
                report.AppendLine("  - " + orphanContent[i]);
            }

            if (orphanContent.Count > preview)
            {
                report.AppendLine($"  …… 另有 {orphanContent.Count - preview} 个");
            }
        }

        if (orphanMarkers.Count == 0)
        {
            report.AppendLine("孤立标记步骤：无");
        }
        else
        {
            report.AppendLine($"孤立标记步骤：{orphanMarkers.Count} 个（纯标签，无入口，不影响玩家）");
            var preview = Math.Min(orphanMarkers.Count, 10);
            for (var i = 0; i < preview; i++)
            {
                report.AppendLine("  · " + orphanMarkers[i]);
            }

            if (orphanMarkers.Count > preview)
            {
                report.AppendLine($"  …… 另有 {orphanMarkers.Count - preview} 个");
            }
        }

        foreach (var endingId in endingIds)
        {
            var reachableEnding = indexByStepId.TryGetValue(endingId, out var endingIndex) && reachable[endingIndex];
            report.AppendLine($"结局 {endingId}：{(reachableEnding ? "可达" : "不可达 !!")}");
        }

        if (dangling.Count > 0 || orphanContent.Count > 0)
        {
            Debug.LogError(report.ToString());
        }
        else
        {
            Debug.Log(report.ToString());
        }
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
