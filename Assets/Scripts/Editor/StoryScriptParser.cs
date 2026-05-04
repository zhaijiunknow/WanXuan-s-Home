using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;

public static class StoryScriptParser
{
    private static readonly Regex SceneHeaderRegex = new(@"^(\d+-\d+|\d+[A-Z]-\d+)\s+(.+)$");
    private static readonly Regex SpeakerRegex = new(@"^(我（心想）|我|皖萱(?:\s*\[[^\]]+\])?|Yui(?:（语音）)?)$");
    private static readonly Regex ChoiceRegex = new(@"^([A-Z])\.\s*(.+)$");
    private static readonly Regex TimeOfDayRegex = new(@"(午后|白天|清晨|晴|白昼|白日|白天延续|下午|客厅 / 午后|厨房 / 白天)");
    private static readonly Regex EveningRegex = new(@"(傍晚|黄昏|夕阳)");
    private static readonly Regex NightRegex = new(@"(深夜|夜|凌晨|夜晚|初夏)");
    private static readonly Regex ExpressionRegex = new(@"表情([A-Z](?:→[A-Z])?|[A-Z]/[A-Z])");

    public static StoryImportResult ParseFromFile(string filePath)
    {
        var text = File.ReadAllText(filePath);
        return Parse(text);
    }

    public static StoryImportResult Parse(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var steps = new List<ImportedStoryStep>();
        var currentTimeOfDay = TimeOfDay.Day;
        var pendingStageNotes = new List<string>();
        var currentSpeaker = string.Empty;
        var currentExpression = string.Empty;
        var currentContent = new List<string>();
        var currentStepId = string.Empty;
        var inChoiceBlock = false;
        var choiceBuffer = new List<ImportedChoiceOption>();
        var choiceSourceStepId = string.Empty;
        var hasReachedAppendix = false;

        void AddTextStep(StoryStepType stepType, string content, string stageNote)
        {
            steps.Add(new ImportedStoryStep
            {
                StepId = GenerateTextStepId(currentStepId, steps.Count),
                StepType = stepType,
                SpeakerName = stepType == StoryStepType.Dialogue ? NormalizeSpeaker(currentSpeaker) : string.Empty,
                Content = content,
                ExpressionId = NormalizeExpression(currentExpression),
                Background = currentTimeOfDay,
                StageNote = stageNote
            });
        }

        void FlushCurrentText(bool narrationFallback)
        {
            if (currentContent.Count == 0)
            {
                return;
            }

            var content = string.Join("\n", currentContent).Trim();
            if (string.IsNullOrWhiteSpace(content))
            {
                currentContent.Clear();
                return;
            }

            var stepType = string.IsNullOrWhiteSpace(currentSpeaker)
                ? StoryStepType.Narration
                : StoryStepType.Dialogue;
            var stageNote = JoinStageNotes(pendingStageNotes);

            if (stepType == StoryStepType.Narration)
            {
                var chunks = SplitNarrationContent(currentContent);
                for (var i = 0; i < chunks.Count; i++)
                {
                    AddTextStep(stepType, chunks[i], i == 0 ? stageNote : string.Empty);
                }
            }
            else
            {
                AddTextStep(stepType, content, stageNote);
            }

            currentSpeaker = string.Empty;
            currentExpression = string.Empty;
            currentContent.Clear();
            pendingStageNotes.Clear();
        }

        for (var i = 0; i < lines.Length && !hasReachedAppendix; i++)
        {
            var rawLine = lines[i];
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.StartsWith("附录："))
            {
                FlushCurrentText(true);
                hasReachedAppendix = true;
                continue;
            }

            if (line.StartsWith("====================") || line.StartsWith("结构总览") || line.StartsWith("题材：") || line.StartsWith("主要角色"))
            {
                continue;
            }

            if (line.StartsWith("《") || line.StartsWith("完整剧本（"))
            {
                continue;
            }

            if (line.StartsWith("第一幕：") || line.StartsWith("第二幕：") || line.StartsWith("第三幕：") || line.StartsWith("第四幕：") || line.StartsWith("结局分支 A") || line.StartsWith("结局分支 B") || line.StartsWith("通关后彩蛋："))
            {
                FlushCurrentText(true);
                currentStepId = Slugify(line);
                steps.Add(new ImportedStoryStep
                {
                    StepId = currentStepId,
                    StepType = StoryStepType.Marker,
                    MarkerTitle = line,
                    StageNote = JoinStageNotes(pendingStageNotes)
                });
                pendingStageNotes.Clear();
                continue;
            }

            var sceneMatch = SceneHeaderRegex.Match(line);
            if (sceneMatch.Success)
            {
                FlushCurrentText(true);
                currentStepId = sceneMatch.Groups[1].Value;
                steps.Add(new ImportedStoryStep
                {
                    StepId = currentStepId,
                    StepType = StoryStepType.Marker,
                    MarkerTitle = sceneMatch.Groups[2].Value,
                    StageNote = JoinStageNotes(pendingStageNotes)
                });
                pendingStageNotes.Clear();
                continue;
            }

            if (line.StartsWith("【玩家选项】"))
            {
                FlushCurrentText(true);
                inChoiceBlock = true;
                choiceBuffer.Clear();
                choiceSourceStepId = string.IsNullOrWhiteSpace(currentStepId) ? "choice" : currentStepId + "-choice";
                continue;
            }

            if (inChoiceBlock)
            {
                var choiceMatch = ChoiceRegex.Match(line);
                if (choiceMatch.Success)
                {
                    var choiceKey = choiceMatch.Groups[1].Value;
                    choiceBuffer.Add(new ImportedChoiceOption
                    {
                        Label = choiceMatch.Groups[2].Value,
                        NextStepId = choiceKey == "A" ? "5A-1" : choiceKey == "B" ? "5B-1" : string.Empty
                    });
                    continue;
                }

                if (choiceBuffer.Count > 0)
                {
                    steps.Add(new ImportedStoryStep
                    {
                        StepId = choiceSourceStepId,
                        StepType = StoryStepType.Choice,
                        Choices = choiceBuffer.ToArray(),
                        StageNote = JoinStageNotes(pendingStageNotes)
                    });
                    choiceBuffer.Clear();
                    pendingStageNotes.Clear();
                }

                inChoiceBlock = false;
            }

            if (line.StartsWith("【"))
            {
                pendingStageNotes.Add(line);
                currentTimeOfDay = UpdateTimeOfDay(line, currentTimeOfDay);
                currentExpression = UpdateExpression(line, currentExpression);
                continue;
            }

            if (line.StartsWith("——至此进入玩家分支选择"))
            {
                FlushCurrentText(true);
                continue;
            }

            if (line.StartsWith("【HE 结尾旁白】") || line.StartsWith("【飞升结局旁白】"))
            {
                FlushCurrentText(true);
                pendingStageNotes.Add(line);
                continue;
            }

            if (line.StartsWith("【彩蛋结束演出】") || line.StartsWith("【触发条件】") || line.StartsWith("【玩家点击后】"))
            {
                pendingStageNotes.Add(line);
                continue;
            }

            if (SpeakerRegex.IsMatch(line))
            {
                FlushCurrentText(true);
                currentSpeaker = line;
                currentExpression = UpdateExpression(line, currentExpression);
                continue;
            }

            currentContent.Add(line);
        }

        FlushCurrentText(true);

        if (inChoiceBlock && choiceBuffer.Count > 0)
        {
            steps.Add(new ImportedStoryStep
            {
                StepId = choiceSourceStepId,
                StepType = StoryStepType.Choice,
                Choices = choiceBuffer.ToArray(),
                StageNote = JoinStageNotes(pendingStageNotes)
            });
        }

        AddEndingSteps(steps);
        LinkSequentialSteps(steps);

        return new StoryImportResult(steps);
    }

    private static void AddEndingSteps(List<ImportedStoryStep> steps)
    {
        EnsureEndingStep(steps, "ending-he", "永不落幕的茶会", "皖萱留在了人间。茶会还会继续。", "5A-3");
        EnsureEndingStep(steps, "ending-be", "把甜味带回去的人", "皖萱带着这段甜味回到了天空。", "5B-3");
    }

    private static List<string> SplitNarrationContent(List<string> lines)
    {
        var chunks = new List<string>();
        var currentChunk = new List<string>();

        void FlushChunk()
        {
            if (currentChunk.Count == 0)
            {
                return;
            }

            var chunk = string.Join("\n", currentChunk).Trim();
            if (!string.IsNullOrWhiteSpace(chunk))
            {
                chunks.Add(chunk);
            }

            currentChunk.Clear();
        }

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                FlushChunk();
                continue;
            }

            currentChunk.Add(line.Trim());
            if (EndsNarrationChunk(line))
            {
                FlushChunk();
            }
        }

        FlushChunk();
        return chunks;
    }

    private static bool EndsNarrationChunk(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return false;
        }

        var trimmed = line.TrimEnd();
        var last = trimmed[^1];
        return last == '。' || last == '！' || last == '？' || last == '…';
    }

    private static void EnsureEndingStep(List<ImportedStoryStep> steps, string endingId, string title, string message, string previousStepId)
    {
        var endingStep = new ImportedStoryStep
        {
            StepId = endingId,
            StepType = StoryStepType.End,
            EndingTitle = title,
            EndingMessage = message
        };
        steps.Add(endingStep);

        for (var i = steps.Count - 2; i >= 0; i--)
        {
            if (steps[i].StepId.StartsWith(previousStepId, StringComparison.OrdinalIgnoreCase))
            {
                steps[i].NextStepId = endingId;
                break;
            }
        }
    }

    private static void LinkSequentialSteps(List<ImportedStoryStep> steps)
    {
        for (var i = 0; i < steps.Count - 1; i++)
        {
            var current = steps[i];
            if (!string.IsNullOrWhiteSpace(current.NextStepId) || current.StepType == StoryStepType.End || current.StepType == StoryStepType.Choice)
            {
                continue;
            }

            current.NextStepId = steps[i + 1].StepId;
        }
    }

    private static string GenerateTextStepId(string currentStepId, int index)
    {
        var prefix = string.IsNullOrWhiteSpace(currentStepId) ? "story" : currentStepId;
        return $"{prefix}-text-{index:D4}";
    }

    private static string NormalizeSpeaker(string value)
    {
        if (value.StartsWith("皖萱"))
        {
            return "皖萱";
        }

        if (value.StartsWith("Yui"))
        {
            return "Yui";
        }

        if (value.StartsWith("我"))
        {
            return value.Contains("心想") ? "独白" : "我";
        }

        return value;
    }

    private static string NormalizeExpression(string expression)
    {
        if (string.IsNullOrWhiteSpace(expression))
        {
            return string.Empty;
        }

        if (expression.Contains("→"))
        {
            var split = expression.Split('→');
            return split[^1];
        }

        if (expression.Contains('/'))
        {
            var split = expression.Split('/');
            return split[0];
        }

        return expression;
    }

    private static string UpdateExpression(string source, string fallback)
    {
        var match = ExpressionRegex.Match(source);
        if (!match.Success)
        {
            return fallback;
        }

        return match.Groups[1].Value;
    }

    private static TimeOfDay UpdateTimeOfDay(string source, TimeOfDay fallback)
    {
        if (EveningRegex.IsMatch(source))
        {
            return TimeOfDay.Evening;
        }

        if (NightRegex.IsMatch(source))
        {
            return TimeOfDay.Night;
        }

        if (TimeOfDayRegex.IsMatch(source))
        {
            return TimeOfDay.Day;
        }

        return fallback;
    }

    private static string JoinStageNotes(List<string> notes)
    {
        return notes.Count == 0 ? string.Empty : string.Join("\n", notes);
    }

    private static string Slugify(string text)
    {
        var cleaned = text.Replace("：", "-").Replace("“", string.Empty).Replace("”", string.Empty).Replace("《", string.Empty).Replace("》", string.Empty).Replace(" ", "-");
        return cleaned;
    }
}

public sealed class StoryImportResult
{
    public StoryImportResult(IReadOnlyList<ImportedStoryStep> steps)
    {
        Steps = steps;
    }

    public IReadOnlyList<ImportedStoryStep> Steps { get; }
}

public sealed class ImportedStoryStep
{
    public string StepId { get; set; }
    public StoryStepType StepType { get; set; }
    public string SpeakerName { get; set; }
    public string Content { get; set; }
    public string ExpressionId { get; set; }
    public TimeOfDay Background { get; set; }
    public string NextStepId { get; set; }
    public ImportedChoiceOption[] Choices { get; set; } = Array.Empty<ImportedChoiceOption>();
    public string EndingTitle { get; set; }
    public string EndingMessage { get; set; }
    public string MarkerTitle { get; set; }
    public string StageNote { get; set; }
}

public sealed class ImportedChoiceOption
{
    public string Label { get; set; }
    public string NextStepId { get; set; }
}
