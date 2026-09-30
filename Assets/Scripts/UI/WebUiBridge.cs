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
/// 两个容易踩的坑，都已处理：
///   1) jsMethodsEnable 默认是关的，而 RegisterJsMethod 在关闭时会抛 NotEnabledException —— 必须显式开启。
///   2) UWB 的 JS 回调不保证在主线程，因此收到消息先入队，再在 Update 里派发；
///      否则订阅者直接改 UI 会抛 "can only be called from the main thread"。
///
/// 不需要手动挂载：AutoInstall 会在进入 Play 时自己找到 UWB 组件并挂上去。
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

    private WebBrowserClient client;
    private bool handshakeSent;

    // ---------------------------------------------------------------
    // 自动挂载
    // ---------------------------------------------------------------

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        // 必须写全 UnityEngine.Object：本文件同时 using System 和 UnityEngine，
        // 直接写 Object 会在 System.Object 和 UnityEngine.Object 之间产生 CS0104 歧义。
        var managers = UnityEngine.Object.FindObjectsByType<BaseUwbClientManager>(
            FindObjectsInactive.Include, FindObjectsSortMode.None);

        for (var i = 0; i < managers.Length; i++)
        {
            var manager = managers[i];
            if (manager == null || manager.GetComponent<WebUiBridge>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<WebUiBridge>();
            Debug.Log($"[WebUiBridge] 已挂到 “{manager.gameObject.name}” 上。");
        }
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

        // 还没连上时必须入队而不是丢弃。
        // 原因：剧情在 GameManager.Start() 就开跑，而 CEF 引擎要几秒才能连上，
        // 若在这里直接 return，开场第一句 dialogue.show 会永久丢失，玩家只能看到空白页面。
        if (!client.IsConnected || !client.ReadySignalReceived)
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
