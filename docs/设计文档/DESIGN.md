# Wood 工程平台设计系统

> 本文档描述 Wood 工程平台（Next.js + shadcn/ui + Ant Design）的视觉语言、配色规范、组件风格与布局原则，供 AI Agent 和开发者一致参考。

## 1. 视觉基调

Wood 工程平台的整体风格定位为**简洁商务**：无渐变装饰、不追求视觉张力，以高可读性的数据呈现和清晰的功能导航为核心目标。

背景采用略带蓝调的中性白 `#f8faff`，配以纯白卡片和无边框大阴影，让内容从背景中自然浮起。导航区始终使用白色底色，形成清晰的层级结构：深色左侧菜单（`#233845`）→ 白色顶栏 → 浅蓝白内容区。

品牌色为深青绿 `#007069`，兼顾专业感与辨识度，在数据高亮、操作按钮和进度指示上统一呈现。

**核心特征：**
- 无渐变、无装饰性色彩，颜色仅用于功能表意
- 品牌色 `#007069` 贯穿交互元素和数据着色
- `#f8faff` 内容区背景 + 白色卡片 + `shadow-md` 组合构成主要视觉层次
- 系统字体栈，中英文均不引入自定义字体
- 圆角保守（4px～8px），不使用全圆角装饰卡片
- 数据数值使用千位分隔符

## 2. 色彩系统

### 主色

| 名称 | 值 | 用途 |
|------|----|------|
| Brand | `#007069` | 主操作按钮、数据高亮、激活态导航、图表主色 |
| Brand Hover | `#005c56` | 主按钮 hover 态 |
| Brand Active | `#004842` | 主按钮 active / 链接 active |
| Brand Tint 10% | `rgba(0,112,105,0.1)` | 数据卡片背景块、表格表头背景、进度条轨道 |
| Brand Tint 5% | `rgba(0,112,105,0.05)` | 次级数据块背景 |
| Brand Tint 3% | `rgba(0,112,105,0.03)` | 表格斑马纹奇数行 |
| Brand Tint 20% | `rgba(0,112,105,0.2)` | 分隔线、进度轨道强调 |
| Brand Border 30% | `rgba(0,112,105,0.3)` | 卡片 hover 边框 |
| Brand Border 50% | `rgba(0,112,105,0.5)` | 首要模块卡片边框 |

### 背景与表面

| 名称 | 值 | 用途 |
|------|----|------|
| Content Background | `#f8faff` | 主内容区域背景 |
| Page Background | `#f3f4f6` (`gray-100`) | 整页底色（平台首页） |
| Surface White | `#ffffff` | 卡片、顶栏、侧边栏浮层 |
| Surface Gray | `#f9fafb` (`gray-50`) | 卡片头部、表格行 |
| Sidebar Dark | `#233845` (`gray-800`) | 左侧固定菜单背景 |

### 文字

| 名称 | 值 | 用途 |
|------|----|------|
| Primary Text | `#374151` (`gray-700`) | 卡片标题、正文 |
| Heading Text | `#233845` (`gray-800`) | 页面主标题 |
| Secondary Text | `#6b7280` (`gray-500`) | 说明文字、元信息 |
| Muted Text | `#9ca3af` (`gray-400`) | 占位符、辅助标注 |
| Brand Text | `#007069` | 数据数值、品牌强调文字 |
| On-Brand Text | `#ffffff` | 品牌色背景上的文字 |
| Chart Axis Text | `#115e59` | 图表轴标签 |

### 语义色

| 名称 | 值 | 用途 |
|------|----|------|
| Success Background | `#dcfce7` (`green-100`) | 增量徽章背景 |
| Success Text | `#166534` (`green-800`) | 增量徽章文字 |
| Warning | `#f59e0b` | 警告态（如超期） |
| Danger | `#ef4444` | 错误、删除操作 |
| Arrow Up (数据增) | `#ef4444` (`red-500`) | 应收款项等上升指标 |

### 浮动按钮（固定在页面角落）

| 名称 | 值 | 用途 |
|------|----|------|
| Float Default | `#555555` | 折叠/展开控制按钮 |
| Float Help Desk Hover | `#f3a547` | Help Desk hover |
| Float Speak Up Hover | `#a50164` | Speak Up hover |
| Float Heart Hover | `#00a0af` | Heart 安全观察 hover |

## 3. 字体规范

平台使用系统字体栈，不引入自定义字体，确保中英文在各操作系统上均有良好显示。

### 字体栈

```
font-family: system-ui, -apple-system, "Segoe UI", Helvetica Neue, Arial, sans-serif
```

Tailwind 默认 `font-sans` 即可满足需求。

### 字号与权重层级

| 场景 | Tailwind 类 | 字号 | 权重 |
|------|------------|------|------|
| 页面主标题 | `text-2xl font-semibold` | 24px | 600 |
| 页面副标题 / 区块标题 | `text-xl font-semibold` | 20px | 600 |
| 卡片标题（大） | `text-lg font-semibold` | 18px | 600 |
| 卡片标题（小） | `text-sm font-medium` | 14px | 500 |
| 数据大值 | `text-3xl font-bold` | 30px | 700 |
| 数据中值 | `text-xl font-bold` | 20px | 700 |
| 数据小值 | `text-lg font-bold` | 18px | 700 |
| 正文 / 表格内容 | `text-sm` | 14px | 400 |
| 辅助说明 / 元信息 | `text-xs` | 12px | 400 |
| 导航链接 | `text-sm` | 14px | 400 |

### 原则

- 层级靠字号和权重区分，不依赖颜色；颜色用于功能语义
- 数据看板中的核心指标值使用 `text-3xl font-bold text-[#007069]`，视觉权重最高
- 次级数据块中的数值用 `text-xl font-bold` 或 `text-lg font-bold`，与主值形成对比
- 标签、辅助信息统一用 `text-xs`，颜色降级为 `text-gray-500`

## 4. 组件规范

### 按钮

**主操作按钮（Primary）**
- 背景：`#007069`，文字：白色
- Hover：`#005c56`
- Padding：`px-4 py-1.5` 或 `px-4 py-2`
- 圆角：`rounded-lg`（8px）
- 适用：页面级主操作、数据筛选执行

```tsx
<button className="px-4 py-1.5 bg-[#007069] text-white text-sm rounded-lg hover:bg-[#005c56] transition-colors">
  操作名称
</button>
```

**导航激活态（Nav Active）**
- 背景：`#007069`，文字：白色
- Hover：`hover:bg-[#007069] hover:text-gray-200`（保持品牌色）
- 圆角：`rounded`（4px）

**次级按钮 / Ghost**
- 使用 shadcn `variant="ghost"` 或 `variant="outline"`
- 默认灰色系，hover 时显示 `bg-gray-100`

**快捷入口按钮（Icon Grid）**
- `variant="outline"`，高度固定 `h-24`，flex 纵向排列图标+文字
- Hover：`hover:bg-gray-50`

### 卡片（Cards）

所有卡片遵循统一规范：

```
border-0 shadow-md  bg-white  rounded-lg
```

- 无边框（`border-0`），用阴影区分层次
- `shadow-md` 是标准阴影，hover 时可升至 `shadow-lg`
- 内边距：`p-4`（标准）；紧凑场景用 `p-2`
- 卡片头部区域如需灰色底色：`bg-gray-50 py-3 px-4`

**特殊：首要模块卡片（Portal 首页）**
- 添加 `border border-[#007069]/50 bg-[#007069]/5` 表示重要性
- Hover：`hover:shadow-md hover:border-[#007069]/30`

**数据块（Tinted Data Tile）**
- 背景：`bg-[#007069]/10 p-3 rounded-lg`
- 数值：`text-xl font-bold text-[#007069]`
- 标签：`text-sm text-[#007069]`

### 表格（Ant Design Table）

通过 ConfigProvider 和自定义 `components` 统一品牌色：

```tsx
<ConfigProvider theme={{ token: { colorPrimary: '#007069', colorLink: '#007069', colorLinkHover: '#005c56' } }}>
  <Table
    bordered
    size="small"
    components={{
      header: {
        cell: ({ children, ...restProps }) => (
          <th {...restProps} style={{ background: 'rgba(0,112,105,0.1)', color: '#007069', fontWeight: 'normal' }}>
            {children}
          </th>
        ),
      },
    }}
    rowClassName={(_, index) => index % 2 === 0 ? 'bg-white' : 'bg-[#007069]/[0.03]'}
  />
</ConfigProvider>
```

- 表头背景：`rgba(0,112,105,0.1)`，颜色：`#007069`，权重 normal
- 斑马纹：偶数行 `bg-white`，奇数行 `rgba(0,112,105,0.03)`
- 边框色：`rgba(0,112,105,0.2)`

### 表单与筛选

- Ant Design `Select` / `Switch` 通过 ConfigProvider 继承品牌色
- 搜索输入框：`focus:ring-2 focus:ring-[#007069] focus:border-transparent`
- 筛选不做实时响应，点击搜索按钮后执行

### 进度条 / 进度环

**线性进度条**
```tsx
<div className="flex-1 h-3 bg-[#007069]/20 rounded-full overflow-hidden">
  <div className="h-full bg-[#007069] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
</div>
```

**环形进度（Recharts DonutChart）**
- 填充色：`#007069`
- 轨道色：`rgba(0,112,105,0.2)`
- 中心文字：`text-sm font-bold text-[#007069]`

### 导航

**顶部导航栏**
- 背景：`bg-white shadow-sm`，`sticky top-0 z-10`（或 `z-20`）
- 模块标签：`variant="ghost" size="sm"` + 激活态 `bg-[#007069] text-white`
- 右侧：用户下拉 + 返回首页

**左侧固定菜单（仅数据看板等功能使用）**
- 宽度：`w-16`（64px），固定定位
- 背景：`bg-gray-800`
- 图标：`text-white`（激活）/ `text-gray-400`（默认），hover `hover:bg-gray-700`
- Logo 区：白色圆形 `bg-white rounded-full`，内有品牌字母

**标签页（Tabs）**
- 使用 shadcn `Tabs` 组件
- 激活标签通过品牌色下划线或背景区分（shadcn 默认样式）

### 详情跳转链接（Icon Link）

数据看板中常见的小圆形跳转按钮规范：

```tsx
<Link
  href="/detail-page"
  className="w-5 h-5 rounded-full bg-[#007069]/10 flex items-center justify-center hover:bg-[#007069]/20 transition-colors"
>
  <RightOutlined className="text-xs text-[#007069]" />
</Link>
```

### 增量徽章

```tsx
<span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800">
  +12.5%
</span>
```

### 浮动操作按钮组（Fixed Bottom-Left）

```tsx
<div className="fixed bottom-4 left-4 flex flex-col space-y-2">
  {/* 折叠控制 */}
  <button className="w-12 h-12 bg-[#555555]/50 hover:bg-[#333333]/50 text-white shadow-md rounded-sm" />
  {/* 功能按钮 */}
  <button className="w-36 h-12 bg-[#555555] hover:bg-[#f3a547] text-white shadow-md rounded-sm" />
</div>
```

注意：浮动按钮使用 `rounded-sm`（2px），区别于内容区的 `rounded-lg`。

## 5. 布局原则

### 页面结构

```
┌──────────────────────────────────────────────────────┐
│  顶部导航（白色，sticky，h-20 或 h-14，shadow-sm）       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  内容区（bg-[#f8faff] 或 bg-gray-100，min-h-screen）  │
│  container mx-auto px-4 py-8                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

带左侧菜单的看板页面：

```
┌─────┬────────────────────────────────────────────────┐
│ 左  │  固定顶栏（white，h-20，fixed，z-20）              │
│ 侧  ├────────────────────────────────────────────────┤
│ 菜  │  内容区（bg-[#f8faff]，ml-16，pt-20）             │
│ 单  │                                                │
│ w-16│                                                │
└─────┴────────────────────────────────────────────────┘
```

### 栅格与间距

- 卡片网格：`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`（数据看板）
- 模块卡片：`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`（门户首页）
- 容器：`container mx-auto px-4`
- 卡片内边距：`p-4` 标准，`p-2` 紧凑，`py-2 px-4` 头部
- 区块间距：`space-y-4`
- 卡片内元素间距：`gap-2`（数据块）、`gap-4`（卡片组）

### 圆角规范

| 场景 | 值 | Tailwind 类 |
|------|----|-------------|
| 主操作按钮 | 8px | `rounded-lg` |
| 卡片 | 8px | `rounded-lg` |
| 数据块、小卡片 | 8px | `rounded-lg` |
| 小圆形按钮/图标链接 | 全圆 | `rounded-full` |
| 浮动功能按钮 | 2px | `rounded-sm` |
| 图标背景块（快速入口） | 8px | `rounded-lg` |
| 徽章/标签 | 全圆 | `rounded-full` |

### 阴影规范

| 场景 | Tailwind 类 |
|------|-------------|
| 卡片（标准） | `shadow-md` |
| 卡片 hover | `shadow-lg` |
| 顶栏 / 导航 | `shadow-sm` |
| 浮动按钮 | `shadow-md` |

## 6. 图表规范（Recharts）

所有图表统一使用品牌色系：

```tsx
// 折线图
<Line stroke="#007069" strokeWidth={2} dot={{ r: 2, fill: '#007069' }} />

// 坐标轴
<XAxis tick={{ fontSize: 12, fill: '#115e59' }} axisLine={false} tickLine={false} />

// 网格线
<CartesianGrid horizontal vertical={false} stroke="rgba(0,112,105,0.1)" />

// Tooltip 容器
<div className="bg-white p-2 border border-teal-200 rounded shadow-sm">
  <p className="text-sm text-[#007069]">...</p>
</div>

// 饼图 / 环形图
const COLORS = ['#007069', 'rgba(0,112,105,0.2)'];
```

- Y 轴可隐藏刻度，使用数据标签直接标注
- 图表背景透明，卡片本身提供白色底色

## 7. 交互规范

### Hover 态

- 主按钮：背景深化至 `#005c56`
- 导航标签：默认 `hover:bg-gray-100`，激活态保持品牌色
- 卡片：`hover:shadow-md hover:border-[#007069]/30`
- 图标链接：`hover:bg-[#007069]/20`
- 图片卡片：`hover:shadow-md transition-shadow`

### 过渡动画

- 颜色/背景过渡：`transition-colors`（默认 150ms）
- 阴影过渡：`transition-shadow`
- 展开/收起内容：`transition-all duration-300 ease-in-out`，使用 `max-h` + `opacity` 实现
- 按钮展开宽度：`transition-all duration-300 ease-in-out`

### 焦点态

- 输入框：`focus:ring-2 focus:ring-[#007069] focus:border-transparent`
- 不使用默认蓝色 focus ring

### 弹窗与模态

- 使用 shadcn `Dialog`
- 固定宽高，标题栏和底部操作区固定，内容区垂直滚动
- 模态打开时禁用页面滚动（shadcn 默认处理）

## 8. 分页与列表规范

- 所有列表以分页形式呈现，每页最多 10 条
- 使用 Ant Design `Table` 分页或 shadcn Pagination 组件
- 分页器颜色跟随 ConfigProvider 品牌色 `#007069`

## 9. Agent 快速参考

### 颜色速查

```
页面背景色：     #f8faff
卡片/顶栏背景：  #ffffff
左侧菜单背景：   #233845
品牌色：         #007069
品牌 hover：    #005c56
品牌 active：   #004842
数据块背景：     rgba(0,112,105,0.1)
品牌边框：       rgba(0,112,105,0.3)
主文字：         #374151 (gray-700)
次文字：         #6b7280 (gray-500)
图表轴：         #115e59
```

### 常用组件片段

**数据看板卡片**
```tsx
<Card className="border-0 shadow-md">
  <CardContent className="p-4">
    <div className="flex items-center gap-2 mb-2">
      <h3 className="font-medium text-sm text-gray-700">年度新签合同额（万元）</h3>
    </div>
    <div className="text-3xl font-bold text-[#007069]">75,120.41</div>
    <div className="flex items-center mt-2 text-sm">
      <span className="text-gray-500 mr-2">本月新增</span>
      <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800">+12.5%</span>
    </div>
  </CardContent>
</Card>
```

**数据块（Tinted Tile）**
```tsx
<div className="bg-[#007069]/10 p-3 rounded-lg">
  <p className="text-xl font-bold text-[#007069]">22,947.25</p>
  <p className="text-sm text-[#007069] mt-1">当前 WIP</p>
</div>
```

**主操作按钮**
```tsx
<button className="px-4 py-1.5 bg-[#007069] text-white text-sm rounded-lg hover:bg-[#005c56] transition-colors">
  查询
</button>
```

**门户模块卡片**
```tsx
<Card className="h-full transition-all hover:shadow-md hover:border-[#007069]/30">
  <CardHeader className="pb-2">
    <div className="p-2 rounded-lg bg-gray-100 text-gray-700 w-fit">
      <Icon className="h-6 w-6" />
    </div>
    <CardTitle className="text-lg mt-2">模块名称</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-gray-500">模块功能描述</p>
  </CardContent>
</Card>
```

**Ant Design 主题配置（全局）**
```tsx
<ConfigProvider theme={{ token: { colorPrimary: '#007069', colorLink: '#007069', colorLinkHover: '#005c56', colorLinkActive: '#004842' } }}>
  {/* 页面内容 */}
</ConfigProvider>
```

### 开发检查清单

1. 页面背景使用 `bg-[#f8faff]`（数据看板）或 `bg-gray-100`（功能页）
2. 卡片统一 `border-0 shadow-md bg-white rounded-lg`
3. 品牌色操作按钮：`bg-[#007069] hover:bg-[#005c56]`
4. 数字数据加千位分隔符（`.toLocaleString()` 或手动格式化）
5. Ant Design 组件必须包裹 ConfigProvider 注入品牌色
6. 所有列表分页，每页最多 10 条
7. 筛选点击搜索按钮后执行，不做实时筛选
8. 模态窗口固定宽高，仅内容区滚动
9. 不使用 Emoji 替代图标，使用 Lucide React 或 Ant Design Icons
10. 不引入渐变色背景装饰
