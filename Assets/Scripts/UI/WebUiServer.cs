using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using UnityEngine;
using VoltstroStudios.UnityWebBrowser.Core;

/// <summary>
/// 把 WebUI 目录用本机 HTTP 伺服起来，并让 WebView 从 http://localhost 载入页面。
///
/// ---------------------------------------------------------------------------
/// 为什么需要它（一句话：file:// 下 fetch 是死的）
/// ---------------------------------------------------------------------------
/// 页面里有三样东西必须用 fetch/XHR 才拿得到，而 CEF 在 file:// 下会一律拒绝
/// （和当初 fetch('story.json') 被拒是同一个原因，不是配置问题，是协议限制）：
///
///   1. Live2D 的 2-3.moc3 —— 二进制，必须进 ArrayBuffer，绕不开 fetch
///   2. story.json（如果要用回 JSON 格式的剧本）
///   3. 中文字体 ChillRoundF.ttf —— @font-face 跨目录取字体同样被 CORS 拒，
///      所以在此之前**菜单和游戏其实一直在用系统字体**（HUD 上那句"未加载"就是它）
///
/// 换到 http://localhost 之后同源，这三件事一起解决。
/// 图片（<img>）和脚本（<script src>）本来就不受这个限制，所以贴图和 story.js 之前是好的。
///
/// ---------------------------------------------------------------------------
/// 为什么是 localhost 而不是 127.0.0.1 / * / +
/// ---------------------------------------------------------------------------
/// HttpListener 的前缀 http://localhost:端口/ 是**非管理员也能注册**的特例；
/// http://+:端口/ 和 http://*:端口/ 需要管理员权限或预先做 URL ACL 保留。
/// 所以这里固定用 localhost。
///
/// ---------------------------------------------------------------------------
/// 起始页从哪来：**沿用场景里已经填好的 initialUrl**
/// ---------------------------------------------------------------------------
/// 场景的 browserClient.initialUrl 形如
///   file:///D:/.../WebUI/menu/index.html
/// 本组件只把它的"file:///…/WebUI/" 前缀换成 "http://localhost:端口/"，
/// 后面的相对路径原样保留。这样"哪个场景加载哪个页面"仍然只有一个出处（场景文件），
/// 不需要在这里再维护一张场景名→页面的表。
///
/// 引擎是**异步启动**的，它把 initialUrl 作为命令行参数传给 CEF 进程
/// （WebBrowserClient 里 argsBuilder.AppendArgument("initial-url", initialUrl)）。
/// 本组件在 AfterSceneLoad 就跑完了，早于引擎读参数，所以改 initialUrl 是有效的 ——
/// 页面**不会**先按 file:// 加载一次再跳转。
///
/// 万一没生效（引擎起得比预期快），Update 里有一条兜底：连上之后若一直没人来取起始页，
/// 就显式 LoadUrl 一次。所以这条路不会静默失败成空白页。
/// </summary>
public class WebUiServer : MonoBehaviour
{
    [Header("端口（被占用时会依次往后试）")]
    [SerializeField] private int preferredPort = 47821;
    [SerializeField] private int portAttempts = 8;

    [Header("要伺服的目录名")]
    [SerializeField] private string folderName = "WebUI";

    // 立绘资源在 Assets/Live2D/宅久运行文件/，不在 WebUI/ 里。
    // 挂一个额外根目录，好过把 20MB 模型复制进 WebUI —— 复制出来的那份一定会和
    // Unity 里的原版不同步（改了模型忘了重拷），而挂载永远读的是同一份。
    [Header("额外挂载：把工程里的 Live2D 模型目录挂到 /models/ 下")]
    [SerializeField] private string modelFolderPath = "Assets/Live2D/宅久运行文件";
    [SerializeField] private string modelMountPrefix = "models/";

    [Header("兜底：连上后多久没等到页面请求就显式跳转（秒）")]
    [SerializeField] private float navigateFallbackDelay = 2f;

    private HttpListener listener;
    private Thread worker;
    private volatile bool running;
    private string rootPath;
    private string modelRootPath;
    private int port;
    private string startPage;

    /// <summary>有没有人来取过 html。用来判断引擎是否已经按 initialUrl 正常载入了。</summary>
    private volatile int pageRequests;
    private volatile string lastRequestPath;

    private WebBrowserClient client;
    private float connectedAt = -1f;
    private bool navigatedByFallback;

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
            if (manager == null || manager.GetComponent<WebUiServer>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<WebUiServer>();
        }
    }

    private void Awake()
    {
        var manager = GetComponent<BaseUwbClientManager>();
        if (manager == null)
        {
            manager = GetComponentInParent<BaseUwbClientManager>();
        }

        if (manager == null)
        {
            Debug.LogError("[WebUiServer] 同一物体上找不到 UWB 组件，本机服务未启动。");
            return;
        }

        client = manager.browserClient;
        if (client == null)
        {
            Debug.LogError("[WebUiServer] manager.browserClient 为空，本机服务未启动。");
            return;
        }

        rootPath = ResolveRootPath();
        if (rootPath == null)
        {
            Debug.LogWarning(
                $"[WebUiServer] 找不到 “{folderName}” 目录，本机服务未启动，" +
                "页面将退回 file:// 载入（Live2D / 字体 / story.json 会因此拿不到）。");
            return;
        }

        startPage = ExtractPageName(client.initialUrl);
        if (string.IsNullOrEmpty(startPage))
        {
            startPage = "index.html";
        }

        modelRootPath = ResolveProjectPath(modelFolderPath);
        if (modelRootPath == null)
        {
            Debug.LogWarning($"[WebUiServer] 找不到模型目录 “{modelFolderPath}”，/models/ 将不可用（立绘会加载失败）。");
        }

        if (!StartListener())
        {
            Debug.LogWarning(
                $"[WebUiServer] {preferredPort}~{preferredPort + portAttempts - 1} 端口都起不来，" +
                "本机服务未启动，页面将退回 file:// 载入。");
            return;
        }

        // 换掉引擎的起始地址。放在这里（而不是等连上再 LoadUrl）是为了避免
        // "先按 file:// 加载一次、再跳 http" 造成的白屏闪烁和脚本跑两遍。
        client.initialUrl = BuildUrl(startPage);

        Debug.Log($"[WebUiServer] 已伺服 “{rootPath}” → {BuildUrl(string.Empty)}（起始页 {startPage}）");
    }

    // ---------------------------------------------------------------
    // 路径
    // ---------------------------------------------------------------

    /// <summary>
    /// 找 WebUI 目录。构建版从 StreamingAssets 读（要手工把那目录拷进去），
    /// 编辑器里直接从工程根读 —— 这样改 HTML 不用等 Unity 导入，刷新页面即可。
    /// </summary>
    private string ResolveRootPath()
    {
        var streaming = Path.Combine(Application.streamingAssetsPath, folderName);
        if (Directory.Exists(streaming))
        {
            return streaming;
        }

        // Application.dataPath 是 <工程根>/Assets
        var project = Path.GetFullPath(Path.Combine(Application.dataPath, "..", folderName));
        if (Directory.Exists(project))
        {
            return project;
        }

        return null;
    }

    /// <summary>把相对工程根的路径（形如 "Assets/…"）解成绝对路径，不存在返回 null。</summary>
    private static string ResolveProjectPath(string relativeToProject)
    {
        if (string.IsNullOrEmpty(relativeToProject))
        {
            return null;
        }

        var full = Path.GetFullPath(Path.Combine(Application.dataPath, "..", relativeToProject));
        return Directory.Exists(full) ? full : null;
    }

    /// <summary>
    /// 从 file:///D:/.../WebUI/menu/index.html 里取出 "menu/index.html"。
    /// 取不到就返回 null，调用方会退回 index.html。
    /// </summary>
    private string ExtractPageName(string url)
    {
        if (string.IsNullOrEmpty(url))
        {
            return null;
        }

        var marker = folderName + "/";
        var index = url.LastIndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            // 已经是个相对路径（没有目录前缀）就直接用
            return url.IndexOf("://", StringComparison.Ordinal) < 0 ? url : null;
        }

        var page = url.Substring(index + marker.Length);
        return page.Length > 0 ? page : null;
    }

    private string BuildUrl(string page)
    {
        return $"http://localhost:{port}/{page}";
    }

    // ---------------------------------------------------------------
    // 服务
    // ---------------------------------------------------------------

    private bool StartListener()
    {
        for (var i = 0; i < portAttempts; i++)
        {
            var candidate = preferredPort + i;
            var probe = new HttpListener();

            try
            {
                probe.Prefixes.Add($"http://localhost:{candidate}/");
                probe.Start();
            }
            catch (Exception)
            {
                // 端口被占用，或这个前缀没权限注册。换下一个，不要在这里报错刷屏 ——
                // 试满一轮还不行才由调用方给一条汇总警告。
                try
                {
                    probe.Close();
                }
                catch (Exception)
                {
                    // 清理失败无所谓，进程退出时会回收
                }

                continue;
            }

            listener = probe;
            port = candidate;
            break;
        }

        if (listener == null)
        {
            return false;
        }

        running = true;
        worker = new Thread(ServeLoop)
        {
            IsBackground = true,   // 后台线程：Unity 退出时不会把它卡住
            Name = "WebUiServer"
        };
        worker.Start();
        return true;
    }

    private void ServeLoop()
    {
        while (running)
        {
            HttpListenerContext context;

            try
            {
                context = listener.GetContext();
            }
            catch (Exception)
            {
                // Stop() 会让阻塞中的 GetContext 抛异常，这是正常的退出路径
                break;
            }

            try
            {
                Serve(context);
            }
            catch (Exception)
            {
                TryFail(context);
            }
        }
    }

    private void Serve(HttpListenerContext context)
    {
        var request = context.Request;
        var path = Uri.UnescapeDataString(request.Url.AbsolutePath);

        if (path == "/" || path.Length == 0)
        {
            path = "/" + startPage;
        }

        lastRequestPath = path;

        var relative = path.TrimStart('/');

        // 目录穿越防护。服务只监听 localhost，但仍不该允许读到挂载点之外的东西。
        if (relative.Contains(".."))
        {
            Respond(context, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("forbidden"));
            return;
        }

        // 选根目录：/models/… 走额外的模型挂载点，其余都走 WebUI。
        var mountRoot = rootPath;
        if (!string.IsNullOrEmpty(modelRootPath) &&
            relative.StartsWith(modelMountPrefix, StringComparison.OrdinalIgnoreCase))
        {
            mountRoot = modelRootPath;
            relative = relative.Substring(modelMountPrefix.Length);
        }

        var full = Path.GetFullPath(Path.Combine(mountRoot, relative.Replace('/', Path.DirectorySeparatorChar)));

        if (!full.StartsWith(mountRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            Respond(context, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not found: " + path));
            return;
        }

        var body = File.ReadAllBytes(full);
        Respond(context, 200, ContentTypeOf(full), body);

        if (relative.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            pageRequests++;
        }
    }

    private static void Respond(HttpListenerContext context, int status, string contentType, byte[] body)
    {
        var response = context.Response;
        response.StatusCode = status;
        response.ContentType = contentType;
        response.ContentLength64 = body.Length;

        // 不缓存。开发时在电脑上改完 HTML 直接按 ⟳ 就能看到，不用重启 Play。
        // 代价是每次刷新都重新读盘 —— 本地文件，可忽略。
        response.Headers["Cache-Control"] = "no-store";

        response.OutputStream.Write(body, 0, body.Length);
        response.Close();
    }

    private static void TryFail(HttpListenerContext context)
    {
        try
        {
            Respond(context, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("server error"));
        }
        catch (Exception)
        {
            try
            {
                context.Response.Abort();
            }
            catch (Exception)
            {
                // 已经断了，什么都不用做
            }
        }
    }

    /// <summary>
    /// 扩展名 → MIME。写全一点，缺一个就会让浏览器用错的解析方式
    /// （最典型的是 .js 用成 text/plain，ES module 会直接报错）。
    /// </summary>
    private static string ContentTypeOf(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js":
            case ".mjs": return "text/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".gif": return "image/gif";
            case ".svg": return "image/svg+xml";
            case ".ttf": return "font/ttf";
            case ".otf": return "font/otf";
            case ".woff": return "font/woff";
            case ".woff2": return "font/woff2";
            case ".wasm": return "application/wasm";
            case ".moc3": return "application/octet-stream";
            default: return "application/octet-stream";
        }
    }

    // ---------------------------------------------------------------
    // 兜底跳转 + 收尾
    // ---------------------------------------------------------------

    private void Update()
    {
        if (listener == null || client == null || navigatedByFallback)
        {
            return;
        }

        if (!client.IsConnected || !client.ReadySignalReceived)
        {
            connectedAt = -1f;
            return;
        }

        if (connectedAt < 0f)
        {
            connectedAt = Time.realtimeSinceStartup;
            return;
        }

        // 已经有人来取过 html 了，说明引擎确实按改过的 initialUrl 载入了，什么都不用做。
        if (pageRequests > 0)
        {
            return;
        }

        if (Time.realtimeSinceStartup - connectedAt < navigateFallbackDelay)
        {
            return;
        }

        navigatedByFallback = true;
        Debug.LogWarning(
            $"[WebUiServer] 引擎连上了但一直没来取页面（最后一次请求：{lastRequestPath ?? "无"}），" +
            $"显式跳转到 {BuildUrl(startPage)}。");
        client.LoadUrl(BuildUrl(startPage));
    }

    private void OnDestroy()
    {
        Shutdown();
    }

    private void OnApplicationQuit()
    {
        Shutdown();
    }

    private void Shutdown()
    {
        running = false;

        if (listener != null)
        {
            try
            {
                listener.Stop();
                listener.Close();
            }
            catch (Exception)
            {
                // 已经停了
            }

            listener = null;
        }

        // 不 Join：GetContext 阻塞时 Stop() 会让它抛异常退出，
        // 而这个线程是 IsBackground，留着也不会阻止进程结束。
        // 在这里 Join 反而有卡住编辑器退出域重载的风险。
        worker = null;
    }
}
