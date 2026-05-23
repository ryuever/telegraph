# Roadmap Checklist Style

用于生成 `codebase-wiki/roadmap/` 下的清单式实施路线图。目标是让 roadmap 既有战略判断，也能直接拆成 PR、验收与后续追踪。

## 触发场景

- 用户说“roadmap / 路线图 / 实施计划 / 分阶段计划 / 优先级 / TODO 清单”。
- 文档分类为 `roadmap`，编号使用 `P-xxx`。
- 需要把架构、讨论或现状差距落到可执行阶段。

## 核心写法

- 先决策，后展开。不要一上来铺任务。
- 每个任务都要能被验证；无法验证的内容写成判断或风险，不写成 checkbox。
- 使用绝对日期描述状态，例如“截至 2026-05-22 已完成...”，避免“今天/目前”漂移。
- `[x]` 只表示已经落地且被确认；`[ ]` 表示未来工作；部分完成写在 `状态` 段。
- 每个 Phase 都写 `验收` 与 `No-Go`。No-Go 用来防止范围膨胀和架构边界滑坡。
- 表格负责比较，checkbox 负责执行，段落负责解释取舍。

## 推荐结构

````markdown
# <主题>能力象限与实施路线图

> 本文是 <来源架构/讨论> 的实施路线图。
> 目标是 <一句话目标>。

## 1. 决策摘要

优先押注：

- `<核心地基能力>`：为什么必须先做。
- `<最快闭环>`：为什么优先级高。

谨慎推进：

- `<高价值但复杂能力>`：放到什么前置条件之后。

明确不做：

- `<边界红线>`。

## 2. 技术象限

```text
Quadrant A: Entry Surfaces
  CLI / Mobile / Webhook / MCP

Quadrant B: Runtime Core
  Ledger / Broker / Event / Approval / Trace

Quadrant C: Execution Layer
  API / Browser DOM / Accessibility / Vision / Raw Input

Quadrant D: Trust & Ops
  Identity / Policy / Audit / Relay / Sandbox / Metrics
```

推进顺序：

```text
Foundation -> Projection -> First Entry -> Approval -> Execution -> Governance
```

理由：说明为什么这个顺序能降低风险。

## 3. 能力价值评估

| 能力 | 价值 | 复杂度 | 优先级 | 结论 |
|------|------|--------|--------|------|
| <能力> | 极高/高/中 | 低/中/高 | P0/P1/P2 | <一句话判断> |

## 4. 分阶段路线

### Phase 0：<阶段名>

目标：<这一阶段唯一目标>。

状态：截至 YYYY-MM-DD，<已完成/待完成/已部分落地的事实>。

交付：

- [ ] <可验证交付物>
- [x] <已完成交付物>

验收：

- <可观察验收标准>
- <失败后能定位的标准>

No-Go：

- <本阶段不做什么>
- <禁止绕开的架构/安全边界>

## 5. 后续 TODO 清单

### <领域 A>

- [ ] <待办>
- [ ] <待办>

### <领域 B>

- [ ] <待办>

## 6. Repo 落点建议

```text
packages/<name>/
  src/<module>.ts

apps/<app>/
  src/services/<service>/
```

## 7. 风险清单

| 风险 | 表现 | 缓解 |
|------|------|------|
| <风险> | <怎么暴露> | <怎么降低概率或损害> |

## 8. 第一批 PR 建议

1. <最小地基 PR>
2. <第一个可用闭环>
3. <可观测性/验收 PR>

## 9. 长期判断

用 3-7 条 bullet 收束：真正值得投入的护城河、边界或产品判断。
````

## 轻量版

当用户只要短计划，不需要完整文档时，可压缩为：

1. `决策摘要`
2. `Phase 0-N`，每个 Phase 只保留目标、交付、验收、No-Go
3. `风险与第一批 PR`

不要删掉验收、No-Go、风险，这三项是路线图的安全栏杆。

## 开源社区可借鉴范式

- GitHub Markdown task lists：适合直接表达可勾选任务，并能在 GitHub issue/PR 中展示进度；写 wiki roadmap 时保留 `- [ ]` / `- [x]` 语法即可。参考：https://docs.github.com/articles/about-task-lists
- GitLab Tasks / work items：适合把大 issue 拆成可独立追踪的任务；wiki roadmap 中可先用分组 TODO 表达，真正进入执行时再迁移到 issue/task 系统。参考：https://docs.gitlab.com/ee/user/tasks.html
- Keep a Changelog：强调面向人阅读、按含义分组、保留 `Unreleased` 区域。roadmap 更新时可借鉴其做法：把“已完成/变更/移除/风险”分组写清，而不是倾倒 commit log。参考：https://keepachangelog.com/en/1.1.0/

## 质量检查

- 是否能从“决策摘要”看出真正优先级？
- 每个 Phase 是否有目标、交付、验收、No-Go？
- checkbox 是否都是可验证交付，而不是愿望？
- 是否有明确“不做什么”？
- 是否给出第一批 PR 或 repo 落点？
- 风险是否可操作，而不是泛泛提醒？
- 若从旧架构文档派生，frontmatter `references` 是否建立双向引用？
