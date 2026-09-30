# WebUI · VN 前端原型

用 HTML/CSS 做的界面。放在 `Assets` 之外，Unity 不会导入它。

## 目录结构：两个界面，各自独立

**主菜单和游戏界面是两个场景，因此也是两套互不加载的页面。**

```
WebUI/
├── bridge.js        共用：与 C# 的协议层（信封 / 版本号 / 四种发送方式 / __vnReceive 分发）
├── stage.js         共用：1920x1080 画布等比缩放
├── theme.css        共用：三套主题变量 + 页面基础 + #stage
│
├── index.html       ← 游戏界面（MainRoom 场景加载这个）
├── style.css            只含游戏规则
├── app.js               只含游戏逻辑
├── story.js             剧本数据（Unity 菜单导出，见下）
├── story.sample.js      内置样本
├── uwbtest.html         诊断页（不是游戏的一部分）
│
└── menu/
    ├── index.html   ← 主菜单界面（MainMenu 场景加载这个）
    ├── menu.css         只含主菜单规则
    ├── menu-view.js     只含主菜单逻辑
    ├── settings.css     只含设置规则
    ├── settings-view.js 只含设置逻辑
    └── boot.js          唯一同时认识"菜单"和"设置"、也唯一认识 C# 的地方
```

**共用的只有三样：协议层、画布缩放、主题变量。** 它们不是"界面代码"，重复实现会立刻漂移
（协议版本号分成两份 → "设置页能存、游戏页读不到"这种极难查的 bug）。

界面代码一律不共用：主菜单和游戏永远不同屏（是两个场景），混在一起只会让"改 A 弄坏 B"变容易。

> 游戏页在根目录而主菜单在 `menu/` 下，看着不对称 —— 这是刻意的。`MainRoom.unity` 里的
> WebView 地址指向 `WebUI/index.html`，保持它不动就少动一次场景文件（手写场景 YAML 是
> 这个项目里风险最高的操作）。文件名里的 `index` = 游戏，`menu/` = 主菜单。

## 立刻看效果

两个界面都可以**直接用浏览器打开**，不需要 Unity、不需要起服务器：

- **游戏界面**：双击 `index.html`。默认加载内置样本（真实剧本第一幕的摘录 + 真实选项与两个结局）。
- **主菜单界面**：双击 `menu/index.html`。滑杆能拖，但"开始游戏/退出"需要 Unity 才能生效。

想看**完整 1397 步**：先执行 Unity 菜单 `WanXuan > Import Long Story`，再执行 `WanXuan > 导出 Web 剧本（story.js）`，它会生成 `WebUI/story.js`。

加载优先级（`app.js` 里 `loadStory()`）：

1. **`story.js`** —— `<script>` 加载**不受 `file://` 的 CORS 限制**，所以嵌进 CEF / WebView 时只有这一条能成。这是主格式。
2. `story.json` —— 旧的 JSON 格式，用本地 http 服务打开时可用（`python -m http.server 8000` 之类）。
3. 内置样本 —— 保证任何情况下打开都有东西可看。

> 为什么主格式从 `story.json` 改成 `story.js`：CEF 里 `fetch('story.json')` 会被 CORS 拒绝，导致 WebView 里永远只能跑样本。而 `<script src="story.js">` 没这个限制，代价只是文件头多一行 `window.VN_STORY = `。

## 操作

| 操作 | 键 / 按钮 | 在哪一页 |
|---|---|---|
| 推进对话 | 点击、`空格`、`回车` | 游戏 |
| 打字中点击 | 立刻显示完整文字（VN 惯例） | 游戏 |
| 选择选项 | 点击，或按 `1`–`9` | 游戏 |
| 自动播放 | `A` | 游戏 |
| 快进（文字瞬间显示） | `F` | 游戏 |
| 隐藏 UI | `H`（隐藏后点任意处恢复） | 游戏 |
| 切换主题 | `T`（木牌 / 暖棕 / 奶油） | 游戏 |
| 背景预览开关 | `B` | 游戏 |
| **参考层**开关（角色站位框 + 面部安全线） | `G` | 游戏 |
| 开发 HUD | `D` | 游戏 |
| **回主菜单** | `M` 或控制条上的「主菜单」 | 游戏 |
| 开始游戏 / 设置 / 退出 | 三个按钮（左列竖排） | 主菜单 |
| 上下选择 | `↑` `↓`，`回车` 确认 | 主菜单 |
| 关掉设置页 | `Esc` 或「返回」 | 主菜单 |

控制条（游戏页左下）有同样的按钮。

> 游戏页的 `M` 和「主菜单」按钮**不是"切出菜单界面"** —— 本页根本没有菜单界面。
> 它只是请求 C# 换到 MainMenu 场景。浏览器里预览时没人接这条消息，想看菜单请直接开 `menu/index.html`。

`B` 和 `G` 是**两个独立开关**：`B` 控制 CSS 假房间，`G` 控制那两条参考标线。想拍干净的设计稿就按 `G` 关掉参考层，不必连背景一起关。

**拍截图时请先按 `D` 把 HUD 打开**——HUD 里会显示当前主题名和字体加载状态，这样一张图就能说清是哪个主题，不用猜。

## 三个值得先看的点

1. **按 `B` 关掉背景预览**：整页会变透明。这就是接进 Unity 后的真实状态——Live2D 角色和房间从 HTML 底下透上来。**这一步能验证对话框的对比度在真实条件下是否够用。**
2. **按 `T` 切主题**（三套，可来回对比）：
   - **`room`（默认，木牌 / 贴纸）** —— 从 `MainRoom` 实拍取色衍生。不透明奶油纸面 + 暖褐木色边框 + 下缘加厚做出"木牌厚度" + 硬阴影，青绿作强调色。**不用毛玻璃。**
   - `cocoa` 暖棕深色 —— 通用安全牌，磨砂玻璃语汇。
   - `cream` 奶油浅色 —— 磨砂玻璃语汇。注意它的面板色接近你的墙面，分离度不足，留作反面对比。
3. **按 `D` 开 HUD**：能看到当前 `stepId`、进度、`background`、表情标注，以及 `【场景】/【BGM】/【立绘】` 这些**演出提示**。这些数据在 Unity 的 `StoryStep.StageNote` / `MarkerTitle` 里已经存在但从来没被用过，这里先把它显示出来。

## room 主题的取色依据

不是凭感觉配的，全部来自 `MainRoom` 实拍：

| 场景元素 | 色值 | 用在哪里 |
|---|---|---|
| 墙面奶油 | `#EFE6D6` | 面板底色基调（面板取略亮略净的 `#FDF8EF`） |
| 墙裙 / 家具木色 | `#8A6247` `#6E4C36` | 面板与选项边框、名牌、木牌下缘 |
| 地毯 / 窗框 / 坐垫青绿 | `#3E8C84` | 强调色：角标、继续指示器、选项悬停条、幕标题分隔线 |
| 角色光环金 | `#E8C56A` | 只在结局卡的装饰符上出现一次 |
| 草莓粉 | `#C9606F` | **只留给结局卡的分隔线** |

两条刻意的取舍：

1. **不用毛玻璃。** 你的低多边形场景里没有任何半透明模糊材质，全是平涂 + 清晰描边 + 硬阴影。磨砂面板压上去会立刻显得"这是另一个软件的画面"。
2. **面板做成不透明。** 对话框落在芥黄地板 + 青绿地毯描边上，底部区域很花；不透明才能保证文字对比度是**确定的**，而不是碰运气。想让它透一点，把 `--panel-bg` 的色值改成 `rgba(...,0.94)` 即可 —— 边框和阴影仍然负责把面板和墙分开。

变量在 `style.css` 顶部拆成了**配色组**和**结构组**。改色只动配色组（`--panel-bg` / `--text-main` / `--accent`…），不要动结构组（`--panel-backdrop` / `--panel-radius` / `--panel-border-bottom-w`…）。

## 构图：角色是居中偏右的

按实拍确定，不是想当然：

- 角色占据画面中间约 38% 宽，**泡泡袖张开后视觉宽度接近 980px**；
- 头顶光环约在画面 **29%** 高度，眼睛约在 **49%** 高度，身体一直到画面下沿被裁掉。

所以 `#character-slot` 已改成**居中**（之前错放在左侧），并加了一条红色的**面部安全区标线**（距下沿 546px）：对话框上沿不应越过它。

对话框当前是 `bottom: 62px` + `min-height: 250px`，上沿在 312px，离安全线还有余量。但**中文长句到 6 行左右时上沿会到约 558px，就会切到她的脸** —— 这条线就是给你盯这个用的。

另一个已知冲突：**选项按钮（880px 居中）弹出时会几乎完全盖住她**，而选项恰恰是情绪最高点。两个改法，等你定：

- 选项改成左对齐竖列，把她留在右侧可见区；
- 或者利用你有 3D 相机这一点，选项时把镜头平移，让她挪到右侧三分之一。

## 中文字体：你看到的很可能不是游戏字体

`style.css` 里 `@font-face` 指向 `../Assets/.../ChillRoundF.ttf`。但 **`file://` 下浏览器通常以 CORS 拒绝加载跨目录的字体文件**，于是静默退回系统字体（微软雅黑之类）。字体文件本身不报错、画面也正常，所以极容易在"以为在看游戏字体"的情况下评排版。

所以 `app.js` 会主动检测并把它显示在 HUD 上：

```
字体    : ChillRoundF 已加载
字体    : 未加载 → 正在用系统字体（评排版时务必注意）
```

如果显示未加载，两种解法：

1. 在 `WebUI` 目录起静态服务后访问 `http://localhost:8000` —— 相对路径即可生效；
2. 把 `ChillRoundF.ttf` 复制到 `WebUI/fonts/`，并把 `@font-face` 的 `src` 改成 `url("fonts/ChillRoundF.ttf")`。

> 顺带一提：这个字体是**寒蝉系圆体**，授权条款和文泉驿不同，商用前请确认。

## 两个还没定的技术前提（会影响最终配色）

**1. UI 走不走后处理？** URP 里这决定了颜色会不会被改：

| UI 挂载方式 | 是否被后处理影响 |
|---|---|
| **Screen Space - Overlay** Canvas | **不受影响**（后处理之后才画到 backbuffer） |
| Screen Space - Camera / World Space Canvas | **受影响**（Bloom / Tonemapping / Color Grading / Vignette 全作用） |
| 原生 WebView 窗口叠加 | 完全在 Unity 之外，不受影响 |

三个后果：

- 如果打算"统一后处理"，**不要照当前未调色的截图去定 UI 颜色** —— 整幅画面会一起漂移，调好的值全部作废。
- **Bloom 对亮面板是灾难**：面板接近纯白会发光、文字边缘发糊。你的场景是高明度低对比的，这个风险是实打实的。
- **Vignette 会先压暗 UI 四角**，角标和按钮会变脏。

建议：**UI 走 Screen Space - Overlay（不进后处理），"统一"只作用于 3D 场景**，让文字可读性可控。若最终一定要 UI 也被调色，请按调色**之后**的目标反推颜色。

**2. 目标宽高比。** 参考截图是 999×810（约 1.23:1），不是 16:9。当前舞台按 1920×1080 写死：如果是截图裁切则无需改动；如果 Game 视图就是这个比例，所有布局参数都要按新比例重算 —— 告诉我一声即可。

## 两个场景与流转

| 场景 | 加载的页面 | 里面有什么 |
|---|---|---|
| **`Assets/Scenes/MainMenu.unity`** | `WebUI/menu/index.html` | 只放一个 UWB 预制体 + EventSystem + 相机。没有 GameManager、没有 StoryManager、没有 Live2D —— 主菜单不需要剧情引擎 |
| **`Assets/Scenes/MainRoom.unity`** | `WebUI/index.html` | 完整的游戏场景（房间 / Live2D / 剧情引擎 / 游戏 UI） |

两个场景都必须出现在 **File > Build Profiles（或 Build Settings）** 里，否则换场景会失败。
`WebSceneFlow` 会先检查再载入，载入不了会打一条能直接照做的报错，而不是抛异常。

```
MainMenu ──menu.start──► MainRoom
MainRoom ──ui.menu─────► MainMenu
```

流转由一个自动挂载的组件负责（`Assets/Scripts/UI/WebSceneFlow.cs`）。**它在哪个场景都一样工作**，
所以两个场景都不需要手写脚本 GUID 引用 —— 这一点很重要，见下面"为什么不用场景配置"。

### 主菜单的立绘：在网页里，不在 Unity 场景里

主菜单的版式是**左边选项、右边立绘**。立绘由 **`oh-my-live2d`** 在**网页里**渲染
（`menu/live2d.js`），Unity 场景完全不参与。

**所以 `MainMenu.unity` 不需要任何立绘** —— 它是"相机给一层背景色 + 一个 WebView"，
就这些。

> **为什么走网页而不是把立绘搬进场景**：立绘预制体 `Assets/Prefabs/Characters/2-3.prefab`
> 里**所有物体都在 layer 0**，而 MainRoom 的 `Live2D Camera` 只渲染 **layer 6**。
> 所以 MainRoom 的场景文件里有**约 670 条 `m_Layer: 6` 覆盖**——它们是必需的，不是美术微调。
> 加上 `WanXuanLive2DController` / `GazeFollowController` 是加在预制体子物体上的，
> 还有一批指向预制体内部组件的 stripped 引用。手写 670 条 layer 覆盖 + 交叉 fileID 引用，
> 正是本项目上次"整个界面点不动"那类事故的成因。
>
> 换成网页渲染之后这些全都不存在，而且悬停菜单项 → 她换表情是同页面直接调，没有桥接延迟。

配置基线来自 `D:\NekoClaw\PersonalPage\index.html` 里一份**跑通过的**同模型配置
（那边模型在 `l2ds/宅久/`，这边由 `WebUiServer` 挂在 `/models/` 下）：

```js
OML2D.loadOml2d({
    initialStatus: 'sleep',
    dockedPosition: 'right',
    models: [{
        path: '/models/2-3.model3.json',
        position: [-40, 60],      // ← 位置
        scale: 0.08,              // ← 大小
        stageStyle: { height: … } // ← 舞台高度（最主要的"她多大"旋钮）
    }]
});
```

调参只改 `WebUI/menu/live2d.js` 顶部的 `TUNING`，然后在控制台 `VN.character.reload()`。

**前提：必须通过 Unity 的 `WebUiServer` 打开本页。** `oh-my-live2d` 要用 `fetch`
读 `.moc3`，`file://` 下一律被拒。直接双击 `menu/index.html` 时菜单能显示、
立绘不会出来，右下角会有一条说明（`live2d.js` 检测到 `file:` 协议就显示它）。

> 顺带：`MainMenu` 的主相机 culling mask 我之前改成了 `m_Bits: 4294967231`
> （"全部除了 Live2D"）。立绘不进场景之后这是**空操作**，留着无害；
> 想让场景彻底回到原样，改回 `4294967295` 即可。

### 为什么用 AutoInstall 而不是在场景里挂组件

因为**手写 Unity 场景 YAML 时，引用一个"还没被 Unity 导入过"的脚本 GUID 是做不到的** ——
GUID 要等 Unity 导入 `.cs` 文件才会生成。而 `[RuntimeInitializeOnLoadMethod]` 让组件自己找上门，
正好绕开这个限制。

代价：这些组件的 `[SerializeField]` 字段**改不了 Inspector**（运行时创建的对象没有 Inspector）。
要改就在代码里的字段初值改。想让策划能改，可以手动把组件加到场景里的 UWB 物体上 ——
AutoInstall 发现有现成的就不会再建一个。

涉及四个自动挂载组件（都在 `Assets/Scripts/UI/`）：

| 组件 | 干什么 |
|---|---|
| `WebUiBridge.cs` | 建立与页面的双向通道（消息队列、主线程派发、握手） |
| `WebInputFix.cs` | 接管鼠标 / 键盘转发（UWB 自带的输入层有缺陷，见下文） |
| `WebSettingsChannel.cs` | 设置的读写通道（`settings.request` / `settings.changed`） |
| `WebSceneFlow.cs` | 场景流转（`menu.start` / `ui.menu` / `menu.quit`）+ 下发主菜单标题 |

## 主菜单与设置：界面的归属

界面上有主菜单（标题 / 开始游戏 / 设置 / 退出）和设置页（文字速度、自动播放间隔、音量、全屏）。

**三套 UI 的归属是明确的，谁也不加载谁：**

| UI | 在哪 | 谁加载 |
|---|---|---|
| 主菜单 | `menu/index.html` + `menu.css` + `menu-view.js` | MainMenu 场景 |
| 设置 | `menu/index.html` 里的 `#settings-layer` + `settings.css` + `settings-view.js` | 同上（它不参与游戏界面） |
| 游戏 | `index.html` + `style.css` + `app.js` | MainRoom 场景 |

`menu-view.js` 不认识设置，`settings-view.js` 也不认识主菜单。两者唯一的交集是
"设置盖在主菜单上面"，而那条关系只写在 `menu/boot.js` 里（唯一同时认识两者的文件）。

### 设置的数据在 C#，不在网页

数据流是一个环：

```
C# settings.apply  ──►  设置页写进自己那份 current 并刷新滑杆
滑杆被拖动          ──►  本地立刻生效（手感要马上有反馈）
                       └─► send('settings.changed')  ──►  C# 钳制 → 落盘 → 回执 settings.apply
```

为什么权威在 C#：

1. **网页是 `file://` 加载的**。各浏览器对 `file://` 的 `localStorage` 处理不一致（有的按目录隔离、有的直接禁用），存档不能赌这个。**`PlayerPrefs` 是唯一可靠的位置。**
2. **有些设置网页根本做不到**：`Screen.fullScreen`、`AudioListener.volume`、`Application.Quit()` 只有 Unity 能做。
3. **设置要跨场景**。玩家在主菜单里改了速度，进游戏后必须仍然生效 —— 而两个场景里的 MonoBehaviour 互不相识。所以持久化放在**静态类** `UiSettingsStore` 里（寿命正好和这一局游戏一致，不需要 `DontDestroyOnLoad` 搬运）。
4. **换后端时存档必须还在**。以后换成原生 Unity UI 菜单，设置不能跟着丢掉。

几个刻意的决定：

- **事件叫 `settings.changed` 而不是 `settings.set`** ——它是"通知 C# 我改了"，不是"命令 C# 去改"。
- **C# 收到后回一条 `settings.apply` 做确认**，不是多余。界面上显示的是"44%"这种二次加工过的值，让 C# 把钳制后的真值发回去，界面才不会算出一套和存档不一致的数。（网页收到 `settings.apply` 只刷新显示、不再回发，所以这个环不会自激。）
- **存的是物理量（毫秒、0..1），不是滑杆刻度（0..100）。** 滑杆只是给人"慢/快"的直觉，`每字 34 毫秒`才是 C# 和 JS 都能直接用的量。
- **网页主动问（`settings.request`），而不是 C# 主动推。** 主动推必须踩准"网页还没加载完 / 桥接还没连上"的时机，而且这时机在两个场景里还不一样；网页自己知道自己什么时候准备好了。

游戏页**没有设置界面**，它只是消费者：开机发一条 `settings.request`，拿到的 `textSpeed` 影响打字机出字节奏，`autoDelay` 影响自动播放间隔。

主菜单标题也由 C# 下发（`WebSceneFlow` 的 `storyTitle` / `storySubtitle` 字段），HTML 里写的是**兜底文案** —— 万一 C# 还没连上，菜单也不该是空白的。

## 两种运行模式（关键设计）

代码里 `state.mode` 有两个值，视图代码完全相同：

- **`standalone`** —— 浏览器里 JS 自己遍历剧本。用于视觉和节奏评审，不需要 Unity。
- **`bridge`** —— 接进 Unity 后，剧本遍历**完全由 C# 的 `StoryManager` 负责**，JS 退化成哑视图：只渲染，只回报玩家事件。

页面上检测到 `window.uwb` / `window.vuplex` / `window.chrome.webview` / `window.unityInstance` 任一存在时，先切到 `bridge` 并等 C# 开口；**但真正的判据是"C# 是否发来过消息"**（`VNBridge.hostSpoken`）。若 3 秒内一条都没有，说明这次并不是由 C# 驱动，就退回 `standalone` 自己播样本，免得画面一片空白看着像坏了。

> 主菜单页不需要这套模式判断 —— 它没有剧情可遍历，永远只等 C# 的 `menu.show` / `settings.apply`。

这样设计的目的：以后无论换成 Vuplex、UnityWebBrowser，还是决定回退到原生 Unity UI，**需要改的只有"谁遍历剧本"这一件事**，表现层不动。

### 桥接协议

实现在共用的 **`bridge.js`**（版本号 `VNBridge.version = 1`，必须与 C# 的
`WebUiBridge.BridgeVersion` 相同）。两个界面都用它，所以协议只有一份。

**C# → JS**（用 `browserClient.ExecuteJs("window.__vnReceive('...')")` 调用）

```
{ v:1, type:'hello' }                     ← 传输层握手，bridge.js 自己消化，不下发给界面
{ v:1, type:'story.load',    payload:{ story:{...} } }        ┐
{ v:1, type:'marker.show',   payload:{ title } }              │
{ v:1, type:'dialogue.show', payload:{ speaker, content, … } }│ 只发往游戏页
{ v:1, type:'choice.show',   payload:{ stepId, choices:[…] } }│
{ v:1, type:'ending.show',   payload:{ title, message } }     │
{ v:1, type:'ui.hide' } / { v:1, type:'ui.show' }             ┘
{ v:1, type:'menu.show',     payload:{ title, subtitle } }    ┐ 只发往主菜单页
{ v:1, type:'settings.apply', payload:{ textSpeed, autoDelay, volume, fullscreen } }  ← 两页都收
```

**JS → C#**（依次尝试 `uwb.ExecuteJsMethod` → `vuplex.postMessage` → `chrome.webview.postMessage` → `unityInstance.SendMessage('WebUiBridge','OnWebMessage',…)`）

```
{ v:1, type:'ready' }                                          ← 游戏页
{ v:1, type:'dialogue.advance',        payload:{ stepId } }    ┐
{ v:1, type:'dialogue.typingComplete', payload:{ stepId } }    │ 游戏页
{ v:1, type:'choice.selected',         payload:{ index, next } }│
{ v:1, type:'ending.restart' }                                 │
{ v:1, type:'ui.menu' }                ← 游戏页请求回主菜单     ┘
{ v:1, type:'menu.start' }                                     ┐
{ v:1, type:'menu.quit' }                                      │ 主菜单页
{ v:1, type:'settings.changed',        payload:{ textSpeed, autoDelay, volume, fullscreen } } ┘
{ v:1, type:'settings.request' }       ← 两页都发（开机问一次当前设置）
```

> `settings.apply` 的 payload **必须四项齐全**。JsonUtility 对缺失的 `float` 字段给的是 0，
> 靠 0 判断"没发"会把文字速度悄悄改成 0 毫秒（瞬间出字）。代价太大，所以约定必须齐全。

**`dialogue.typingComplete` 是必须处理的回执。** 打字机效果由前端驱动，C# 必须知道文字何时显示完，否则玩家在打字途中点击会丢事件，自动播放的节奏也会踩空。

**`dialogue.typingComplete` 是必须处理的回执。** 打字机效果由前端驱动，C# 必须知道文字何时显示完，否则玩家在打字途中点击会丢事件，自动播放的节奏也会踩空。

## 接进 Unity（Windows PC 已确认可行）

两条路，建议**先走 A**：

**A. 先把 HTML 当设计稿，烘焙成 Sprite，运行时仍是原生 Unity UI**

零体积、零平台限制、无输入转发问题。适合面板/名牌/按钮这类静态件：

```
chrome --headless --screenshot=panel.png --window-size=1640,250 --default-background-color=00000000 panel.html
```

（Playwright 等价写法：`page.screenshot({ omitBackground: true })`）

导入 Unity 后 Sprite Editor 切九宫格，`Image` 用 Sliced。**建议分工：HTML/CSS 负责"画框"，Unity TMP 负责"写字"。**

**B. 运行时真的嵌 WebView**

| 方案 | 成本 | 备注 |
|---|---|---|
| [UnityWebBrowser](https://projects.voltstro.dev/UnityWebBrowser/latest/) | 免费（MIT） | Win/Linux/macOS，可渲染到 Texture2D，双向 JS interop，**透明背景需自己实测** |
| [Vuplex 3D WebView](https://store.vuplex.com/webview/windows-mac) | $159.99 | 明确支持 [transparent pages](https://support.vuplex.com/articles/how-to-make-a-webview-transparent)、自动转发点击/滚动、CJK 输入法；**有免费试用**，建议先用试用验证透明叠加再决定付款 |

### UWB 实测记录（**已跑通，结论在最下面**）

查过官方文档后，有四条必须先知道的事实：

| 事实 | 影响 |
|---|---|
| **不支持 IL2CPP**（要起独立进程，`System.Diagnostics.Process` 在 IL2CPP 下不可用） | 本工程 `scriptingBackend` 只有 `Android: 1`，Standalone 默认 Mono ✅ 不阻塞。但 Windows 版以后想开 IL2CPP 就没这条路了 |
| **只测过 Unity 2021.3.x**，原文 *"Newer Unity versions should work, but are untested"* | 本工程是 **Unity 6000.1.17f1**，新 5 个大版本 —— **最大未知，只能实测** |
| **改窗口尺寸可能崩 Unity**：*"There is a chance that resizing the screen causes UWB to crash Unity, use carefully!"* | 对要发布的 PC 游戏是产品级风险 |
| **唯一的输入处理器叫 `WebBrowserOldInputHandler`**（旧版 Input Manager） | 本工程原本 `activeInputHandler: 1` = 仅新版 Input System，`UnityEngine.Input.*` 会抛异常。**已改成 `2`（Both）** |

另外：`WebBrowserClient.backgroundColor` 的类型是 **`Color32`（带 alpha）**，暗示内部保留每像素 alpha，所以透明**有希望**——但能不能真透出 Live2D，文档没写，必须实测。

#### 实测结论：全部通过 ✅

在 Unity 6000.1.17f1 + UWB 2.2.8 上逐条验过：

| 验证项 | 结果 |
|---|---|
| 渲染到 `Texture2D`（`BGRA32`） | ✅ |
| **每像素透明**（Diagnostic 场景的红色背景从半透明面板后透出） | ✅ |
| `window.uwb` JS 互操作 | ✅ |
| C# → JS（`ExecuteJs("window.__vnReceive(...)")`） | ✅ |
| JS → C#（`uwb.ExecuteJsMethod` 返回 `true`） | ✅ |
| 鼠标移动 / 点击**坐标准确** | ✅ |
| 键盘 | ✅ |
| 全屏铺满 + 隐藏 UWB 自带导航栏 | ✅ |

> **"隐藏导航栏"不等于"铺满"。** UWB 的 `UnityWebBrowser (TMP)` 预制体里，
> `BrowserController` 的 RectTransform 默认就是缩过的：
> `m_SizeDelta: {x:0, y:-20}`（比父物体矮 20px）+ `m_AnchoredPosition: {x:0, y:-32}`（再往下偏 32px），
> 那是给顶部 42px 的 `Navigation` 条留位置用的。**把 `Navigation` 物体设成 inactive 不会改这两个值** ——
> 结果是导航栏没了，但网页仍然缺一条、还偏着。
>
> 要真铺满，必须在场景里的预制体实例上加三条覆盖（`MainRoom.unity` 和 `MainMenu.unity` 都已加）：
>
> | target 在预制体里是什么 | propertyPath | value |
> |---|---|---|
> | `7454210984040730585` = BrowserController 的 RectTransform | `m_SizeDelta.y` | `0` |
> | 同上 | `m_AnchoredPosition.y` | `0` |
> | `7454210984458747695` = 根物体的 Canvas | `m_SortingOrder` | `100`（压在原生 UI 画布之上） |

**所以"用 AI 生成的 HTML 当游戏前端"这件事，零成本方案已经证实可行。** 文档里写的"新品 Untested""resizing may crash Unity"这些风险没有在这次验证中触发，但发布前仍需自己压一遍。

#### 两个为了绕开 UWB 2.2.8 缺陷而存在的胶水脚本

它们**不是业务代码**，UWB 升级到 3.x 后大概率可以删掉：

| 脚本 | 绕开的问题 |
|---|---|
| `Assets/Scripts/UI/WebInputFix.cs` | UWB 自带的输入层有两处硬伤：①`RawImageUwbClientInputHandler` 的坐标取自 `WebBrowserOldInputHandler`（`UnityEngine.Input.mousePosition`），与本工程 EventSystem 用的新 Input System 对不上，实测能把点击算成 `x=-1197`；②`OnPointerEnter` 在 `!IsConnected` 时直接 return 且只触发一次，导致鼠标移动/键盘的协程永远不启动（表现为 `mousemove` 计数恒为 0）。所以它**自己接管**：坐标改取 `PointerEventData.position`（与命中判定同源），移动/键盘改成每帧轮询。接管时会把 UWB 的 `disableMouseInputs` / `disableKeyboardInputs` 都置为 `true`，**不要在没有同时处理上面那个 `OnPointerEnter` 竞态的情况下把它们改回来**。 |
| `WebUiBridge.cs` 里的 `jsMethodManager.jsMethodsEnable = true` | UWB 默认关闭 JS Methods，而 `RegisterJsMethod` 在关闭状态下会抛 `NotEnabledException`。文档没提这件事。 |

**一个踩过的坑，写下来免得重犯**：手工写场景 YAML 时，fileID **绝不能超出 int32 范围**。曾经用 `7710000001`–`7710000004` 手搓了一个 EventSystem，结果 UWB 和 Unity 自己的 UI（连 `⟳` 刷新按钮）**全部点不动**——因为 Unity 自己的 scene ID 都落在 int32 内，超出范围的对象在反序列化时被静默丢弃。正确做法是**从能用的场景里整段照抄** Unity 自己写的对象块。

UWB 的 JS 互操作与本前端已对齐：

- **C# → JS**：`browserClient.ExecuteJs("window.__vnReceive('...')")` ✅ 与设计一致
- **JS → C#**：**不是 SendMessage**。UWB 注入全局 `uwb`，用 `uwb.ExecuteJsMethod('OnWebMessage', jsonString)`；C# 侧需 `browserClient.RegisterJsMethod<string>("OnWebMessage", 处理方法)` 并开启 `jsMethodsEnable`。`app.js` 的 `send()` 已补上这个分支。

> 本前端统一只传一个 JSON 字符串，正好绕开 UWB 的全部约束（方法必须返回 `void`、参数不支持数组、只支持基本类型与自定义对象）。

**顺带修掉的一个设计缺陷**：原来 `state.mode` 靠"页面上有没有 `vuplex`/`chrome.webview`/`unityInstance` 某个全局对象"来猜桥接模式。不同插件注入的全局名各不相同，猜错会让 JS 和 C# **同时遍历剧情、互相打架**。现在改成由"C# 是否发来第一条消息"决定——判据从"猜"变成"事实"。

**`file://` 下的一个坑（已解决）**：CEF 里 `fetch('story.json')` 会被 CORS 拒绝，所以直接 `initialUrl` 指向本地 `index.html` 时拿不到完整剧本，只会跑样本。现在导出格式已改成 `<script>` 可加载的 `story.js`（`window.VN_STORY = {...}`），并把 `fetch('story.json')` 在 `file:` 协议下整条跳过，免得刷一屏红色报错。

两个共通注意点：

1. **体积**：Vuplex 的 Chromium 会给包体加 360MB（可压到 250MB）。
2. **资源位置**：正式接入时要把 HTML/CSS/JS 和字体一起放进 `StreamingAssets`，不能再走 `../Assets/...` 的相对路径。样式里 `@font-face` 指向 `../Assets/.../ChillRoundF.ttf` 只是为了让浏览器预览能用到游戏字体，`file://` 下可能因 CORS 不生效而退回系统字体。

## 已知缺口 / 待定

- **"返回主菜单"会重置剧情进度**。`MainRoom` 场景重新加载后 `GameManager.Start()` 会从头 `PlayOpening()`，目前**没有存档**。要么加存档（`StoryManager` 记当前 `stepId`，回主菜单时存、进游戏时读），要么把"返回主菜单"改成"暂停菜单"。这是当前最明显的一个功能缺口。
- **原生 Unity UI 没有菜单/设置实现**。两块界面目前都只有 Web 版。要换成原生 UI，得在场景里摆控件，然后实现一套和 `menu/*.js` 等价的视图；C# 侧不用改 —— 设置的读写、场景流转都由独立的自动挂载组件负责，跟"谁渲染"无关。
- **`Assets/Scripts/Manager/`（单数）这个目录应该删掉**。它是早先一次写错路径留下的空壳，内容已清成纯注释；留着不影响编译，但迟早会误导人。
- **发布前要藏掉三个开发用开关**：控制条上的 `主题` / `背景` / `参考层` 和整个 HUD 都只是评审工具，不是给玩家看的。
- **文字速度的取值范围三处不一致**：设置页滑杆只能表达 `8..120` 毫秒（`settings-view.js`），C# 允许 `1..500`（`UiSettingsStore.Clamp`），游戏页按 `8..120` 钳制（`app.js`）。方向是安全的（C# 最宽），但**这三个常量要一起改**。
- **主菜单场景里 UWB 自带的导航栏被隐藏了**。想临时打开（比如改完 HTML 想按 ⟳ 重载而不用重启 Play），在 Hierarchy 里把 WebView 预制体下的 `Navigation` 物体勾上即可。
- **表情映射未定**：剧本里只有 `表情A/B/C`（对应策划案的圣洁/灿烂/委屈），但 `2-3.moc3` 实际的表情资源叫 `发光循环 / 困困眼 / 死鱼眼 / 空虚眼`。两边名字对不上，所以 HUD 只显示 `A（圣洁）`，**没有**映射到具体资源。这张映射表确定后，前端和 `WanXuanLive2DController.SetExpression` 都要跟着改。
- **中文字体**：`@font-face`（在 `theme.css` 里）指向工程里的 `ChillRoundF.ttf`；如果该字体授权不允许再分发，需要换成允许商用的中文字体（`Assets/TextMesh Pro/Resources/Fonts & Materials/` 下还有一个 `WenQuanYi Bitmap Song 13px.ttf`，但它是点阵字体，不适合大字号）。
- **背景是纯 CSS 假背景**（游戏页）：只为判断文字对比度，不是美术方案。真实背景是场景里实例化的 3D `World.prefab`。主菜单页没有假背景，靠场景相机的纯色 + 页面自己的遮罩。
- **`ui.hide` 会被下一次 `dialogue.show` 自动解除**：即新对话默认会把 UI 显示出来。如果 Yui 那段需要长时间保持隐藏，告诉我，我改成显式状态而不是每次对话重置。
- 剧本里 `编号A-013`（长剧本）与策划案的 `编号：8964` 不一致，属于剧本内容问题，不是前端问题。
