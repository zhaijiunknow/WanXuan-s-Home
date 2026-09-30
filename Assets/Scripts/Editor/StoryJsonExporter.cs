using System;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

/// <summary>
/// 把 StoryAsset 导出成 Web 前端可读的 JSON（WebUI/story.json）。
///
/// 为什么要这一步：剧本的唯一权威副本是 Assets/Data/Story/WanXuanLongStory.asset，
/// 而 HTML 原型跑在浏览器里读不到 ScriptableObject。导出成 JSON 后，
/// 前端就能用真实的 1397 步数据评排版和节奏，而不是靠手写的假数据。
///
/// 手写 JSON 而不用 JsonUtility，是因为 StoryStep 的字段全是 private +
/// 只读属性，且导出结构（type/speaker/background 等）与存储结构不同，
/// 手动映射反而更清楚、也避免多引一个序列化库。
///
/// 用法：菜单栏 WanXuan > 导出 Web 剧本 JSON，然后刷新浏览器（或直接看 WebUI/story.json）。
/// </summary>
public static class StoryJsonExporter
{
    private const string StoryAssetPath = "Assets/Data/Story/WanXuanLongStory.asset";

    // 必须与 WebUI/app.js 里的 BRIDGE_VERSION 一致
    private const int FormatVersion = 1;

    [MenuItem("WanXuan/导出 Web 剧本（story.js）", false, 200)]
    public static void ExportStoryJson()
    {
        var asset = AssetDatabase.LoadAssetAtPath<StoryAsset>(StoryAssetPath);
        if (asset == null)
        {
            Debug.LogError($"找不到剧本资产：{StoryAssetPath}\n请先执行菜单 WanXuan > Import Long Story。");
            return;
        }

        var steps = asset.Steps;
        if (steps == null || steps.Length == 0)
        {
            Debug.LogError($"{StoryAssetPath} 里没有步骤数据，请先重新导入剧本。");
            return;
        }

        var json = BuildJson(asset, steps);

        var projectRoot = Path.GetDirectoryName(Application.dataPath);
        if (string.IsNullOrEmpty(projectRoot))
        {
            Debug.LogError("无法定位项目根目录。");
            return;
        }

        var outputDirectory = Path.Combine(projectRoot, "WebUI");
        if (!Directory.Exists(outputDirectory))
        {
            Directory.CreateDirectory(outputDirectory);
        }

        var outputPath = Path.Combine(outputDirectory, "story.js");

        // 写成 <script> 可直接加载的 JS 赋值，而不是纯 JSON 文件。
        // 原因：嵌进 CEF / WebView 时页面是从 file:// 加载的，fetch('story.json') 会被 CORS 拒绝，
        // 只有 <script src="story.js"> 这条路径能拿到完整剧本。
        // UTF8Encoding(false)：不写 BOM。
        var script = "window.VN_STORY = " + json + ";\n";
        File.WriteAllText(outputPath, script, new UTF8Encoding(false));

        Debug.Log(
            $"已导出 Web 剧本。\n" +
            $"  输出：{outputPath}\n" +
            $"  步骤：{steps.Length}\n" +
            $"  大小：{new FileInfo(outputPath).Length / 1024} KB\n" +
            "app.js 会优先加载 story.js，其次 story.json，都没有才退回内置样本。");
    }

    private static string BuildJson(StoryAsset asset, StoryStep[] steps)
    {
        var builder = new StringBuilder(steps.Length * 220);
        builder.Append("{\n");
        builder.Append("  \"version\": ").Append(FormatVersion).Append(",\n");
        builder.Append("  \"storyId\": ").Append(JsonString(asset.StoryId)).Append(",\n");
        builder.Append("  \"storyTitle\": ").Append(JsonString(asset.StoryTitle)).Append(",\n");
        builder.Append("  \"exportedAt\": ").Append(JsonString(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"))).Append(",\n");
        builder.Append("  \"steps\": [\n");

        for (var i = 0; i < steps.Length; i++)
        {
            AppendStep(builder, steps[i]);
            builder.Append(i < steps.Length - 1 ? ",\n" : "\n");
        }

        builder.Append("  ]\n");
        builder.Append("}\n");
        return builder.ToString();
    }

    private static void AppendStep(StringBuilder builder, StoryStep step)
    {
        builder.Append("    { ");

        if (step == null)
        {
            builder.Append("\"id\": \"\", \"type\": \"marker\" }");
            return;
        }

        builder.Append("\"id\": ").Append(JsonString(step.StepId));
        builder.Append(", \"type\": ").Append(JsonString(MapType(step.StepType)));

        // dialogue / narration 才有正文、说话人与时段。
        // 标记 / 选项 / 结局步骤没有 DialogueLine，因此不输出 background ——
        // 前端 applyBackground 遇到空值会保留上一个时段，这正是想要的行为
        // （幕标题弹出来时不该把背景闪回白天）。
        if (step.StepType == StoryStepType.Dialogue || step.StepType == StoryStepType.Narration)
        {
            var line = step.Dialogue;
            if (line != null)
            {
                builder.Append(", \"speaker\": ").Append(JsonString(line.SpeakerName));
                builder.Append(", \"content\": ").Append(JsonString(line.Content));
                builder.Append(", \"expression\": ").Append(JsonString(line.ExpressionId));
                builder.Append(", \"background\": ").Append(JsonString(MapBackground(line.Background)));
            }
        }

        if (!string.IsNullOrWhiteSpace(step.StageNote))
        {
            builder.Append(", \"stageNote\": ").Append(JsonString(step.StageNote));
        }

        if (!string.IsNullOrWhiteSpace(step.MarkerTitle))
        {
            builder.Append(", \"markerTitle\": ").Append(JsonString(step.MarkerTitle));
        }

        if (!string.IsNullOrWhiteSpace(step.NextStepId))
        {
            builder.Append(", \"next\": ").Append(JsonString(step.NextStepId));
        }

        if (step.StepType == StoryStepType.Choice && step.Choices != null && step.Choices.Length > 0)
        {
            builder.Append(", \"choices\": [");
            for (var i = 0; i < step.Choices.Length; i++)
            {
                var choice = step.Choices[i];
                if (i > 0)
                {
                    builder.Append(", ");
                }

                builder.Append("{ \"label\": ").Append(JsonString(choice != null ? choice.Label : string.Empty));
                builder.Append(", \"next\": ").Append(JsonString(choice != null ? choice.NextStepId : string.Empty));
                builder.Append(" }");
            }
            builder.Append("]");
        }

        if (step.StepType == StoryStepType.End)
        {
            builder.Append(", \"endingTitle\": ").Append(JsonString(step.EndingTitle));
            builder.Append(", \"endingMessage\": ").Append(JsonString(step.EndingMessage));
        }

        builder.Append(" }");
    }

    private static string MapType(StoryStepType stepType)
    {
        switch (stepType)
        {
            case StoryStepType.Dialogue:  return "dialogue";
            case StoryStepType.Narration: return "narration";
            case StoryStepType.Choice:    return "choice";
            case StoryStepType.End:       return "end";
            case StoryStepType.Marker:    return "marker";
            default:                      return "marker";
        }
    }

    private static string MapBackground(TimeOfDay timeOfDay)
    {
        switch (timeOfDay)
        {
            case TimeOfDay.Evening: return "evening";
            case TimeOfDay.Night:   return "night";
            default:                return "day";
        }
    }

    /// <summary>
    /// JSON 字符串转义。中文按原样输出（UTF-8 JSON 完全合法），
    /// 这样 story.json 可以直接用文本编辑器阅读和 diff。
    /// </summary>
    private static string JsonString(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');

        foreach (var ch in value)
        {
            switch (ch)
            {
                case '"':  builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (ch < ' ')
                    {
                        builder.Append("\\u").Append(((int)ch).ToString("x4"));
                    }
                    else
                    {
                        builder.Append(ch);
                    }
                    break;
            }
        }

        builder.Append('"');
        return builder.ToString();
    }
}
