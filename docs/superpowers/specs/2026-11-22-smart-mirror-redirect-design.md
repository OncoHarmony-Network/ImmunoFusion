# 智能镜像选择页（index.html）设计文档

日期：2026-11-22
状态：待批准

## 意图与动机

用户从全球各地访问 GitHub Pages 入口 `https://oncoharmony-network.github.io/ImmunoFusion/` 时，当前页面不做任何检测、瞬间把所有人导向单一 HTTP 主站（`biotree.top:38124`）。问题：

- 不区分用户地理位置，离主站远的用户体验差
- 目标站宕机时用户没有任何备用路径，也没有反馈入口
- 瞬间跳转到 HTTP 地址触发浏览器「不安全」警告

目标：入口页自动为用户选出当前最快可达的镜像站点并跳转；全部不可达时展示完整站点列表并引导到 GitHub Issues 反馈。

## 目标 / 非目标 / 反目标

**目标**

- 并行探测所有可探测镜像，限时 ~3 秒，选延迟最低者
- 倒计时 3 秒自动跳转，用户可一键取消或改选
- 每个镜像实时显示状态：检测中 / 正常（延迟 ms）/ 不可用
- HTTP 镜像（biotree）无法在 HTTPS 页面内探测，始终作为手动选项列出
- 全部失败：完整列表 + 醒目的 Issues 反馈引导
- 页面语言：全英文（2026-11-22 用户指示，取消原中英双语设计：移除 zh 字典、语言切换按钮、navigator 语言探测与 `if-pref-lang` 存储键）
- 单文件、零依赖、无构建步骤，直接托管于 GitHub Pages
- `<noscript>` 降级为纯静态链接列表；响应式、可访问（aria-live、prefers-reduced-motion）

**非目标**

- 不做精确测速网络（如 RUM 上报）；探测数据只存用户浏览器 localStorage
- 不引入框架、CDN、构建工具
- 不探测 HTTP 镜像的存活状态（浏览器混合内容策略不允许）

**反目标**

- 不得出现「全部失败但页面没告诉用户怎么办」的死胡同
- 不得静默跳转失败（跳转被拦截时必须留在本页并展示列表）

## 约束

1. **混合内容**：GitHub Pages 强制 HTTPS，`biotree.top:38124` 为 HTTP。浏览器会拦截 HTTPS 页面向 HTTP 地址的 subresource 请求，故 biotree 只能手动点击，不可自动探测、不纳入自动选路。
2. **跨域探测**：`fetch(url, {mode:'no-cors'})` 返回 opaque 响应，只能得知「可达与否 + 耗时」，无法读取内容——对本需求足够。
3. **无构建环境**：纯静态仓库，产物必须是单个自包含 `index.html`。

## 备选方案与取舍

| 方案 | 描述 | 取舍 |
|------|------|------|
| **A. 限时测速选最优（已选定）** | 并行探测 HTTPS 镜像，~3s 窗口内取延迟最低者，倒计时 3s 跳转，可取消 | 多等 1–2s，但选出的站点大概率真正最快 |
| B. 竞速谁先通跳谁 | 第一个成功响应的立即跳转 | 离开最快，但「先回包」≠「最合适」，易受偶发抖动误导 |
| C. 只展示状态手动点击 | 不自动跳转 | 最可控，但违背「自动选站」核心诉求 |

选定 **A**：用户明确要「自动选择最合适的站点」，B 赌运气、C 不自动。

## 实现要点

### 站点配置（硬编码于页面内）

```js
const MIRRORS = [
  { id: 'zhoulab', url: 'https://shiny.zhoulab.ac.cn/ImmunoFusion/', auto: true },
  { id: 'lisom',   url: 'https://lisom.work/shinyapps/ImmunoFusion/', auto: true },
  { id: 'biotree', url: 'http://biotree.top:38124/ImmunoFusion/', auto: false }, // HTTP：仅手动
];
```

### 探测逻辑

- 对每个 `auto: true` 镜像：`performance.now()` 计时 + `fetch(url, {mode:'no-cors', cache:'no-store'})`，与超时竞速
- 单个探测超时：5s（照顾跨洲冷启动）；整体决策截止：3.5s——超时未响应者视为「对自动选路不可用」，仍可手动点击
- 探测窗口结束：取延迟最低的可达者；全部失败进入「全灭」界面
- 延迟以 10ms 粒度取整展示

### 页面流程

1. 进入页面 → 立即并行发起探测，列表逐项显示「检测中」
2. 决策完成 → 高亮最优站点，显示倒计时 3s，进度条/数字递减，提供「立即跳转」「取消」
3. 用户点击任意镜像 → 停止倒计时，记入 localStorage（`if-preferred-mirror`），跳转
4. 全部不可达 → 「所有站点暂不可用」卡片：列出全部镜像直链 + 按钮跳转
   `https://github.com/OncoHarmony-Network/ImmunoFusion/issues`
5. 页脚常驻 Issues 链接

### 其他决定

- **移除**现有 meta refresh 与即时 JS 跳转（否则探测无意义）
- 语言：全英文（单语页面；无切换器、无语言探测、无 `if-pref-lang` 键）
- localStorage 记忆上次选择：下次进入时该项加 "Your last choice" 徽标（不作为跳过探测的依据）
- 视觉：科技风暗色主题（网格 + 光晕背景、玻璃拟态卡片、渐变动效、融合主题 SVG 标识），hero 区展示介绍词 "ImmunoFusion is a database for researching RNA-seq–derived fusion calls in cancer"
- 取消：检测阶段提供 "Stop auto-redirect" 按钮；倒计时出现时滚动到视口并聚焦 Cancel，Esc 亦可取消；手动点选任意镜像同样会禁用自动跳转
- 决策后冻结行状态：迟到的探测结果不再改写界面，避免与全灭卡矛盾
- 列表采用行级更新（不重建按钮），探测结果刷新不会吞掉点击或焦点
- 无障碍：`aria-live="polite"` 播报状态变化；Open 按钮带站点名 aria-label；`prefers-reduced-motion` 关闭动画与平滑滚动；键盘可达
- `<noscript>`：隐藏状态卡，静态列出三个镜像 + Issues 链接

## 验证方式

- 抽取页面 `<script>` 做 `node --check` 语法校验
- 本地 `python3 -m http.server` 起服务，浏览器手动走查四种场景：正常选路 / 部分站点失败 / 全部失败 / 取消后手动点击
- 部署后由用户从 GitHub Pages 实际访问确认

## 交付

- 唯一改动文件：`index.html`（重写）
- 是否提交/推送：由用户确认后再执行
