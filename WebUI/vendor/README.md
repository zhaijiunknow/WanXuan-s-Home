# vendor · 第三方库

> **这份说明已经改过一次。** 上一版让你去下 `pixi-live2d-display` + Live2D 官网的
> `live2dcubismcore.min.js`，那是基于"我们要自己用 PIXI 搭一个 Live2D 渲染层"的方案。
> 现在改用 **`oh-my-live2d`** —— 它开箱就有 `position` / `scale` / `stageStyle` 这些
> 排版参数，而且 bundle 里内联了 Cubism core，不用再跑一趟官网。

需要的只有一个文件：

```
WebUI/vendor/oh-my-live2d.min.js
```

来源（任选）：

```
https://unpkg.com/oh-my-live2d/dist/index.min.js
https://cdn.jsdelivr.net/npm/oh-my-live2d/dist/index.min.js
```

用浏览器打开、另存为，或者：

```powershell
curl.exe -L -o WebUI/vendor/oh-my-live2d.min.js https://unpkg.com/oh-my-live2d/dist/index.min.js
```

## 文件不在时会发生什么

`menu/live2d.js` 会**先从 CDN 拉一份顶着**，立绘照样出来，但右下角会一直挂着一条
警告条（提醒你"发布前必须落地到本地"）。本地文件一放进去，警告条自动消失。

这条 CDN 通道是**开发预览专用**，不是正式路径 —— 见下。

## 为什么必须落到本地，不能直接用 CDN

`PersonalPage/index.html` 里是直接 `<script src="https://unpkg.com/oh-my-live2d@latest">`，
那对一个个人网站没问题。但这是**要发布的游戏**：

- 玩家断网 / CDN 挂了 → 主菜单上的立绘直接没了
- `@latest` 意味着某天上游发新版，你的菜单在玩家机器上悄悄变了样
- CEF 在有些环境下对跨域脚本的处理和普通浏览器不一样，多一个不确定因素

所以：**本地一份，版本锁死。**

## 授权

`oh-my-live2d` 本身是 MIT。但**它内联了 Live2D 的 Cubism core，那部分是 Live2D 的授权件**——
MIT 覆盖不到。你们既然已经在用 Unity 版 Cubism SDK，条款这一层大概率是一致，
但**请自己确认一次**，我不替你判断。

## 一个还没验证的点

我在 bundle 里读到的是 **`moc`（Cubism 2）那份 core** 的内联代码。Cubism 3/4 的 `moc3`
能不能被同一个 bundle 处理、还是要它运行时再去别处取一次 core，**我没有实际跑过**，
不敢下结论。你 `PersonalPage` 用的是同一个模型且能用，所以大概率没问题 ——
但第一次跑的时候请看一眼 Console 有没有去找外部 core 的请求，如果有，
那份文件也要一起落到 `vendor/`。
