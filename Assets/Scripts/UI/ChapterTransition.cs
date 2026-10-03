using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

/// <summary>
/// 过场层：换场景（以及以后幕与幕之间）那一下的演出，**每幕一条配方**。
///
/// ---------------------------------------------------------------------------
/// 这一版在演什么（照用户给的方案做的）
/// ---------------------------------------------------------------------------
///   1. **主题的颜色铺底**：整屏先是一片当前主题的光；
///   2. **从屏幕中心长出大小不一、颜色不一的色块**：色块按"离中心多远"依次出现，
///      每一块的颜色是**从 Unity 场景对应位置取来的**（所以不是马赛克乱糊，
///      是这个房间自己一块块长出来）；
///   3. **铺满之后停住**：这时整屏是"用真实颜色拼出来的一张静帧"，
///      顺便就是"还在装载"的样子 —— 它会一直停到网页发来 `ready`；
///   4. **色块化掉**：色块渐隐，底色同时透明（底色被色块压着，其实看它一眼也看不见），
///      露出的是真正的 Unity 场景。色块颜色本来就取自场景，所以这一步几乎看不出接缝。
///
/// 也就是说：**装载 = 用这个房间自己的颜色把房间拼出来**。
///
/// ---------------------------------------------------------------------------
/// 取色为什么不抓屏，而是"临时相机渲进小 RT"
/// ---------------------------------------------------------------------------
/// `ScreenCapture` 抓的是当前屏幕 —— 而此刻屏幕上盖着这一层，抓回来就是自己。
/// 要在切换**之前**抓，又得再引入一次握手。所以这里另起一台相机、
/// 把主相机的参数复制过去、`cullingMask` 全开、手动 `Render()` 一次到一张
/// 96x54 的小 RT 上，再读回内存取色。它只在内存里跑一帧，屏幕上什么都看不见。
///
/// ---------------------------------------------------------------------------
/// 每幕不同的地方在下面的 Recipes 表里
/// ---------------------------------------------------------------------------
/// 机制一套，每幕换的是**参数**：色块数量、铺满多快、化掉多快、色块的明暗差异。
/// 表里没写的幕走最后那条默认，所以表没写完也不会坏。加一幕 ＝ 加一条数据。
///
/// ⚠ 收尾判据是网页发来的 `ready`（页面已经画过一帧），不是"引擎就绪" ——
///   引擎就绪时网页脚本还没跑，提前化开会露出空房间。等不到就 4 秒兜底。
/// </summary>
public class ChapterTransition : MonoBehaviour
{
    /// <summary>压过 WebView 那层 Canvas（100）与别的 UI：过场期间网页是被这层盖着的。</summary>
    private const int SortingOrder = 32000;

    /// <summary>取色用的小 RT 尺寸。只用来取颜色，粗糙没关系。</summary>
    private const int SampleWidth = 96;
    private const int SampleHeight = 54;

    /// <summary>取每个色块颜色时，在它中心附近取几个点平均（3x3）。</summary>
    private const int SampleGrid = 3;

    /// <summary>等网页 ready 的上限；等不到也化开，并留一条 warning。</summary>
    private const float ReadyTimeoutSeconds = 4f;

    /// <summary>
    /// 底色被切成多少块。**底色的颜色是同一个**，切分不是为了好看，是为了"能对位地消失"：
    /// 场景块走的时候，它底下那一块底色要跟着走，那个位置就露出真实场景。
    /// 所以块数不用多 —— 它只在化开那一段才看得出来。
    /// </summary>
    private const int BaseTileCount = 22;

    /// <summary>换场景之后等几帧再取色 —— 要等新场景真的画出第一帧。</summary>
    private const int CaptureDelayFrames = 2;

    /// <summary>
    /// 每一块**自己**冒出来用多久 —— 很短，是"啪一下出现"。
    ///
    /// ⚠ 这个数和"每块间隔"是两回事，两个一起决定手感：
    ///   每块间隔 = 配方的 assembleSeconds ÷ 块数（现在 1-1 大约是 122ms）
    ///   每块停留 = 间隔 − 这个数（现在大约 90ms）
    /// 所以"每块停留久一点"要**同时**做两件事：把 assembleSeconds 拉长、
    /// 把这里压短。只拉长前者会变成"慢慢淡出来"，读不出"一块一块"。
    /// </summary>
    private const float AppearPopSeconds = 0.03f;

    /// <summary>每一块化掉用多久。比出现稍软一点，消失不该比出现更"硬"。</summary>
    private const float VanishPopSeconds = 0.05f;

    // ---------------------------------------------------------------
    // 配方表：每幕一条。key 是幕名（剧本里的 marker id，如 "1-1"）。
    // ---------------------------------------------------------------

    private struct Recipe
    {
        /// <summary>幕名。空字符串 = 默认（表里没写的幕都走这条）。</summary>
        public string key;

        /// <summary>色块数量。越多越细。</summary>
        public int leafCount;

        /// <summary>从中心铺满用多久。</summary>
        public float assembleSeconds;

        /// <summary>铺满之后化掉用多久。</summary>
        public float dissolveSeconds;

        /// <summary>色块的明暗差异（0 = 完全忠于取色）。会在化掉的过程中衰减到 0。</summary>
        public float variation;

        /// <summary>这条配方在演什么。</summary>
        public string note;
    }

    private static readonly Recipe[] Recipes =
    {
        new Recipe
        {
            key = "1-1",
            // 覆盖率是这一层的构图预算：块数 × 单块面积。现在块小、数量也少，
            // 合计约占两成画面 —— 剩下的八成是主题色的底，只有几处块叠在一起。
            // 节奏：18 块配 2.2s ≈ 每块 122ms 一次，其中 30ms 出现、约 90ms 停着。
            // 这个时长也正好填满 CEF 那段等待，不会"很快铺完然后干等"。
            leafCount = 18,
            assembleSeconds = 2.2f,    // S01 是安静的一幕，铺得比别处慢
            dissolveSeconds = 0.75f,
            variation = 0.10f,
            note = "S01 寂静客厅：午后的光里，几块零散的房间颜色一块块浮上来，慢"
        },

        new Recipe
        {
            key = "",
            leafCount = 14,
            assembleSeconds = 1.6f,
            dissolveSeconds = 0.65f,
            variation = 0.08f,
            note = "默认（还没写配方的幕都走这条）"
        }
    };

    private static Recipe RecipeFor(string chapterKey)
    {
        for (var i = 0; i < Recipes.Length; i++)
        {
            if (!string.IsNullOrEmpty(Recipes[i].key) && Recipes[i].key == chapterKey)
            {
                return Recipes[i];
            }
        }

        return Recipes[Recipes.Length - 1];
    }

    // ---------------------------------------------------------------
    // 色块
    // ---------------------------------------------------------------

    private class Leaf
    {
        public Rect rect;       // 归一化（左下为原点），和 uGUI 的锚点一致
        public Image image;
        public Color colour;
        public float variation; // 这一块自己的明暗系数（只对场景块有意义）

        /// <summary>true = 场景取色的块（会一块块出现）；false = 底色切分出来的块（一直在，只跟着消失）。</summary>
        public bool isScene;

        /// <summary>什么时候出现（秒，相对"装载开始"）。只对场景块有意义。</summary>
        public float appearAt;

        /// <summary>
        /// 什么时候消失（秒，相对"化开开始"）。底色块和场景块都有 ——
        /// 底色的时间**跟着压在它上面的那块场景块**，所以色块一走、它底下那块底同时走，
        /// 那个位置就直接是真实场景了（这正是要把底色切分的原因）。
        /// </summary>
        public float dissolveAt;

        public float distance;  // 离屏幕中心多远（带抖动，用来排名次）
    }

    // ---------------------------------------------------------------

    private static ChapterTransition instance;

    private Canvas canvas;
    private CanvasGroup group;

    private List<Leaf> leaves = new List<Leaf>();

    /// <summary>这次过场一共用了几块（底色块 + 场景块）。</summary>
    private int activeCount;

    /// <summary>其中场景块有几块（出现的那一批）。</summary>
    private int sceneCount;

    private RenderTexture sampleRt;
    private Texture2D sampleTex;

    private Coroutine running;
    private WebUiBridge subscribedBridge;
    private bool pageReady;
    private bool switchPending;

    // ---------------------------------------------------------------
    // 主题的色值（与 animus.css 的四套主题一一对应）
    // ---------------------------------------------------------------

    private struct Wash
    {
        public Color lift;
        public Color mid;
        public Color deep;
    }

    private static Wash WashFor(string theme)
    {
        // ⚠ 和 WebUI/animus/animus.css 里 --ax-bg-lift / -mid / -deep 逐字对应。
        switch (theme)
        {
            case "evening":
                return new Wash { lift = Hex("2A1409"), mid = Hex("4A2410"), deep = Hex("7A3C14") };

            case "lamp":
                return new Wash { lift = Hex("1C120C"), mid = Hex("2A1B13"), deep = Hex("3E2820") };

            case "rain":
                return new Wash { lift = Hex("0C1016"), mid = Hex("161E28"), deep = Hex("24303C") };

            default: // noon（也是 DEFAULT_THEME）
                return new Wash { lift = Hex("FCF7EE"), mid = Hex("F6EEE0"), deep = Hex("EADFCB") };
        }
    }

    private static Color Hex(string hex)
    {
        var r = Convert.ToInt32(hex.Substring(0, 2), 16) / 255f;
        var g = Convert.ToInt32(hex.Substring(2, 2), 16) / 255f;
        var b = Convert.ToInt32(hex.Substring(4, 2), 16) / 255f;
        return new Color(r, g, b, 1f);
    }

    // ---------------------------------------------------------------
    // 自动挂载
    // ---------------------------------------------------------------

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        if (instance != null)
        {
            return;
        }

        var host = new GameObject("ChapterTransition", typeof(RectTransform));
        DontDestroyOnLoad(host);
        host.AddComponent<ChapterTransition>();
    }

    // ---------------------------------------------------------------
    // 生命周期
    // ---------------------------------------------------------------

    private void Awake()
    {
        if (instance != null && instance != this)
        {
            Destroy(gameObject);
            return;
        }

        instance = this;
        DontDestroyOnLoad(gameObject);

        Build();
    }

    private void OnEnable()
    {
        SceneManager.activeSceneChanged += OnActiveSceneChanged;
        SceneManager.sceneLoaded += OnSceneLoaded;
    }

    private void OnDisable()
    {
        SceneManager.activeSceneChanged -= OnActiveSceneChanged;
        SceneManager.sceneLoaded -= OnSceneLoaded;
    }

    private void OnDestroy()
    {
        if (instance == this)
        {
            instance = null;
        }

        Unsubscribe();
        ReleaseResources();
    }

    private void Update()
    {
        // 桥是每个场景一个新实例，所以每帧确认订阅（和 WebSceneFlow 同一套写法）。
        EnsureSubscribed();
    }

    // ---------------------------------------------------------------
    // 触发
    // ---------------------------------------------------------------

    private void OnActiveSceneChanged(Scene from, Scene to)
    {
        // 换场景的当帧就把主题色铺上：这一刻新场景还没画，屏幕上还是旧页面的最后一眼，
        // 而它正好也停在同一片主题光上 —— 接缝看不见。
        switchPending = true;

        // 配方在**盖上第一帧之前**就定下来（幕名从待续的 stepId 推）：
        // 底色的切分要一开始就成立，不然会看到"先是整片渐变、两帧后才变成一块块"。
        ShowBase(RecipeFor(ChapterKeyForEntry()));
    }

    private void OnSceneLoaded(Scene scene, LoadSceneMode mode)
    {
        // 启动时的第一个场景不算"切换"：主菜单有自己的开场，不该被这层盖住。
        if (!switchPending)
        {
            return;
        }

        switchPending = false;
        pageReady = false;
        Unsubscribe();

        StartTransition(ChapterKeyForEntry(), true);
    }

    /// <summary>
    /// 过场是不是正在演。剧情那边用它来等"**色块全部消失之后**再开始加载剧本" ——
    /// 所以在协程最后（化开完、这层隐藏之后）才置回 false，早一刻都不算完。
    /// </summary>
    public static bool IsBusy
    {
        get { return instance != null && instance.running != null; }
    }

    /// <summary>
    /// 按幕名演一次过场。
    ///
    /// 场景切换那条路已经通了（见 OnSceneLoaded）。**幕与幕之间那条还没接** ——
    /// 接的时候从 C# 发 `marker.show` 的地方调它（那里正好知道要进哪一幕）。
    /// </summary>
    public static void Play(string chapterKey, bool shortForm)
    {
        if (instance == null)
        {
            return;
        }

        instance.pageReady = shortForm;
        instance.ShowBase(RecipeFor(chapterKey));
        instance.StartTransition(chapterKey, !shortForm);
    }

    private void StartTransition(string chapterKey, bool waitForPage)
    {
        if (running != null)
        {
            StopCoroutine(running);
        }

        running = StartCoroutine(Transition(RecipeFor(chapterKey), chapterKey, waitForPage));
    }

    /// <summary>
    /// 从主菜单进游戏时该用哪一幕的配方。
    ///
    /// 继续游戏 / 章节跳跃都会先把目标 stepId 放进 StorySaveStore 的待续位
    /// （换场景之后才被 GameManager 取走），所以在这里读得到它；
    /// 点「开始游戏」时那个位置是空的 —— 那就是从头开始，也就是第一幕。
    /// </summary>
    private static string ChapterKeyForEntry()
    {
        var pending = StorySaveStore.PendingResumeStepId;

        if (!string.IsNullOrEmpty(pending))
        {
            return ChapterKeyOf(pending);
        }

        return "1-1";
    }

    /// <summary>"1-1-text-0002" → "1-1"；"ending-he" → "ending-he"。</summary>
    private static string ChapterKeyOf(string stepId)
    {
        var index = stepId.IndexOf("-text-", StringComparison.Ordinal);
        return index > 0 ? stepId.Substring(0, index) : stepId;
    }

    // ---------------------------------------------------------------
    // 一次过场
    // ---------------------------------------------------------------

    private IEnumerator Transition(Recipe recipe, string chapterKey, bool waitForPage)
    {
        Debug.Log($"[ChapterTransition] 过场：“{chapterKey}” —— {recipe.note}");

        // 1) 底色的切分已经在 ShowBase 里做完了（换场景当帧就盖上，而且那时就已经是一块块），
        //    场景块也已经在等着了（透明度 0）。这里只等新场景画出第一帧，好取色。
        for (var i = 0; i < CaptureDelayFrames; i++)
        {
            yield return new WaitForEndOfFrame();
        }

        var captured = CaptureAndColour(recipe);

        if (!captured)
        {
            Debug.LogWarning("[ChapterTransition] 取不到场景颜色（场景里没有可用相机），色块退回主题色。");
            ColourLeavesWithTheme(recipe);
        }

        // 2) 一块一块铺满：离屏幕中心越近的越先出现。
        //    多跑一个 PopSeconds —— 最后一块自己那 30ms 的"冒出来"也要走完，
        //    不然它会被硬切（看着就是最后闪一下）。
        var assemble = 0f;
        while (assemble < recipe.assembleSeconds + AppearPopSeconds)
        {
            assemble += Time.unscaledDeltaTime;
            ApplyAssemble(assemble, recipe);
            yield return null;
        }

        ApplyAssemble(recipe.assembleSeconds, recipe);

        // 3) 铺满了，就停在这儿等网页 —— 这时整屏是"用真实颜色拼出来的一张静帧"，
        //    顺便就是"还在装载"的样子。
        var deadline = Time.unscaledTime + ReadyTimeoutSeconds;
        while (!pageReady && Time.unscaledTime < deadline)
        {
            yield return null;
        }

        if (waitForPage && !pageReady)
        {
            Debug.LogWarning(
                $"[ChapterTransition] 等了 {ReadyTimeoutSeconds:0.#} 秒还没等到网页 ready，" +
                "先化开（网页可能启动时就抛异常了）。");
        }

        // 4) 化开：色块渐隐（明暗差异同时衰减到 0，所以最后一块块都回到取色本身），
        //    底同时透明。色块颜色本来就取自场景，所以这一步几乎看不出接缝。
        // 同样多跑一个 VanishPopSeconds：最后几块也要化干净再收这一层。
        var dissolve = 0f;
        while (dissolve < recipe.dissolveSeconds + VanishPopSeconds)
        {
            dissolve += Time.unscaledDeltaTime;
            ApplyDissolve(dissolve, recipe);
            yield return null;
        }

        ApplyDissolve(recipe.dissolveSeconds, recipe);

        Hide();

        running = null;

        Debug.Log("[ChapterTransition] 过场结束（房间拼出来 → 化开 → 露出真实场景）。");
    }

    // ---------------------------------------------------------------
    // 色块：切分、取色、出现、化开
    // ---------------------------------------------------------------

    /// <summary>
    /// 摆色块：**随机矩形** —— 大小不一、位置散乱、**允许互相叠加、也允许留缝**。
    ///
    /// 之前用的是二分空间切分（严格铺满、互不重叠），太整齐了，读起来像"马赛克"。
    /// 现在改成散乱摆放：
    ///   · 缝里露出的是**主题色的底** —— 那本来就是这一层的一部分，不是漏了；
    ///   · 叠起来的地方后摆的压住先摆的，消失时下面那块会露出来 —— 一层层揭开；
    ///   · 尺寸是"多数中等 + 少数偏大"，所以散乱但不至于糊成一块。
    /// </summary>
    private void BuildLeaves(Recipe recipe)
    {
        var baseCount = BaseTileCount;
        var total = baseCount + recipe.leafCount;

        // 对象池：只增不减，每次过场复用同一批 GameObject，只重算矩形。
        while (leaves.Count < total)
        {
            var go = new GameObject($"Leaf{leaves.Count}", typeof(RectTransform));
            go.transform.SetParent(transform, false);

            var image = go.AddComponent<Image>();
            image.raycastTarget = false;

            leaves.Add(new Leaf { image = image });
        }

        for (var i = 0; i < leaves.Count; i++)
        {
            leaves[i].image.gameObject.SetActive(i < total);
        }

        activeCount = total;
        sceneCount = recipe.leafCount;

        // 底色的颜色：**所有底色块同一个色**。切分不是为了好看，
        // 是为了"能对位地消失" —— 见下面第三步给每块算消失时间的地方。
        var baseColour = WashFor(CurrentTheme()).mid;

        // ---- 1) 底：把整屏**切分**成大小不一的块 ----
        // 二分空间切分保证严丝合缝铺满；每块取主题渐变在**自己位置**上的颜色 ——
        // 所以整片光还是那个渐变，只是成了一片片拼起来的。
        var tiles = Subdivide(baseCount);

        for (var i = 0; i < baseCount; i++)
        {
            var leaf = leaves[i];

            leaf.rect = tiles[i];
            leaf.isScene = false;
            leaf.variation = 1f;                        // 底不参与明暗差异
            leaf.colour = baseColour;                   // 同一个色，不随位置变
            leaf.image.color = baseColour;

            leaf.distance = Mathf.Sqrt(DistanceFromCentre(leaf.rect))
                            + UnityEngine.Random.Range(-0.16f, 0.16f);

            ApplyLeafRect(leaf);
        }

        // ---- 2) 上：散乱的场景块（随机矩形，允许叠加、允许留缝）----
        for (var i = 0; i < recipe.leafCount; i++)
        {
            var leaf = leaves[baseCount + i];

            leaf.isScene = true;

            // 大小不一：多数小，约五分之一稍大一点。
            // ⚠ 块**小**是这一层构图的关键之一：块大一点，两三块就能盖掉半个屏幕，
            //   "大部分是底色"这件事就不成立了。要调覆盖率，先看这里再看块数。
            var scale = UnityEngine.Random.value < 0.22f ? 1.6f : 1f;
            var width = UnityEngine.Random.Range(0.055f, 0.17f) * scale;
            var height = UnityEngine.Random.Range(0.045f, 0.14f) * scale;

            // 散乱：允许出画一点点（uGUI 的锚点可以是负数），这样四边不会显得空
            var x = UnityEngine.Random.Range(-width * 0.25f, 1f - width * 0.75f);
            var y = UnityEngine.Random.Range(-height * 0.25f, 1f - height * 0.75f);

            leaf.rect = new Rect(x, y, width, height);

            // 明暗差异：每一块自己的系数（0.75..1.25 之间随机），画的时候按 variation 插值
            leaf.variation = UnityEngine.Random.Range(0.75f, 1.25f);

            // 颜色要等取色那一步；先藏起来
            leaf.image.color = new Color(1f, 1f, 1f, 0f);

            // 名次：离屏幕中心越近越靠前，但**带抖动** ——
            // 所以是散乱地长出来，不是一圈整齐的涟漪。
            leaf.distance = Mathf.Sqrt(DistanceFromCentre(leaf.rect))
                            + UnityEngine.Random.Range(-0.16f, 0.16f);

            ApplyLeafRect(leaf);
        }

        // ---- 3) 两套时间 ----
        // 出现：只在场景块之间排队 —— 离屏幕中心越近越先，带抖动（这一套看着对了，不动）。
        var scene = new List<Leaf>();
        for (var i = 0; i < recipe.leafCount; i++)
        {
            scene.Add(leaves[baseCount + i]);
        }

        scene.Sort((a, b) => a.distance.CompareTo(b.distance));

        var appearStep = recipe.assembleSeconds / Mathf.Max(1, scene.Count);

        for (var rank = 0; rank < scene.Count; rank++)
        {
            scene[rank].appearAt = rank * appearStep;
        }

        // 消失：**随机顺序** —— 把顺序洗过再均匀铺满整段，所以是"零散地一块块没"，
        // 不是从中心一圈圈退回去。再加一点小抖动，免得节奏太机械。
        var vanishOrder = new List<Leaf>(scene);
        Shuffle(vanishOrder);

        var vanishStep = recipe.dissolveSeconds / Mathf.Max(1, vanishOrder.Count);

        for (var rank = 0; rank < vanishOrder.Count; rank++)
        {
            vanishOrder[rank].dissolveAt = Mathf.Max(0f,
                rank * vanishStep + UnityEngine.Random.Range(-0.015f, 0.015f));
        }

        // 消失：底色块**跟着压在它上面的那块场景块**走（取最早的那块）。
        // 这是把底色切分的全部理由 —— 色块一走，它底下那块底同时走，
        // 那个位置当场就是真实场景，不会留一块底色在那儿。
        var loose = new List<Leaf>();
        var looseStep = recipe.dissolveSeconds * 0.8f / Mathf.Max(1, baseCount);

        for (var i = 0; i < baseCount; i++)
        {
            var tile = leaves[i];
            var earliest = float.MaxValue;

            for (var k = 0; k < scene.Count; k++)
            {
                if (tile.rect.Overlaps(scene[k].rect) && scene[k].dissolveAt < earliest)
                {
                    earliest = scene[k].dissolveAt;
                }
            }

            if (earliest < float.MaxValue)
            {
                tile.dissolveAt = earliest;
            }
            else
            {
                tile.dissolveAt = -1f;   // 先占位，下面按名次分配
                loose.Add(tile);
            }
        }

        // 没被任何场景块压到的底色块：也**随机**分散在化开的后 80% 里，
        // 所以它们同样是一块块零散地走，不会在开头一起没。
        Shuffle(loose);

        for (var rank = 0; rank < loose.Count; rank++)
        {
            loose[rank].dissolveAt = Mathf.Max(0f,
                recipe.dissolveSeconds * 0.2f + rank * looseStep + UnityEngine.Random.Range(-0.015f, 0.015f));
        }
    }

    /// <summary>Fisher–Yates 洗牌。消失的顺序用它 —— 随机，但仍是"一块一块"。</summary>
    private static void Shuffle(List<Leaf> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = UnityEngine.Random.Range(0, i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    /// <summary>
    /// 二分空间切分：把整屏切成**大小不一但严丝合缝铺满**的矩形。
    /// 每次挑最大的一块，沿它长的那一边随机切一刀（切口在中间 35%~65%）。
    /// 底色用它 —— 底必须是"铺满且被切过"的，漏缝就会露出别的东西。
    /// </summary>
    private static List<Rect> Subdivide(int count)
    {
        var rects = new List<Rect> { new Rect(0f, 0f, 1f, 1f) };

        while (rects.Count < count)
        {
            // 挑最大的一块来切（面积大的先切，尺寸分布才均匀）
            var pick = 0;
            var best = -1f;

            for (var i = 0; i < rects.Count; i++)
            {
                var area = rects[i].width * rects[i].height;
                if (area > best)
                {
                    best = area;
                    pick = i;
                }
            }

            var rect = rects[pick];
            rects.RemoveAt(pick);

            var cut = UnityEngine.Random.Range(0.35f, 0.65f);

            if (rect.width >= rect.height)
            {
                var left = rect.width * cut;
                rects.Add(new Rect(rect.x, rect.y, left, rect.height));
                rects.Add(new Rect(rect.x + left, rect.y, rect.width - left, rect.height));
            }
            else
            {
                var bottom = rect.height * cut;
                rects.Add(new Rect(rect.x, rect.y, rect.width, bottom));
                rects.Add(new Rect(rect.x, rect.y + bottom, rect.width, rect.height - bottom));
            }
        }

        return rects;
    }

    private static float DistanceFromCentre(Rect rect)
    {
        var dx = rect.center.x - 0.5f;
        var dy = rect.center.y - 0.5f;
        return dx * dx + dy * dy;
    }

    private void ApplyLeafRect(Leaf leaf)
    {
        var rect = (RectTransform)leaf.image.transform;
        rect.anchorMin = new Vector2(leaf.rect.xMin, leaf.rect.yMin);
        rect.anchorMax = new Vector2(leaf.rect.xMax, leaf.rect.yMax);
        rect.offsetMin = Vector2.zero;
        rect.offsetMax = Vector2.zero;
    }

    /// <summary>
    /// 装载：**一块一块出现**。
    /// 第 rank 块在第 `rank × (assembleSeconds / 块数)` 秒出现，自己只花 PopSeconds 冒出来 ——
    /// 所以同一时刻基本只有一块在动，读起来是一块接一块地长出来。
    /// </summary>
    private void ApplyAssemble(float elapsed, Recipe recipe)
    {
        // 只有场景块会"出现"；底色块一开始就在。出现时间在 BuildLeaves 里算好了。
        var pop = Mathf.Max(0.001f, AppearPopSeconds);

        for (var i = 0; i < leaves.Count; i++)
        {
            var leaf = leaves[i];
            if (!leaf.image.gameObject.activeSelf || !leaf.isScene)
            {
                continue;
            }

            var alpha = Mathf.Clamp01((elapsed - leaf.appearAt) / pop);

            // 明暗差异按 variation 缩放：variation=0 时就是取色本身
            var shade = Mathf.Lerp(1f, leaf.variation, recipe.variation);

            leaf.image.color = new Color(
                Mathf.Clamp01(leaf.colour.r * shade),
                Mathf.Clamp01(leaf.colour.g * shade),
                Mathf.Clamp01(leaf.colour.b * shade),
                alpha);
        }
    }

    /// <summary>
    /// 化开：**一块一块消失**（同一套排队，所以中心先走、外面的后走）。
    /// 明暗差异同时衰减到 0，所以最后一块块都回到取色本身，接缝最小。
    /// </summary>
    private void ApplyDissolve(float elapsed, Recipe recipe)
    {
        // 底色块与场景块**都在走**，时间在 BuildLeaves 里算好了：
        // 场景块按自己的排队走，底色块跟着压在它上面的那块走 —— 所以是整体逐渐消失。
        var pop = Mathf.Max(0.001f, VanishPopSeconds);

        var remaining = 1f - Mathf.Clamp01(elapsed / Mathf.Max(0.001f, recipe.dissolveSeconds));

        for (var i = 0; i < leaves.Count; i++)
        {
            var leaf = leaves[i];
            if (!leaf.image.gameObject.activeSelf)
            {
                continue;
            }

            var alpha = 1f - Mathf.Clamp01((elapsed - leaf.dissolveAt) / pop);

            var shade = Mathf.Lerp(1f, leaf.variation, recipe.variation * remaining);

            leaf.image.color = new Color(
                Mathf.Clamp01(leaf.colour.r * shade),
                Mathf.Clamp01(leaf.colour.g * shade),
                Mathf.Clamp01(leaf.colour.b * shade),
                alpha);
        }
    }

    private void ColourLeavesWithTheme(Recipe recipe)
    {
        var wash = WashFor(CurrentTheme());

        for (var i = 0; i < leaves.Count; i++)
        {
            // 只处理场景块；底色块的颜色本来就来自主题渐变
            if (!leaves[i].isScene)
            {
                continue;
            }

            leaves[i].colour = Color.Lerp(wash.lift, wash.deep, leaves[i].rect.center.y);
        }
    }

    // ---------------------------------------------------------------
    // 取色
    // ---------------------------------------------------------------

    /// <summary>
    /// 用一台临时相机把当前场景渲进一张小 RT，再读回内存 ——
    /// 然后每个色块取自己中心附近的颜色。成功返回 true。
    /// </summary>
    private bool CaptureAndColour(Recipe recipe)
    {
        var source = Camera.main != null ? Camera.main : FindAnyCamera();

        if (source == null)
        {
            return false;
        }

        if (sampleRt == null)
        {
            // sRGB：读回来的值要和 uGUI 用的颜色在同一个空间里，否则色块会偏暗/偏灰
            sampleRt = new RenderTexture(SampleWidth, SampleHeight, 0,
                RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
            {
                name = "ChapterTransitionSample"
            };

            sampleRt.Create();
        }

        var host = new GameObject("ChapterTransitionSampleCamera");
        var camera = host.AddComponent<Camera>();

        camera.CopyFrom(source);
        camera.targetTexture = sampleRt;
        camera.cullingMask = ~0;   // 要"整屏的颜色"，所以所有层都画
        camera.enabled = false;

        camera.Render();

        var previous = RenderTexture.active;
        RenderTexture.active = sampleRt;

        if (sampleTex == null)
        {
            sampleTex = new Texture2D(SampleWidth, SampleHeight, TextureFormat.RGB24, false)
            {
                name = "ChapterTransitionSampleRead"
            };
        }

        sampleTex.ReadPixels(new Rect(0, 0, SampleWidth, SampleHeight), 0, 0);
        sampleTex.Apply();

        RenderTexture.active = previous;

        camera.targetTexture = null;
        Destroy(host);

        for (var i = 0; i < leaves.Count; i++)
        {
            var leaf = leaves[i];

            // 底色块不取色 —— 它的颜色来自主题渐变（见 SampleWash）。
            if (!leaf.isScene)
            {
                continue;
            }

            // 色块中心（归一化，左下为原点 —— 和贴图的 uv 同向）
            var cx = Mathf.Clamp01(leaf.rect.center.x);
            var cy = Mathf.Clamp01(leaf.rect.center.y);

            var total = Color.black;

            for (var gy = 0; gy < SampleGrid; gy++)
            {
                for (var gx = 0; gx < SampleGrid; gx++)
                {
                    // 在色块内部取 3x3 个点，避免正好采到一条边
                    var u = Mathf.Clamp01(leaf.rect.xMin + leaf.rect.width * (0.25f + 0.5f * gx / (SampleGrid - 1)));
                    var v = Mathf.Clamp01(leaf.rect.yMin + leaf.rect.height * (0.25f + 0.5f * gy / (SampleGrid - 1)));

                    total += sampleTex.GetPixel(
                        Mathf.Clamp(Mathf.RoundToInt(u * (SampleWidth - 1)), 0, SampleWidth - 1),
                        Mathf.Clamp(Mathf.RoundToInt(v * (SampleHeight - 1)), 0, SampleHeight - 1));
                }
            }

            var count = SampleGrid * SampleGrid;
            leaf.colour = new Color(total.r / count, total.g / count, total.b / count, 1f);

            // 保护：完全取不到颜色时退回主题色，别让色块变黑块
            if (leaf.colour.r + leaf.colour.g + leaf.colour.b < 0.02f)
            {
                leaf.colour = Color.Lerp(WashFor(CurrentTheme()).lift, WashFor(CurrentTheme()).deep, cy);
            }
        }

        Debug.Log($"[ChapterTransition] 已从场景取色（{sceneCount} 块，{SampleWidth}x{SampleHeight}）。");
        return true;
    }

    /// <summary>
    /// 挑一台相机用来取色。
    ///
    /// ⚠ 优先挑**带背景的**那台（Skybox / SolidColor）：MainRoom 里有两台相机，
    /// 立绘那台是 `clearFlags: Nothing`（背景透明），挑到它就等于对着空气取色，
    /// 色块会变成一片空的。房间那台才是"整屏颜色"的来源。
    /// </summary>
    private static Camera FindAnyCamera()
    {
        var cameras = UnityEngine.Object.FindObjectsByType<Camera>(
            FindObjectsInactive.Exclude, FindObjectsSortMode.None);

        Camera fallback = null;

        for (var i = 0; i < cameras.Length; i++)
        {
            var camera = cameras[i];
            if (camera == null || !camera.enabled || camera.targetTexture != null)
            {
                continue;
            }

            if (camera.clearFlags == CameraClearFlags.Skybox || camera.clearFlags == CameraClearFlags.SolidColor)
            {
                return camera;
            }

            if (fallback == null)
            {
                fallback = camera;
            }
        }

        return fallback;
    }

    // ---------------------------------------------------------------
    // 那层东西本身
    // ---------------------------------------------------------------

    private void Build()
    {
        canvas = gameObject.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = SortingOrder;

        group = gameObject.AddComponent<CanvasGroup>();
        group.alpha = 0f;
        group.blocksRaycasts = false;
        canvas.enabled = false;

        // 底：当前主题的光。这里**不再有整屏 quad** —— 底就是那些切分出来的块，
        // 它们自己会逐渐消失（跟着压在它们上面的场景块），所以不存在
        // "化开还没开始、底色先整片没了"这件事。

        canvas.enabled = false;
    }

    private void ShowBase(Recipe recipe)
    {
        // 底色的切分 + 场景块的摆放（位置、大小、出现与消失的时间）都在这里定下来。
        // 所以换场景当帧盖上的就已经是"切分过的底"，不是一整片渐变。
        BuildLeaves(recipe);

        canvas.enabled = true;
        group.alpha = 1f;

        // 过场期间挡住点击：不然玩家在过场画面上点一下就是在操作底下的网页。
        group.blocksRaycasts = true;
    }

    private void Hide()
    {
        group.alpha = 0f;
        group.blocksRaycasts = false;
        canvas.enabled = false;

        for (var i = 0; i < leaves.Count; i++)
        {
            leaves[i].image.gameObject.SetActive(false);
        }
    }

    private void ReleaseResources()
    {
        if (sampleTex != null)
        {
            Destroy(sampleTex);
            sampleTex = null;
        }

        if (sampleRt != null)
        {
            sampleRt.Release();
            Destroy(sampleRt);
            sampleRt = null;
        }
    }

    // ---------------------------------------------------------------
    // 桥：等 ready，顺便收网页报过来的主题
    // ---------------------------------------------------------------

    private void EnsureSubscribed()
    {
        var bridge = WebUiBridge.Instance;
        if (bridge == subscribedBridge)
        {
            return;
        }

        Unsubscribe();
        subscribedBridge = bridge;

        if (subscribedBridge != null)
        {
            subscribedBridge.MessageReceived += HandleMessage;
        }
    }

    private void Unsubscribe()
    {
        if (subscribedBridge == null)
        {
            return;
        }

        subscribedBridge.MessageReceived -= HandleMessage;
        subscribedBridge = null;
    }

    private void HandleMessage(string json)
    {
        var type = WebUiBridge.ReadType(json);

        if (type == "ready")
        {
            pageReady = true;
            return;
        }

        // 网页把**正在生效**的那套主题报过来（主题模式可能是 time / story，
        // 不一定是设置里存的那个），底色按它取。
        if (type == "ui.theme")
        {
            try
            {
                var message = JsonUtility.FromJson<ThemeMessage>(json);
                var theme = message != null && message.payload != null ? message.payload.theme : null;

                if (!string.IsNullOrEmpty(theme))
                {
                    reportedTheme = theme;
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[ChapterTransition] ui.theme 解析失败：{exception.Message}");
            }
        }
    }

    private static string reportedTheme;

    private static string CurrentTheme()
    {
        if (!string.IsNullOrEmpty(reportedTheme))
        {
            return reportedTheme;
        }

        var settings = UiSettingsStore.Current;
        if (settings != null && !string.IsNullOrEmpty(settings.animusTheme))
        {
            return settings.animusTheme;
        }

        return "noon";
    }

    [Serializable]
    private class ThemePayload
    {
        public string theme;
    }

    [Serializable]
    private class ThemeMessage
    {
        public int v;
        public string type;
        public ThemePayload payload;
    }
}
