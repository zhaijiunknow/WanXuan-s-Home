using System;
using System.Collections.Generic;
using UnityEngine;
using VoltstroStudios.UnityWebBrowser.Core;

/// <summary>
/// UWB ↔ Web 前端的双向桥接。
///
/// 分工（关键设计，别搞反）：
///   C# 是权威 —— 剧情的推进、分支、结局全部由 StoryManager 决定。
///   JS 是哑视图 —— 只负责渲染，并把玩家的动作回报给 C#。
/// 这样将来无论换成 Vuplex、UWB，还是回退到原生 Unity UI，需要改的只有"谁来渲染"。
///
/// 协议信封（与 WebUI/app.js 里的 BRIDGE_VERSION 必须一致）：
///   C# → JS   { v:1, type:"…", payload:{…} }
///   JS → C#   { v:1, type:"…", payload:{…} }
///
/// 三个容易踩的坑，都已处理：
///   1) jsMethodsEnable 默认是关的，而 RegisterJsMethod 在关闭时会抛 NotEnabledException —— 必须显式开启。
///   2) UWB 的 JS 回调不保证在主线程，因此收到消息先入队，再在 Update 里派发；
///      否则订阅者直接改 UI 会抛 "can only be called from the main thread"。
///   3) **引擎就绪 ≠ 网页能收**。`ReadySignalReceived` 是引擎级信号
///      （WebBrowserClient 里那句 "UWB startup success, connecting…"），它只说明 CEF 进程起来了，
///      此时网页的脚本可能还没跑完 —— 那时候往外发，消息会被执行成
///      "Uncaught TypeError: window.__vnReceive is not a function" 然后**静默丢掉**。
///      所以发送要等网页自己发来的 `ready` 才放行（见 PostRaw / Update）。
///
/// 不需要手动挂载：AutoInstall 会在进入 Play 时自己找到 UWB 组件并挂上去，
/// 之后每次场景载入也会再挂一次（见 UwbAutoInstall）。
/// </summary>
public class WebUiBridge : MonoBehaviour
{
    /// <summary>当前协议版本，必须与 WebUI/app.js 的 BRIDGE_VERSION 一致。</summary>
    public const int BridgeVersion = 1;

    /// <summary>场景里唯一的桥接实例，供 Web 视图订阅。</summary>
    public static WebUiBridge Instance { get; private set; }

    /// <summary>在主线程派发的"收到 JS 消息"事件，参数是原始 JSON 信封。</summary>
    public event Action<string> MessageReceived;

    private readonly Queue<string> incoming = new Queue<string>();

    /// <summary>未连接时暂存待发消息，连上后按序补发。</summary>
    private readonly Queue<string> outgoing = new Queue<string>();

    /// <summary>待发队列上限，防止长时间连不上时无限增长。</summary>
    private const int OutgoingQueueLimit = 64;

    /// <summary>
    /// 引擎就绪之后最多再等网页多久才不管三七二十一开始发。
    ///
    /// 正常路径用不到它：网页画好第一帧就发 `ready`，通常在 1 秒内。
    /// 留着是为了"网页改了但忘了发 ready / 页面启动时抛异常"这类情况 ——
    /// 那时候宁可按已就绪处理（消息可能白丢），也不能让剧情一句都发不出去。
    /// </summary>
    private const float ReadyFallbackSeconds = 3f;

    private WebBrowserClient client;
    private bool handshakeSent;

    /// <summary>网页说过 `ready` 了没有 —— 见 PostRaw 的闸门。不是"引擎连上了"。</summary>
    private bool pageReady;

    /// <summary>引擎就绪的时刻，给 ReadyFallbackSeconds 兜底计时用。负数表示还没就绪。</summary>
    private float engineReadyAt = -1f;

    // ---------------------------------------------------------------
    // 自动挂载
    // ---------------------------------------------------------------

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        // 走 UwbAutoInstall：启动场景立即挂一次，之后每次场景载入再挂一次。
        // 游戏场景那台 WebView（BrowserController）是全新对象，不补挂就是断的 ——
        // 见 UwbAutoInstall 的类注释：这件事和 WebUiBridge 里的 ready 闸门是一套。
        UwbAutoInstall.Register(Install);
    }

    private static void Install()
    {
        // 诊断：用来区分 "AutoInstall 根本没执行到" 和 "执行了但没找到 UWB 组件"。
        // 每次场景载入都会打一条，切场景后应当看到新场景名。
        var found = UwbAutoInstall.Attach<WebUiBridge>("WebUiBridge");

        Debug.Log($"[WebUiBridge] AutoInstall：场景={UnityEngine.SceneManagement.SceneManager.GetActiveScene().name}" +
                  $"，找到 {found} 个 BaseUwbClientManager");
    }

    private void Awake()
    {
        Instance = this;

        var manager = GetComponent<BaseUwbClientManager>();
        if (manager == null)
        {
            manager = GetComponentInParent<BaseUwbClientManager>();
        }

        if (manager == null)
        {
            Debug.LogError("[WebUiBridge] 同一物体上找不到 UWB 组件，桥接未建立。");
            return;
        }

        client = manager.browserClient;
        if (client == null)
        {
            Debug.LogError("[WebUiBridge] manager.browserClient 为空，桥接未建立。");
            return;
        }

        // 必须显式开启，否则 RegisterJsMethod 会抛 NotEnabledException
        client.jsMethodManager.jsMethodsEnable = true;

        client.RegisterJsMethod<string>("OnWebMessage", OnWebMessage);

        Debug.Log("[WebUiBridge] 已注册 OnWebMessage，jsMethods 已开启。");
    }

    private void OnDestroy()
    {
        if (Instance == this)
        {
            Instance = null;
        }
    }

    // ---------------------------------------------------------------
    // JS → C#
    // ---------------------------------------------------------------

    /// <summary>网页调用 uwb.ExecuteJsMethod('OnWebMessage', jsonString) 时进到这里。</summary>
    private void OnWebMessage(string json)
    {
        // 这里可能不在主线程，只入队，不碰任何 Unity API
        lock (incoming)
        {
            incoming.Enqueue(json);
        }
    }

    /// <summary>为方便调用方读取，把 JSON 信封的 type 字段解出来。失败返回 null。</summary>
    public static string ReadType(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return null;
        }

        try
        {
            // JsonUtility 会忽略未知字段，所以只声明 type 也能解析带 payload 的信封
            var envelope = JsonUtility.FromJson<Envelope>(json);
            return envelope != null ? envelope.type : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    // ---------------------------------------------------------------
    // C# → JS
    // ---------------------------------------------------------------

    /// <summary>发送一个带 JSON payload 的信封。</summary>
    public void Post(string type, string payloadJson)
    {
        var payload = string.IsNullOrEmpty(payloadJson) ? "{}" : payloadJson;
        PostRaw($"{{\"v\":{BridgeVersion},\"type\":\"{type}\",\"payload\":{payload}}}");
    }

    /// <summary>发送一条已经拼好的原始 JSON 信封。</summary>
    public void PostRaw(string json)
    {
        if (client == null)
        {
            return;
        }

        // 还没连上、或者网页还没说 ready，都必须入队而不是丢弃。
        // 原因：剧情在 GameManager.Start() 就开跑，而 CEF 引擎要几秒才能连上；
        // 若在这里直接 return，开场第一句 dialogue.show 会永久丢失，玩家只能看到空白页面。
        //
        // ⚠ `!pageReady` 这一条是**必须**的，不是保守：`ReadySignalReceived` 只代表
        //    CEF 进程起来了，网页脚本那时可能还没跑完 —— 一旦提前发出去，消息会被
        //    v8 执行成 "Uncaught TypeError: window.__vnReceive is not a function" 并静默丢掉。
        //    实测过：开场四条（握手 / story.load / 幕标题 / 第一句）全丢，
        //    玩家看到的是空白对话框，点一下直接跳到第二句。
        if (!client.IsConnected || !client.ReadySignalReceived || !pageReady)
        {
            lock (outgoing)
            {
                if (outgoing.Count >= OutgoingQueueLimit)
                {
                    outgoing.Dequeue();
                }

                outgoing.Enqueue(json);
            }

            return;
        }

        SendNow(json);
    }

    private void SendNow(string json)
    {
        // 单引号包裹 JS 字符串字面量，因此反斜杠与单引号必须转义；换行先去掉
        var escaped = json
            .Replace("\\", "\\\\")
            .Replace("'", "\\'")
            .Replace("\r", string.Empty)
            .Replace("\n", "\\n");

        client.ExecuteJs($"window.__vnReceive('{escaped}');");
    }

    private void FlushOutgoing()
    {
        while (true)
        {
            string json;

            lock (outgoing)
            {
                if (outgoing.Count == 0)
                {
                    break;
                }

                json = outgoing.Dequeue();
            }

            SendNow(json);
        }
    }

    // ---------------------------------------------------------------
    // 主循环
    // ---------------------------------------------------------------

    private void Update()
    {
        DrainIncoming();

        if (client == null)
        {
            return;
        }

        if (!client.IsConnected || !client.ReadySignalReceived)
        {
            return;
        }

        // 引擎就绪的时刻（只记一次），给下面的兜底计时用。
        if (engineReadyAt < 0f)
        {
            engineReadyAt = Time.unscaledTime;
        }

        /* 等网页开口。见类注释第 3 条：引擎就绪不等于网页能收消息。
           `ready` 是网页自己发的（游戏页在 app.js 的 init 收尾、主菜单页在首帧之后），
           两页都是**先注册订阅者、再发 ready**，所以收到它就意味着"发过去有人接"。 */
        if (!pageReady)
        {
            if (Time.unscaledTime - engineReadyAt < ReadyFallbackSeconds)
            {
                return;
            }

            pageReady = true;
            Debug.LogWarning(
                $"[WebUiBridge] 引擎就绪 {ReadyFallbackSeconds:0.#} 秒仍未收到网页 ready，" +
                "按已就绪处理（网页可能启动时报错了，或者页面忘了发 ready）。");
        }

        // 连上后先把积压的消息按序补发 —— 里面很可能就有剧情开场的第一句
        FlushOutgoing();

        // 再发一条握手，明确告诉网页"C# 在这儿"
        if (handshakeSent)
        {
            return;
        }

        handshakeSent = true;
        Post("hello", "{\"from\":\"C#\"}");
        Debug.Log("[WebUiBridge] 已向网页发出握手消息。");
    }

    private void DrainIncoming()
    {
        while (true)
        {
            string json;

            lock (incoming)
            {
                if (incoming.Count == 0)
                {
                    break;
                }

                json = incoming.Dequeue();
            }

            Debug.Log($"[WebUiBridge] C# ← JS：{json}");

            // 网页说「我画好了、订阅者也挂上了，可以发消息给我了」。
            // 这是 C# 唯一敢往外发东西的时刻 —— 见 PostRaw 的闸门。
            if (!pageReady && ReadType(json) == "ready")
            {
                pageReady = true;
                Debug.Log("[WebUiBridge] 网页已就绪（ready），开始往外发。");
            }

            var handler = MessageReceived;
            if (handler != null)
            {
                handler(json);
            }
        }
    }

    // ---------------------------------------------------------------
    // 信封与 payload 的可序列化结构（给 JsonUtility 用）
    // ---------------------------------------------------------------

    [Serializable]
    public class Envelope
    {
        public int v;
        public string type;
    }

    /// <summary>choice.selected 的 payload。</summary>
    [Serializable]
    public class ChoiceSelectedPayload
    {
        public int index;
        public string next;
        public string label;
    }

    [Serializable]
    public class ChoiceSelectedMessage
    {
        public int v;
        public string type;
        public ChoiceSelectedPayload payload;
    }
}
