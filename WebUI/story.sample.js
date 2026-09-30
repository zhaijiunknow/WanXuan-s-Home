/* ============================================================
   样本剧本数据 · 真实剧本《第一幕》的精简摘录
   ------------------------------------------------------------
   用途：让前端在没有 Unity 的情况下也能评排版、评节奏。
   内容全部取自 完整剧本.txt，只做了删减，没有改写。

   正式接入时请用 Unity 菜单：
     WanXuan > 导出 Web 剧本 JSON
   生成 WebUI/story.json（完整 1397 步，id 与 StoryAsset 完全一致）。
   app.js 会优先加载 story.json，加载不到才回退到这份样本。

   数据结构与导出的 JSON 一致，字段含义对应 StoryStep：
     type        marker | narration | dialogue | choice | end
     markerTitle 对应 StoryStep.MarkerTitle（幕标题 / 场景标题）
     stageNote   对应 StoryStep.StageNote（【场景】【BGM】【立绘】等演出提示）
     expression  对应 DialogueLine.ExpressionId，这里是剧本里的 表情A/B/C
     background  对应 DialogueLine.Background 的 0/1/2 → day/evening/night
   ============================================================ */

window.VN_SAMPLE_STORY = {
  version: 1,
  storyId: "sample_excerpt",
  storyTitle: "坠落凡间的头号食客",
  isSample: true,

  steps: [
    /* ---------- 第一幕 · 1-1 寂静的独居生活 ---------- */
    { id: "1-1", type: "marker", markerTitle: "1-1　寂静的独居生活",
      stageNote: "【场景】客厅 / 午后 / 晴\n【BG】大客厅，大片落地窗，光线安静地落在地板上\n【BGM】轻柔钢琴，极淡",
      background: "day", next: "1-1-text-0002" },

    { id: "1-1-text-0002", type: "narration", background: "day", next: "1-1-text-0003",
      content: "独居久了以后，房间会长出一种很奇怪的静。" },

    { id: "1-1-text-0003", type: "narration", background: "day", next: "1-1-text-0004",
      content: "不是没有声音。冰箱会低低地运行，空调会送出均匀的风，墙上的钟会一下一下往前走。" },

    { id: "1-1-text-0004", type: "narration", background: "day", next: "1-1-text-0005",
      content: "但那些声音都太规律了，规律得像一种被允许存在的背景。它们不打扰人，也不陪伴人。" },

    { id: "1-1-text-0005", type: "narration", background: "day", next: "1-1-text-0006",
      content: "我坐在客厅中央的沙发上，拆开一只纸盒。里面是我前几天预约的限量草莓蛋糕。" },

    { id: "1-1-text-0006", type: "narration", background: "day", next: "1-1-text-0007",
      content: "城里很难订，价格也夸张。店家用透明的薄膜罩着，像在保护一件比甜点更接近展品的东西。" },

    { id: "1-1-text-0007", type: "dialogue", speaker: "我", background: "day", next: "1-1-text-0008",
      content: "明明是这么甜的东西，一个人吃，好像也只是多余的热量而已。" },

    { id: "1-1-text-0008", type: "narration", background: "day", next: "1-1-text-0009",
      content: "客厅里太安静了。安静到我甚至能听见叉子碰到纸盘边缘时那一声很轻的“嗒”。" },

    { id: "1-1-text-0009", type: "narration", background: "day", next: "1-1-text-0010",
      content: "有时候我会怀疑，自己是不是已经把生活过成了一个密封得太好的储物盒。" },

    { id: "1-1-text-0010", type: "narration", background: "day", next: "1-1-text-0011",
      content: "我正准备吃第三口。" },

    { id: "1-1-text-0011", type: "narration", background: "day", next: "1-1-text-0012",
      content: "——轰！！\n一声巨响从阳台方向砸了过来。落地窗都跟着震了一下。" },

    { id: "1-1-text-0012", type: "dialogue", speaker: "我", background: "day", next: "1-2",
      content: "……什么东西？" },

    /* ---------- 第一幕 · 1-2 天使的着陆 ---------- */
    { id: "1-2", type: "marker", markerTitle: "1-2　天使的着陆",
      stageNote: "【场景】阳台 / 午后\n【立绘】皖萱 [表情A：圣洁]",
      background: "day", next: "1-2-text-0014" },

    { id: "1-2-text-0014", type: "narration", background: "day", next: "1-2-text-0015",
      content: "阳光正铺在阳台门前，白得刺眼。隔着玻璃，我先看见一团散开的白色裙摆，再看见一个蜷缩着的人影。" },

    { id: "1-2-text-0015", type: "narration", background: "day", next: "1-2-text-0016",
      content: "她背后有一对半透明的羽翼——不是电影里那种夸张而耀眼的样子，更像晨雾凝成的形状，薄而轻，稍微一动就像会散掉。" },

    { id: "1-2-text-0016", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-2-text-0017",
      content: "打扰了。" },

    { id: "1-2-text-0017", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0018",
      content: "……你是谁？" },

    { id: "1-2-text-0018", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-2-text-0019",
      content: "我是来自天界的实习天使，编号A-013。此次降临人间，是为了调查“人类幸福的来源”。" },

    { id: "1-2-text-0019", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0020",
      content: "你是……在拍节目吗？" },

    { id: "1-2-text-0020", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-2-text-0021",
      content: "不是。" },

    { id: "1-2-text-0021", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0022",
      content: "……那你是怎么进我家阳台的？" },

    { id: "1-2-text-0022", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-2-text-0023",
      content: "理论上，是“优雅降临”。" },

    { id: "1-2-text-0023", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0024",
      content: "理论上？" },

    { id: "1-2-text-0024", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-2-text-0025",
      content: "实际操作出现了一点偏差。" },

    { id: "1-2-text-0025", type: "narration", background: "day", next: "1-2-text-0026",
      content: "我还想再问，下一秒，她的肚子突然发出一声极其清晰、极其响亮的——" },

    { id: "1-2-text-0026", type: "narration", background: "day", next: "1-2-text-0027",
      content: "“咕——”" },

    { id: "1-2-text-0027", type: "narration", background: "day", next: "1-2-text-0028",
      content: "空气静止了。她僵住，我也僵住。有那么一瞬间，连窗外的风都像识趣地停了。" },

    { id: "1-2-text-0028", type: "dialogue", speaker: "皖萱", expression: "C", background: "day", next: "1-2-text-0029",
      content: "调查工作消耗比较大。" },

    { id: "1-2-text-0029", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0030",
      content: "原来天使也会饿？" },

    { id: "1-2-text-0030", type: "narration", background: "day", next: "1-2-text-0031",
      content: "她停住，目光忽然越过我，落在客厅茶几上的蛋糕上。那目光几乎是发亮的。" },

    { id: "1-2-text-0031", type: "dialogue", speaker: "皖萱", expression: "C", background: "day", next: "1-2-text-0032",
      content: "……那个，是人类的幸福样本吗？" },

    { id: "1-2-text-0032", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0033",
      content: "大概算吧。" },

    { id: "1-2-text-0033", type: "narration", background: "day", next: "1-2-text-0034",
      content: "她低头咬了一口。" },

    { id: "1-2-text-0034", type: "narration", background: "day", next: "1-2-text-0035",
      content: "那一瞬间，我知道“表情发亮”不是夸张修辞。她睫毛轻轻一颤，眼睛猛地睁大，像有某种极柔和又极盛大的光从眼底一下子漫开。" },

    { id: "1-2-text-0035", type: "dialogue", speaker: "皖萱", expression: "B", background: "day", next: "1-2-text-0036",
      content: "……好厉害。" },

    { id: "1-2-text-0036", type: "dialogue", speaker: "我", background: "day", next: "1-2-text-0037",
      content: "只是蛋糕而已。" },

    { id: "1-2-text-0037", type: "dialogue", speaker: "皖萱", expression: "B", background: "day", next: "1-2-text-0038",
      content: "不是“只是”。它先是软的，像云。然后草莓的味道会在后面追上来，酸一点点，刚好把甜托住。奶油明明很凉，可是吃下去的时候，胸口却会慢慢热起来。" },

    { id: "1-2-text-0038", type: "dialogue", speaker: "皖萱", expression: "B", background: "day", next: "1-2-text-0039",
      content: "这就是……人类说的“好吃得想叹气”吗？" },

    { id: "1-2-text-0039", type: "narration", background: "day", next: "1-3",
      content: "同样一块蛋糕，我刚才只吃出了价格、手艺和新鲜度。可从她嘴里说出来，它忽然像第一次真正有了味道。" },

    /* ---------- 第一幕 · 1-3 借宿成立 ---------- */
    { id: "1-3", type: "marker", markerTitle: "1-3　“观察人类”的合理借宿",
      stageNote: "【场景】客厅 / 午后延续",
      background: "day", next: "1-3-text-0041" },

    { id: "1-3-text-0041", type: "dialogue", speaker: "皖萱", expression: "A", background: "day", next: "1-3-text-0042",
      content: "经过初步调查，我认为你具有较高的观察价值。" },

    { id: "1-3-text-0042", type: "dialogue", speaker: "我", background: "day", next: "1-3-text-0043",
      content: "你直接说你想蹭吃蹭住就行。" },

    { id: "1-3-text-0043", type: "dialogue", speaker: "皖萱", expression: "C", background: "day", next: "prototype-jump",
      content: "……如果用人类比较容易理解的说法，是的。" },

    /* ---------- 原型快捷跳转：真实剧本这里还有二、三幕 ---------- */
    { id: "prototype-jump", type: "narration", background: "night", next: "4-3-choice",
      content: "【原型快捷跳转】真实剧本在此之后还有第二幕、第三幕共数百步。为了让选项 UI 和结局 UI 能立刻评审，这里直接跳到第四幕的分歧点。" },

    /* ---------- 第四幕 · 分歧点（真实选项文案） ---------- */
    { id: "4-3-choice", type: "choice", background: "night",
      choices: [
        { label: "拉住她：“留下来。”", next: "5A-1" },
        { label: "松开手：“回去吧。”", next: "5B-1" }
      ] },

    /* ---------- 结局分支 A · HE ---------- */
    { id: "5A-1", type: "marker", markerTitle: "结局分支 A：HE《永不落幕的茶会》",
      stageNote: "【场景】客厅 / 夜 / 雨声渐缓",
      background: "night", next: "5A-1-text-1123" },

    { id: "5A-1-text-1123", type: "narration", background: "night", next: "5A-1-text-1124",
      content: "我的回答几乎没有经过思考。或者说，这个答案其实早就写在了我每一次迟疑、每一次克制、每一次不敢逼她选的时候。" },

    { id: "5A-1-text-1124", type: "narration", background: "night", next: "5A-1-text-1125",
      content: "我朝她走过去。一步。两步。然后，在她准备移开视线之前，伸手握住了她的手腕。" },

    { id: "5A-1-text-1125", type: "dialogue", speaker: "我", background: "night", next: "ending-he",
      content: "留下来。" },

    { id: "ending-he", type: "end",
      endingTitle: "永不落幕的茶会",
      endingMessage: "皖萱留在了人间。\n茶会还会继续。" },

    /* ---------- 结局分支 B · 飞升 ---------- */
    { id: "5B-1", type: "marker", markerTitle: "结局分支 B：飞升结局《把甜味带回去的人》",
      stageNote: "【场景】客厅 / 夜 / 雨未停",
      background: "night", next: "5B-1-text-1276" },

    { id: "5B-1-text-1276", type: "narration", background: "night", next: "5B-1-text-1277",
      content: "我把手松开的时候，动作比想象中轻。像在放走一片本来就不该被握住的雪。" },

    { id: "5B-1-text-1277", type: "dialogue", speaker: "我", background: "night", next: "ending-be",
      content: "回去吧。" },

    { id: "ending-be", type: "end",
      endingTitle: "把甜味带回去的人",
      endingMessage: "皖萱带着这段甜味回到了天空。" }
  ]
};
