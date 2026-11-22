# 智能镜像选择页（index.html）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 `index.html`：全球用户访问 GitHub Pages 入口时自动测速选最优镜像跳转，全灭时展示站点列表 + GitHub Issues 引导。

**Architecture:** 单文件零依赖静态页。JS 分为两块：标记注释包裹的纯逻辑块（Node 可单测）+ DOM 接线块。探测用 `fetch(url, {mode:'no-cors'})` 计时竞速；HTTP 镜像永不自动探测。

**Tech Stack:** HTML5 + CSS3 + 原生 JS（ES2020），Node 内置 `node:test` 跑单测，无其他依赖。

**Spec:** `docs/superpowers/specs/2026-11-22-smart-mirror-redirect-design.md`

## Global Constraints

- 单文件自包含，零 CDN/构建步骤；唯一改动源文件：`index.html`
- 站点清单（硬编码）：
  - `zhoulab` → `https://shiny.zhoulab.ac.cn/ImmunoFusion/`（auto: true）
  - `lisom` → `https://lisom.work/shinyapps/ImmunoFusion/`（auto: true）
  - `biotree` → `http://biotree.top:38124/ImmunoFusion/`（auto: false，仅手动；HTTP 混合内容不可探测）
- 常量：`DECISION_DEADLINE_MS = 3500`，`PROBE_TIMEOUT_MS = 5000`，`COUNTDOWN_SECONDS = 3`
- localStorage 键：`if-preferred-mirror`（手动选择记忆）
- 必须移除现有 `<meta http-equiv="refresh">` 和即时 `location.replace` 跳转
- Issues 地址：`https://github.com/OncoHarmony-Network/ImmunoFusion/issues`
- 语言：全英文（用户指示 2026-11-22，实现期间提出；无双语切换）
- 提交规则：用户未要求前不 commit

## Review Focus

1. **HTTP 镜像绝不参与自动选路**——即使未来有人把 `auto` 改成探测逻辑，biotree 也不得被自动选中（代码评审重点）。
2. **单站探测异常不得拖垮整体**——某镜像 fetch 抛 TypeError（DNS 失败/被墙）时其余镜像照常出结果。
3. **取消倒计时要彻底**——点击「取消」后不得再发生任何跳转（含 interval 清理）。
4. **no-cors  opaque 的局限**——主机存活但应用 404 会被判为「可达」；在代码注释中说明此局限。
5. **无 JS 降级**——`<noscript>` 内含全部镜像直链 + Issues 链接。

---

### Task 1: 纯逻辑单元测试（RED）

**Files:**
- Create: `tests/selector-logic.test.mjs`

**Interfaces:**
- Consumes: `index.html` 中 `// ==PURE-BEGIN==` 与 `// ==PURE-END==` 标记之间的代码块
- Produces: 被测函数签名（Task 2 必须实现）：
  - `summarizeResults(results: Array<{id: string, ok: boolean, latencyMs: number|null}>) -> { best: {id, latencyMs} | null, reachable: Array, unreachable: Array }` — reachable 按延迟升序；best = reachable[0]；同延迟按输入顺序取先者；全部失败 best = null
  - `formatLatency(ms: number) -> string` — 10ms 粒度取整：5→"10 ms"，87→"90 ms"，123→"120 ms"；最小展示 10 ms
  - `withTimeout(promise: Promise, ms: number) -> Promise<{status: 'settled', value} | {status: 'timeout'}>` — 不 reject

- [ ] **Step 1: 写失败测试**

`tests/selector-logic.test.mjs`：用 `node:fs` 读 `index.html`，正则提取 PURE 块，`new Function(block + "\nreturn { summarizeResults, formatLatency, withTimeout };")()` 注入。用 `node:test` + `node:assert` 覆盖：
- `summarizeResults`：空数组 → best null；全失败 → best null；混合 → ok 中延迟最低者；并列延迟取先出现者；返回的 reachable 按延迟升序
- `formatLatency`：5→`"10 ms"`、87→`"90 ms"`、123→`"120 ms"`
- `withTimeout`：立即 resolve 的 promise → `{status:'settled', value}`；20ms 内不 resolve → `{status:'timeout'}`

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/`
Expected: FAIL（当前 index.html 无 PURE 标记 / 函数未定义）

### Task 2: 重写 index.html（GREEN）

**Files:**
- Modify: `index.html`（整体重写）

**Interfaces:**
- Consumes: Task 1 的测试与上述函数签名
- Produces: 完整的入口页面，含：
  - PURE 块：`summarizeResults`、`formatLatency`、`withTimeout`、`finalizeResults`（签名如上）
  - 接线块：`MIRRORS` 常量（见 Global Constraints）、`probeMirror(m)`（fetch+计时，同步异常与异步失败均返回 `{id, ok:false}`）、`runSelection()`（并发探测 + `DECISION_DEADLINE_MS` 决策截止 → `finalizeResults`/`summarizeResults` → 渲染/倒计时/全灭分支）、倒计时 interval（可取消）、`localStorage` 读写、英文 `STRINGS` 文案、DOM 构建与行级更新函数
  - 页面结构：logo → 状态卡（镜像行：名称/状态徽标/延迟 + Stop auto-redirect）→ 倒计时控制区（数字 + Go now/Cancel）→ 全灭卡（站点列表 + Issues 按钮）→ 页脚（Issues 常驻链接）
  - `<noscript>` 静态降级块；`aria-live="polite"` 状态播报；`prefers-reduced-motion` 关动画

- [ ] **Step 1: 实现页面**

按 Interfaces 写完整 `index.html`。要点：
- 探测：`performance.now()` 包裹 `fetch(m.url, {mode:'no-cors', cache:'no-store'})`；`Promise.all` + `withTimeout(p, PROBE_TIMEOUT_MS)`；`setTimeout(DECISION_DEADLINE_MS)` 决策截止 + `finalizeResults`，超时未到者按「不可用(超时)」渲染但仍可手动点击；决策后 `state.decided` 冻结迟到结果
- 每镜像状态机：checking → ok(latency) / failed；行级更新（不重建按钮），行内按钮随时可点（探测中也允许手动跳转，且会禁用自动跳转）
- 倒计时：3s 数字递减 + 进度条（先挂 transition 再改宽度），`location.replace(best.url)`；滚动到视口并聚焦 Cancel；取消/手动点击清理 interval；Esc 可取消
- 全灭分支：显示 `#all-fail` 卡（hidden 切换），列表含 biotree 及「HTTP 无法自动检测」说明；文案说明慢速连接可能只是需要更久
- 文案：内置英文 `STRINGS`（全英文，无 i18n 框架）；`if-preferred-mirror` 命中的行加 "Your last choice" 徽标
- 代码注释说明 no-cors 局限（主机 404 仍判可达）

- [ ] **Step 2: 运行测试确认通过**

Run: `node --test tests/`
Expected: PASS（全部用例）

### Task 3: 冒烟验证

**Files:**
- 无新文件（命令行验证）

- [ ] **Step 1: JS 语法检查**

Run: `sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d' > /tmp/if-app.js && node --check /tmp/if-app.js`
Expected: 无语法错误输出

- [ ] **Step 2: 本地起服务 + curl 冒烟**

Run: `python3 -m http.server 8123 --directory . &` 然后：
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:8123/index.html` → 200
- `curl -s http://localhost:8123/index.html | grep -c "biotree.top:38124"` ≥ 1
- `curl -s http://localhost:8123/index.html | grep -c "OncoHarmony-Network/ImmunoFusion/issues"` ≥ 2（全灭卡 + 页脚）
- `curl -s http://localhost:8123/index.html | grep -c "http-equiv=\"refresh\""` = 0
- `curl -s http://localhost:8123/index.html | grep -c "<noscript>"` = 1
- `kill %1`

- [ ] **Step 3: 人工走查清单交付**

输出四种场景的浏览器手动验证清单（正常选路 / 部分失败 / 全灭 / 取消后手动点选），留给用户部署后实测。

### Task 4: 代码评审与收尾

**Files:**
- Modify: `index.html`（按评审意见）

- [ ] **Step 1: 评审**

用 code-review 技能评审当前改动（重点：Review Focus 五问、英文文案完整性、倒计时清理、探测异常隔离、取消/手动点选竞态）。

- [ ] **Step 2: 修复 HIGH 及以上问题并复跑 `node --test tests/`**

Expected: PASS

- [ ] **Step 3: 汇报**

向用户汇报改动摘要、测试结果、部署后人工验证清单；询问是否 commit + push。
