---
name: unity-architecture
description: This skill should be used when the user asks to "设计 Unity 架构", "生成 Unity 初始代码架构", "设计 MainRoom 场景层级", "生成 GameManager/StoryManager 骨架", "规划 Live2D 角色控制结构", or wants architecture guidance for the WanXuan's Home Unity visual novel project.
argument-hint: [任务说明，例如：生成脚本骨架 / 设计场景层级 / 输出首版类图]
allowed-tools: [Read, Write, Edit, Glob, Grep]
version: 0.1.0
---

# Unity Architecture Skill for WanXuan's Home

为 `WanXuan's Home` 项目提供 Unity 程序架构设计支持。

用户本次请求：$ARGUMENTS

## Purpose

为这个项目输出可落地、轻量、适合短篇视觉小说的 Unity 程序架构方案。默认围绕以下核心体验展开：

- 剧情推进
- Live2D 表情切换
- 视线跟随
- 单场景背景变体
- 少量 CG 演出
- Yui 小窗特别演出

优先服务实现，不做脱离项目规模的重型架构设计。

## Default Architecture Principles

除非用户明确要求改架构，否则默认使用以下方案：

- 采用**轻量级 Manager of Managers 架构**
- 采用**单主场景 `MainRoom`**
- 以**最小可运行版本**为优先目标
- 不引入重型企业式框架、复杂事件总线、过度抽象的系统层

## Top-Level Structure

默认总控层级：

```text
GameManager
├── StoryManager
├── CharacterManager
├── UIManager
├── AudioManager
└── EnvironmentManager
```

遵守以下约束：

- 让 `GameManager` 只负责初始化、组装引用、启动流程
- 避免把 `GameManager` 写成上帝类
- 把具体表现逻辑放到 Controller / UI 组件，不直接堆在 Manager 里
- 避免把每个小功能都拆成单独 Manager

## Default Project Layout

如果用户要求生成目录、代码骨架、类图或文档，优先按以下结构输出：

```text
Assets/
  Art/
    BG/
    CG/
    UI/
    VFX/

  Audio/
    BGM/
    SE/
    Ambience/
    Voice/

  Live2D/
    WanXuan/

  Prefabs/
    Characters/
    UI/
    VFX/

  Scenes/
    Boot.unity
    MainRoom.unity

  Scripts/
    Core/
      GameManager.cs
      GameBootstrap.cs

    Managers/
      StoryManager.cs
      CharacterManager.cs
      UIManager.cs
      AudioManager.cs
      EnvironmentManager.cs

    Character/
      WanXuanLive2DController.cs
      GazeFollowController.cs
      ExpressionController.cs
      MouthMotionController.cs

    Environment/
      BackgroundController.cs
      TimeOfDayController.cs
      YuiScreenController.cs
      CGEventController.cs

    UI/
      DialogueUI.cs
      ChoiceUI.cs
      NameplateUI.cs
      TypewriterText.cs

    Narrative/
      DialogueLine.cs
      ChoiceData.cs
      StoryCommand.cs
```

## Scene Layout

### Boot.unity

用于：
- 初始化全局系统
- 切入 `MainRoom.unity`

### MainRoom.unity

长期主场景，默认层级：

```text
MainRoom
  Camera
  BackgroundRoot
    BG_Day
    BG_Evening
    BG_Night
    VFX_LightDust
  CharacterRoot
    WanXuanLive2D
  CGRoot
  YuiScreenRoot
  UIRoot
    DialoguePanel
    ChoicePanel
    Nameplate
  AudioRoot
  GameSystems
```

## Responsibilities by Module

### GameManager
- 持有其他 Manager 引用
- 初始化系统
- 启动开场剧情

### StoryManager
- 推进剧情命令流
- 播放对白
- 处理分支选项
- 调用其他 Manager 完成演出

### CharacterManager
- 管理皖萱角色实例
- 切换表情
- 播放动作
- 控制视线跟随
- 控制嘴部开合

下辖：
- `WanXuanLive2DController`
- `GazeFollowController`
- `ExpressionController`
- `MouthMotionController`

### UIManager
- 对话框显示/隐藏
- 名字框管理
- 选项 UI 管理
- Yui 演出时隐藏主对话 UI

### AudioManager
- BGM
- 环境音
- 咀嚼音与 UI 音效

### EnvironmentManager
- 背景 Day / Evening / Night 切换
- 粒子与环境表现
- CG 特写演出
- Yui 小窗视频演出

下辖：
- `BackgroundController`
- `TimeOfDayController`
- `YuiScreenController`
- `CGEventController`

## Live2D Defaults

角色预制体默认结构：

```text
WanXuanCharacter
  CubismModel
  WanXuanLive2DController
  GazeFollowController
  ExpressionController
  MouthMotionController
```

### WanXuanLive2DController

提供以下接口风格：
- `SetExpression(...)`
- `PlayMotion(...)`
- `SetLookAngles(x, y)`
- `SetMouthOpen(value)`

遵守约束：
- 不要让 `StoryManager` 直接操作 `ParamAngleX/Y` 等 Cubism 底层参数

### GazeFollowController

负责：
- 读取鼠标或目标点
- 转换为 `ParamAngleX / ParamAngleY`
- 平滑插值
- 限制最大角度范围

推荐参数：
- `maxX = 20f`
- `maxY = 12f`
- `smoothSpeed = 8f`

目标：实现“她在看你”的陪伴感。

## Staging Defaults

### Background

只需一个客厅背景的三种变体：
- Day
- Evening
- Night

增强动态感的方法：
- 动态阳光
- 尘埃粒子
- 轻微色调变化

### CG Events

对于喂食、做饭等动作：
- 不强做 Live2D 动画
- 改用 2D 插画特写
- 用平移/缩放、淡入淡出增强演出

### Yui Special Performance

默认实现：
- 在电视机区域叠加小窗口
- 用 `VideoPlayer` 或序列帧播放
- Yui 说话时隐藏主对话框

## Narrative Defaults

优先采用**轻量命令流结构**，不要过早设计复杂编辑器。

推荐命令类型：
- `Dialogue`
- `SetExpression`
- `SetBackground`
- `PlaySE`
- `PlayBGM`
- `ShowCG`
- `HideCG`
- `ShowYui`
- `HideYui`
- `Choice`

存储方式优先级：
1. ScriptableObject
2. JSON

## Minimal First Milestone

若用户要求“先做第一版”或“先出骨架”，默认只覆盖：

- `StoryManager`
- `UIManager`
- `CharacterManager`
- `EnvironmentManager`
- `AudioManager`
- `WanXuanLive2DController`
- `GazeFollowController`

目标体验：
1. 进入 `MainRoom`
2. 显示 evening 背景
3. 皖萱模型出现
4. 默认表情 A（圣洁）
5. 鼠标移动时视线跟随
6. 播放第一句对白
7. 点击推进后切换表情 B
8. 播放咀嚼音效

## How to Respond When Invoked

根据用户参数判断输出形式：

### 如果用户要“设计”
输出：
- 架构分层
- 类职责
- 场景层级
- 模块交互关系

### 如果用户要“生成脚本骨架”
输出：
- `GameManager`
- 各 `Manager`
- 关键 `Controller`
- 最小数据结构类

### 如果用户要“生成首版代码”
优先从以下开始：
- `GameManager.cs`
- `StoryManager.cs`
- `CharacterManager.cs`
- `WanXuanLive2DController.cs`
- `GazeFollowController.cs`
- `DialogueUI.cs`
- `BackgroundController.cs`

### 如果用户要“审查方案”
检查是否违反以下规则：
- Manager 过多
- `GameManager` 过重
- Story 层直接操作底层 Cubism 参数
- 为小项目引入不必要复杂抽象

## Output Style

- 优先服务实现，不空谈架构
- 默认给出可落地的 Unity 类设计
- 保持轻量，不引入不必要系统
- 如果用户没要求，不擅自扩展到存档、多语言、复杂编辑器、任务系统

如果用户参数为空，就基于以上规范，先给出一份适合当前项目的 Unity 初始代码架构建议。
