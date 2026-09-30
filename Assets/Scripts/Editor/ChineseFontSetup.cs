using System.Collections.Generic;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 生成中文 TMP 字体资产，并把它接成默认字体 + 全局 fallback。
///
/// 背景（修复前的问题）：
///   Assets/TextMesh Pro/Resources/Fonts & Materials/ 下只有 ChillRoundF.ttf 和
///   WenQuanYi Bitmap Song 13px.ttf 两个**源字体文件**，没有任何由它们生成的 SDF 资产；
///   而 TMP Settings 的 m_defaultFontAsset 是纯拉丁的 LiberationSans SDF，
///   m_fallbackFontAssets 为空列表 —— 因此全部中文对话会渲染成空白/缺字。
///
/// 这里生成的是 **Dynamic** 模式的字体资产：字形按需入库，图集自动增长。
/// 不需要像 3500+symbols.txt 那样把整份剧本预烘进固定图集（那正是之前走过的弯路）。
///
/// 用法：菜单栏 WanXuan > 中文字体，按 1 → 2 →（打开 MainRoom 场景）→ 3 的顺序执行。
/// </summary>
public static class ChineseFontSetup
{
    private const string SourceFontPath = "Assets/TextMesh Pro/Resources/Fonts & Materials/ChillRoundF.ttf";
    private const string OutputFolderPath = "Assets/Fonts";
    private const string OutputAssetPath = "Assets/Fonts/ChillRoundF SDF.asset";
    private const string TmpSettingsAssetPath = "Assets/TextMesh Pro/Resources/TMP Settings.asset";

    // 中文笔画密，采样点要够大；2048 图集配合多图集支持，够 1300+ 步剧本用。
    private const int SamplingPointSize = 90;
    private const int AtlasPadding = 9;
    private const int AtlasWidth = 2048;
    private const int AtlasHeight = 2048;

    private const string ProbeText = "坠落凡间的头号食客——皖萱：“这样的话，你还希望我留下吗？”";

    [MenuItem("WanXuan/中文字体/1. 生成中文字体资产（并接入 fallback）", false, 100)]
    public static void CreateChineseFontAsset()
    {
        var sourceFont = AssetDatabase.LoadAssetAtPath<Font>(SourceFontPath);
        if (sourceFont == null)
        {
            Debug.LogError($"找不到源字体文件：{SourceFontPath}");
            return;
        }

        if (!AssetDatabase.IsValidFolder(OutputFolderPath))
        {
            AssetDatabase.CreateFolder("Assets", "Fonts");
        }

        if (AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(OutputAssetPath) != null)
        {
            var overwrite = EditorUtility.DisplayDialog(
                "字体资产已存在",
                $"{OutputAssetPath} 已存在。\n\n覆盖重建会丢弃该资产上已有的自定义设置（已应用到场景里的引用不会丢失，因为路径和 GUID 保持不变）。",
                "覆盖重建",
                "取消");

            if (!overwrite)
            {
                return;
            }

            AssetDatabase.DeleteAsset(OutputAssetPath);
        }

        var fontAsset = TMP_FontAsset.CreateFontAsset(
            sourceFont,
            SamplingPointSize,
            AtlasPadding,
            UnityEngine.TextCore.LowLevel.GlyphRenderMode.SDFAA,
            AtlasWidth,
            AtlasHeight,
            AtlasPopulationMode.Dynamic,
            true);

        if (fontAsset == null)
        {
            Debug.LogError("TMP_FontAsset.CreateFontAsset 返回 null，字体资产创建失败（可能是源字体不被 TMP 支持）。");
            return;
        }

        fontAsset.name = "ChillRoundF SDF";
        fontAsset.atlasPopulationMode = AtlasPopulationMode.Dynamic;

        AssetDatabase.CreateAsset(fontAsset, OutputAssetPath);
        SaveSubAssets(fontAsset);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        RegisterAsDefaultAndFallback(fontAsset);

        Debug.Log(
            "中文字体资产已生成。\n" +
            $"  资产路径：{OutputAssetPath}\n" +
            "  图集模式：Dynamic（字形按需入库，图集自动增长，无需预烘图集）\n" +
            $"  采样点：{SamplingPointSize}　图集：{AtlasWidth}x{AtlasHeight}　多图集：开\n" +
            "  已设为 TMP 默认字体，并加入 TMP Settings 的全局 fallback。\n" +
            "注意 1：Dynamic 模式依赖源字体文件在构建中被包含，请勿把 " + SourceFontPath + " 移出工程或删掉。\n" +
            "注意 2：请确认该字体的授权允许商用/再分发（寒蝉系字体与文泉驿字体的授权条款不同）。");
    }

    [MenuItem("WanXuan/中文字体/2. 自检：中文缺字检查", false, 102)]
    public static void VerifyChineseGlyphs()
    {
        var fontAsset = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(OutputAssetPath);
        if (fontAsset == null)
        {
            Debug.LogError($"找不到中文字体资产 {OutputAssetPath}，请先执行菜单 1。");
            return;
        }

        var missing = new List<char>();
        foreach (var ch in ProbeText)
        {
            if (char.IsWhiteSpace(ch))
            {
                continue;
            }

            if (!fontAsset.HasCharacter(ch))
            {
                missing.Add(ch);
            }
        }

        if (missing.Count == 0)
        {
            Debug.Log(
                $"缺字检查通过：探测文本 {ProbeText.Length} 个字符全部可用。\n" +
                $"字体资产：{fontAsset.name}　模式：{fontAsset.atlasPopulationMode}　" +
                $"已加载字形数：{fontAsset.characterTable.Count}");
        }
        else
        {
            Debug.LogError(
                $"缺字检查失败：有 {missing.Count} 个字符在该字体中不存在 —— {new string(missing.ToArray())}\n" +
                "若该字体确实不包含这些字，需要换一个覆盖更全的中文字体，或再挂一个 fallback 字体。");
        }
    }

    [MenuItem("WanXuan/中文字体/3. 应用到当前打开的场景中的全部文本（并保存场景）", false, 103)]
    public static void ApplyToOpenScene()
    {
        var fontAsset = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(OutputAssetPath);
        if (fontAsset == null)
        {
            Debug.LogError($"找不到中文字体资产 {OutputAssetPath}，请先执行菜单 1。");
            return;
        }

        // 显式限定 UnityEngine.Object，避免将来加上 using System 后出现 CS0104 歧义
        var texts = UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        if (texts == null || texts.Length == 0)
        {
            Debug.LogWarning("当前打开的场景里没有找到任何 TMP_Text（注意：本操作只作用于已打开的场景，不会自动打开 MainRoom）。");
            return;
        }

        var confirm = EditorUtility.DisplayDialog(
            "替换场景字体",
            $"将把当前打开场景中扫描到的 {texts.Length} 个 TMP_Text 的字体设为 “{fontAsset.name}”，然后保存所有已打开的场景。\n\n是否继续？",
            "替换并保存",
            "取消");

        if (!confirm)
        {
            return;
        }

        var changed = 0;
        foreach (var text in texts)
        {
            if (text == null || text.font == fontAsset)
            {
                continue;
            }

            Undo.RecordObject(text, "Set Chinese TMP Font");
            text.font = fontAsset;
            EditorUtility.SetDirty(text);
            changed++;
        }

        var scene = SceneManager.GetActiveScene();
        if (scene.IsValid())
        {
            EditorSceneManager.MarkSceneDirty(scene);
        }

        EditorSceneManager.SaveOpenScenes();

        Debug.Log($"已替换 {changed} 个 TMP_Text 的字体（共扫描 {texts.Length} 个），已打开的场景已保存。");
    }

    private static void SaveSubAssets(TMP_FontAsset fontAsset)
    {
        // 图集贴图与材质必须作为子资产保存，否则重新打开工程后字体会丢贴图。
        if (fontAsset.atlasTextures != null &&
            fontAsset.atlasTextures.Length > 0 &&
            fontAsset.atlasTextures[0] != null)
        {
            var atlas = fontAsset.atlasTextures[0];
            atlas.name = fontAsset.name + " Atlas";
            atlas.hideFlags = HideFlags.HideInHierarchy;

            if (string.IsNullOrEmpty(AssetDatabase.GetAssetPath(atlas)))
            {
                AssetDatabase.AddObjectToAsset(atlas, fontAsset);
            }
        }

        if (fontAsset.material != null)
        {
            fontAsset.material.name = fontAsset.name + " Material";
            fontAsset.material.hideFlags = HideFlags.HideInHierarchy;

            if (string.IsNullOrEmpty(AssetDatabase.GetAssetPath(fontAsset.material)))
            {
                AssetDatabase.AddObjectToAsset(fontAsset.material, fontAsset);
            }
        }
    }

    private static void RegisterAsDefaultAndFallback(TMP_FontAsset fontAsset)
    {
        var settings = LoadTmpSettings();
        if (settings == null)
        {
            Debug.LogWarning(
                "找不到 TMP Settings 资产，已跳过默认字体 / 全局 fallback 注册。\n" +
                "请手动执行：Edit > Project Settings > TextMesh Pro > Settings，\n" +
                "把 Default Font Asset 设为 “" + fontAsset.name + "”，并加入 Fallback Font Assets。");
            return;
        }

        // 用 SerializedObject 而不是公开属性，避免不同 TMP 版本属性可访问性差异导致编译失败。
        var serialized = new SerializedObject(settings);

        var defaultProperty = serialized.FindProperty("m_defaultFontAsset");
        if (defaultProperty != null)
        {
            defaultProperty.objectReferenceValue = fontAsset;
        }
        else
        {
            Debug.LogWarning("TMP Settings 中找不到 m_defaultFontAsset 字段，默认字体未修改。");
        }

        // 全局 fallback 用于兜底：场景里已有的文本仍然显式引用 LiberationSans SDF，
        // 靠这一项才能让它们显示中文。
        var fallbackProperty = serialized.FindProperty("m_fallbackFontAssets");
        if (fallbackProperty != null)
        {
            fallbackProperty.arraySize = 1;
            fallbackProperty.GetArrayElementAtIndex(0).objectReferenceValue = fontAsset;
        }
        else
        {
            Debug.LogWarning("TMP Settings 中找不到 m_fallbackFontAssets 字段，全局 fallback 未修改。");
        }

        serialized.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(settings);
        AssetDatabase.SaveAssets();
    }

    private static TMP_Settings LoadTmpSettings()
    {
        var settings = AssetDatabase.LoadAssetAtPath<TMP_Settings>(TmpSettingsAssetPath);
        if (settings != null)
        {
            return settings;
        }

        var guids = AssetDatabase.FindAssets("t:TMP_Settings");
        if (guids.Length > 0)
        {
            return AssetDatabase.LoadAssetAtPath<TMP_Settings>(AssetDatabase.GUIDToAssetPath(guids[0]));
        }

        return null;
    }
}
