using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;
using VoltstroStudios.UnityWebBrowser.Core;
using VoltstroStudios.UnityWebBrowser.Input;
using VoltstroStudios.UnityWebBrowser.Shared;
using VoltstroStudios.UnityWebBrowser.Shared.Events;

/// <summary>
/// 接管 UWB 的鼠标输入。
///
/// 为什么需要它 —— UWB 2.2.8 自带的 RawImageUwbClientInputHandler 在 Unity 6 + 新版 Input System
/// 下有两个真实缺陷，实测确认：
///
///   1) 坐标来源不同源。
///      UWB 用旧版 UnityEngine.Input.mousePosition 取鼠标位置，而 EventSystem 的
///      InputSystemUIInputModule 用新版 Input System 做击中判定。两者报出来的坐标不一致，
///      于是"点在哪"和"算出来的浏览器坐标"对不上 —— 实测出现过 x=-1197 这种
///      新版系统根本不可能产生的负值，点击因此落在页面外。
///
///   2) OnPointerEnter 竞态。
///      OnPointerEnter 内部先检查 IsConnected，未连接就 return；而它只在指针"进入"时触发一次。
///      若鼠标一开始就停在页面上（引擎启动需要几秒），这一枪会打在引擎连上之前，
///      之后指针不再离开，OnPointerEnter 永远不会再触发 —— 而鼠标移动和键盘的协程
///      正是在里面启动的，于是移动与键盘整个会话全废。
///
/// 本组件的做法：
///   - 点击坐标直接取 PointerEventData.position（EventSystem 已用它做过击中判定，天然同源）
///   - 移动与键盘不再依赖 OnPointerEnter，而是每帧自己轮询 Mouse.current / Keyboard.current
///   - 全程只走新版 Input System，不碰旧版 Input
///   - 通过把 UWB 的 disableMouseInputs 设为 true 来关掉它自己的鼠标处理，避免重复发送
///
/// 不需要手动挂载：下面的 AutoInstall 会在进入 Play 时自己找到场景里的 UWB 组件并挂上去。
/// 确认方案可行后，把本文件连同 UwbTest 场景一起删掉即可。
/// </summary>
public class WebInputFix : MonoBehaviour, IPointerDownHandler, IPointerUpHandler
{
    private WebBrowserClient client;
    private RectTransform rectTransform;
    private RawImage rawImage;
    private Canvas canvas;

    private Vector2 lastSentMove = new Vector2(float.NaN, float.NaN);

    // 键盘：完全自己映射，不依赖 UWB 的输入处理器。
    // 复用列表避免每帧产生垃圾。
    private readonly List<WindowsKey> keysDown = new List<WindowsKey>();
    private readonly List<WindowsKey> keysUp = new List<WindowsKey>();
    private string textBuffer = string.Empty;

    // ---------------------------------------------------------------
    // 自动挂载：进入 Play 后找到 UWB 组件，把本组件加到同一个 GameObject 上
    // ---------------------------------------------------------------

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoInstall()
    {
        // 显式限定 UnityEngine.Object：本文件暂时没 using System，但将来一旦加上，
        // 直接写 Object 就会变成 CS0104 歧义。
        var managers = UnityEngine.Object.FindObjectsByType<BaseUwbClientManager>(
            FindObjectsInactive.Include, FindObjectsSortMode.None);

        for (var i = 0; i < managers.Length; i++)
        {
            var manager = managers[i];
            if (manager == null)
            {
                continue;
            }

            if (manager.GetComponent<WebInputFix>() != null)
            {
                continue;
            }

            manager.gameObject.AddComponent<WebInputFix>();
            Debug.Log($"[WebInputFix] 已接管 UWB 的鼠标输入（挂到 “{manager.gameObject.name}” 上）。");
        }
    }

    private void Awake()
    {
        var manager = GetComponent<BaseUwbClientManager>();
        if (manager == null)
        {
            manager = GetComponentInParent<BaseUwbClientManager>();
        }

        if (manager != null)
        {
            client = manager.browserClient;

            // 关掉 UWB 自己的鼠标与键盘处理，避免重复发送：
            // 它的鼠标坐标来源与 EventSystem 不同源（会点错位置），
            // 它的键盘卡在一个由 OnPointerEnter 启动、但存在竞态的协程里。两者都由本组件接管。
            var uwbInput = manager as RawImageUwbClientInputHandler;
            if (uwbInput != null)
            {
                uwbInput.disableMouseInputs = true;
                uwbInput.disableKeyboardInputs = true;
            }
        }

        // 文字输入（IME/可打印字符）。按键本身走 Keyboard.current，这里只补字符流。
        var keyboard = Keyboard.current;
        if (keyboard != null)
        {
            keyboard.onTextInput += OnTextInput;
            textBuffer = string.Empty;
        }

        rectTransform = transform as RectTransform;
        rawImage = GetComponent<RawImage>();
        canvas = GetComponentInParent<Canvas>();
    }

    // ---------------------------------------------------------------
    // 点击：坐标来自 EventSystem 已经验证过的 position
    // ---------------------------------------------------------------

    public void OnPointerDown(PointerEventData eventData)
    {
        SendClick(eventData, MouseEventType.Down);
    }

    public void OnPointerUp(PointerEventData eventData)
    {
        SendClick(eventData, MouseEventType.Up);
    }

    private void SendClick(PointerEventData eventData, MouseEventType eventType)
    {
        if (!CanSend())
        {
            return;
        }

        MouseClickType clickType;
        switch (eventData.button)
        {
            case PointerEventData.InputButton.Left:
                clickType = MouseClickType.Left;
                break;
            case PointerEventData.InputButton.Right:
                clickType = MouseClickType.Right;
                break;
            case PointerEventData.InputButton.Middle:
                clickType = MouseClickType.Middle;
                break;
            default:
                return;
        }

        if (!TryGetBrowserPoint(eventData.position, out var point))
        {
            return;
        }

        var clickCount = eventData.clickCount > 0 ? eventData.clickCount : 1;
        client.SendMouseClick(point, clickCount, clickType, eventType);
    }

    // ---------------------------------------------------------------
    // 移动 + 键盘：自己每帧轮询，不依赖 OnPointerEnter
    // ---------------------------------------------------------------

    private void Update()
    {
        if (!CanSend())
        {
            return;
        }

        PollKeyboard();
        PollMouse();
    }

    /// <summary>
    /// 键盘：直接从新版 Input System 读按键，再用 UWB 公开的映射表换成 WindowsKey。
    ///
    /// 为什么不用 UWB 的 WebBrowserInputHandler：
    ///   它的键盘轮询在那个由 OnPointerEnter 启动的协程里，而那个入口有竞态
    ///   （鼠标一开始就停在页面上时永不触发）；而 Old Input Handler 又依赖旧版
    ///   UnityEngine.Input，本工程里旧版输入不可靠（鼠标坐标那个 x=-1197 就是它给的）。
    ///   所以干脆自己做映射，唯一复用的是它公开的 UnityKeyToWindowKey 扩展方法。
    /// </summary>
    private void PollKeyboard()
    {
        var keyboard = Keyboard.current;
        if (keyboard == null)
        {
            return;
        }

        keysDown.Clear();
        keysUp.Clear();

        var allKeys = keyboard.allKeys;
        for (var i = 0; i < allKeys.Count; i++)
        {
            var key = allKeys[i];
            if (key == null)
            {
                continue;
            }

            try
            {
                if (key.wasPressedThisFrame)
                {
                    keysDown.Add(key.keyCode.UnityKeyToWindowKey());
                }

                if (key.wasReleasedThisFrame)
                {
                    keysUp.Add(key.keyCode.UnityKeyToWindowKey());
                }
            }
            catch (ArgumentOutOfRangeException)
            {
                // 少数按键在 WindowsKey 里没有对应项，忽略即可（UWB 官方处理器也是这么处理的）
            }
        }

        var buffer = textBuffer;
        textBuffer = string.Empty;

        if (keysDown.Count == 0 && keysUp.Count == 0 && buffer.Length == 0)
        {
            return;
        }

        client.SendKeyboardControls(keysDown.ToArray(), keysUp.ToArray(), buffer.ToCharArray());
    }

    private void OnTextInput(char character)
    {
        textBuffer += character;
    }

    private void PollMouse()
    {
        var mouse = Mouse.current;
        if (mouse == null)
        {
            return;
        }

        var screenPoint = mouse.position.ReadValue();

        // 指针离开页面就不再发移动（也就等于 UWB 的 OnPointerExit）
        if (!IsOverThisRect(screenPoint))
        {
            if (!probeLoggedOutside)
            {
                probeLoggedOutside = true;
                Debug.LogWarning(
                    $"[WebInputFix] 探针：指针 {screenPoint} 判定为**不在**网页矩形内 → 停止转发移动。\n" +
                    $"网页矩形 rect={rectTransform.rect}，屏幕 {Screen.width}x{Screen.height}。" +
                    "这个矩形应当铺满屏幕。若明显偏小或偏移，说明有别的东西改了它的 RectTransform。" +
                    "（注：改这个矩形**不会**影响输入，这一点曾经误判过；" +
                    "真正会让点击失效的是网页里铺满视口的覆盖层没设 pointer-events: none。）");
            }

            lastSentMove = new Vector2(float.NaN, float.NaN);
            return;
        }

        if (!TryGetBrowserPoint(screenPoint, out var point))
        {
            if (!probeLoggedConvertFail)
            {
                probeLoggedConvertFail = true;
                Debug.LogWarning($"[WebInputFix] 探针：指针 {screenPoint} 在矩形内，但屏幕→网页坐标换算失败。");
            }

            return;
        }

        // 位置没变就不重复发包
        if (!float.IsNaN(lastSentMove.x) && lastSentMove == point)
        {
            return;
        }

        if (!probeLoggedMove)
        {
            probeLoggedMove = true;
            Debug.Log($"[WebInputFix] 探针：首次转发鼠标移动 屏幕{screenPoint} → 网页{point}（rect={rectTransform.rect}）");
        }

        lastSentMove = point;
        client.SendMouseMove(point);
    }

    // 排查探针：各只打一次，查到原因后可以删掉
    private bool probeLoggedOutside;
    private bool probeLoggedConvertFail;
    private bool probeLoggedMove;

    private void OnDestroy()
    {
        var keyboard = Keyboard.current;
        if (keyboard != null)
        {
            keyboard.onTextInput -= OnTextInput;
        }
    }

    // ---------------------------------------------------------------
    // 工具
    // ---------------------------------------------------------------

    private bool CanSend()
    {
        return client != null && client.IsConnected && client.ReadySignalReceived;
    }

    /// <summary>指针是否落在本 RectTransform 上。</summary>
    private bool IsOverThisRect(Vector2 screenPoint)
    {
        if (rectTransform == null)
        {
            return false;
        }

        return RectTransformUtility.RectangleContainsScreenPoint(rectTransform, screenPoint, GetUiCamera());
    }

    /// <summary>
    /// 屏幕坐标（左下原点）→ 浏览器像素坐标（左上原点）。
    /// 注意：screenPoint 由 EventSystem / 新版 Input System 提供，与击中判定同源，这是本组件能修好坐标问题的根本原因。
    /// </summary>
    private bool TryGetBrowserPoint(Vector2 screenPoint, out Vector2 browserPoint)
    {
        browserPoint = Vector2.zero;

        if (rectTransform == null)
        {
            return false;
        }

        if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(
                rectTransform, screenPoint, GetUiCamera(), out var local))
        {
            return false;
        }

        var rect = rectTransform.rect;
        if (rect.width <= 0f || rect.height <= 0f)
        {
            return false;
        }

        var u = (local.x - rect.x) / rect.width;    // 0..1 左到右
        var v = (local.y - rect.y) / rect.height;   // 0..1 下到上

        // 用浏览器纹理的真实尺寸；拿不到就退回 UWB 的默认分辨率
        var width = 1920f;
        var height = 1080f;

        if (rawImage != null && rawImage.texture != null)
        {
            width = rawImage.texture.width;
            height = rawImage.texture.height;
        }

        browserPoint = new Vector2(u * width, (1f - v) * height);
        return true;
    }

    /// <summary>Overlay Canvas 必须传 null 相机，其余模式传 worldCamera。</summary>
    private Camera GetUiCamera()
    {
        if (canvas == null)
        {
            return null;
        }

        return canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
    }
}
