---
id: P-011
title: Design Page shadcn-first 设计系统工厂实施路线图
description: >
  将 Design Page 从已完成 MVP 的 DesignBuild Run 推进到 shadcn-first 设计系统工厂：
  覆盖 skill 上下文、registry 召回、源码物化、validator、theme pack、视觉评审、组件编辑闭环与 PDF/PPTX/ZIP export。
category: roadmap
created: 2026-05-24
updated: 2026-05-24
tags:
  - design-page
  - design-build
  - roadmap
  - shadcn
  - design-system
  - theme-pack
  - visual-review
  - export
status: wip
sources:
  - title: shadcn/ui CLI
    url: https://ui.shadcn.com/docs/cli
  - title: shadcn/ui MCP
    url: https://ui.shadcn.com/docs/mcp
  - title: shadcn/ui Theming
    url: https://ui.shadcn.com/docs/theming
  - title: nexu-io/open-design
    url: https://github.com/nexu-io/open-design
references:
  - id: A-015
    rel: derived-from
    file: ../architecture/20260524-design-page-shadcn-design-system-factory-architecture.md
  - id: A-014
    rel: extends
    file: ../architecture/20260524-design-build-standalone-project-output-contract.md
  - id: P-008
    rel: extends
    file: ./20260521-design-page-agent-generation-implementation-plan.md
  - id: P-009
    rel: extends
    file: ./20260521-design-page-preview-editor-handoff.md
---

# Design Page shadcn-first 设计系统工厂实施路线图

> 本文是 [A-015](../architecture/20260524-design-page-shadcn-design-system-factory-architecture.md) 的实施路线图。
> 目标是把 Design Page 从 “DesignBuild MVP + Sandpacker preview” 推进到可召回、可验证、可编辑、可导出、可复盘的 shadcn-first design artifact factory。

## 来源

- [shadcn/ui CLI](https://ui.shadcn.com/docs/cli)
- [shadcn/ui MCP](https://ui.shadcn.com/docs/mcp)
- [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- [nexu-io/open-design](https://github.com/nexu-io/open-design)

## 1. 决策摘要

优先押注：

- **DesignSystemPolicy**：它是后续 shadcn、theme、validator、export 的共同输入。没有 policy，所有约束都会散落在 prompt 和 reviewer 里。
- **Registry Retrieval + Materializer**：召回和源码物化要先于“更聪明的模型 prompt”。模型不应凭记忆写 shadcn。
- **Deterministic Validator**：先让结构可验证，再谈视觉还原。validator 是 repair loop 的稳定输入。
- **ThemePack**：风格必须资源化，否则每次生成都会漂移。

谨慎推进：

- **社区 registry marketplace**：价值高，但要有 trust / license / dependency policy 后再默认启用。
- **PPTX semantic export**：比 PDF/HTML ZIP 复杂，应先做 screenshot-based deck MVP，再做可编辑语义 deck。
- **视觉审美自动评审**：先覆盖 blank/overflow/overlap/mobile breakage，再逐步增加审美判断。

明确不做：

- 不把 Design Page 改成通用 workflow DSL。
- 不让 generated project 依赖 Telegraph workspace-only import。
- 不让 PDF/PPTX 从 prompt 重新生成一份无 lineage 的新内容。
- 不在 main/renderer 中执行 runtime、registry CLI 或外部 agent。

## 2. 技术地图

```text
Quadrant A: Policy & Context
  DesignSystemPolicy / Skill Injection / ThemePack / Project Context

Quadrant B: Retrieval & Materialization
  shadcn CLI/MCP / Registry Index / ComponentRetrievalLedger / Source Vendoring

Quadrant C: Artifact & Validation
  Standalone Project Contract / Dependency Closure / Provenance / Visual Review / Repair

Quadrant D: Editing & Export
  Preview DOM Selection / Style Edit / Revision Graph / PDF / PPTX / ZIP
```

推进顺序：

```text
Context -> Retrieval -> Materialization -> Validation -> Theme -> Visual Review -> Editing -> Export -> Marketplace
```

理由：

- Context 和 policy 先统一语言，避免后续每个 worker 各自理解“shadcn-first”。
- Retrieval 和 materialization 先给模型事实，减少幻觉组件。
- Validation 先把失败变成结构化检查项，repair 才有可靠输入。
- Theme 和 visual review 解决还原度。
- Editing 和 export 依赖 artifact lineage 与 source map，不能先做。

## 3. 能力价值评估

| 能力 | 价值 | 复杂度 | 优先级 | 结论 |
|---|---:|---:|---:|---|
| `DesignSystemPolicy` | 极高 | 中 | P0 | 先做，作为所有后续能力的共同 contract |
| Skill 上下文注入 | 高 | 低 | P0 | 已落地基础，继续扩展 skill selection |
| shadcn registry search/view | 极高 | 中 | P0 | 直接提升召回率，降低模型凭空写组件 |
| Registry source materializer | 极高 | 高 | P0 | shadcn-first 的关键工程能力 |
| Dependency closure validator | 高 | 中 | P0 | 解决 Sandpacker 编译晚暴露问题 |
| ThemePack registry | 高 | 中 | P1 | 控制风格一致性与可复用风格素材 |
| VisualReviewWorker | 高 | 高 | P1 | 提升还原度，先做硬错误检查 |
| Component edit context | 高 | 中 | P1 | 让“点选后修改”从产品 Demo 变成闭环 |
| PDF export | 中高 | 中 | P2 | 可先基于 browser print 落地 |
| PPTX export | 高 | 高 | P2 | 先 screenshot deck，后 semantic deck |
| Community registry marketplace | 中高 | 高 | P3 | 需要信任、license、版本治理 |

## 4. 追踪总表

| Phase | 状态 | 目标 | 主要产物 | 验收证据 |
|---|---|---|---|---|
| 0 | completed | Skill 上下文最后一公里 | selected skill body formatter + DesignBuild child prompt 注入 | 相关单测、package tests、workspace typecheck |
| 1 | completed | DesignSystemPolicy MVP | policy contract + settings/context 注入 | trace 中可见 policy，worker/reviewer 共用 |
| 2 | completed | shadcn registry retrieval | indexer/scout ledger | 输入 login/dashboard/settings 能召回官方组件/block |
| 3 | completed | source materialization | vendored shadcn files + provenance | generated project 不依赖 workspace UI 且可预览 |
| 4 | completed | validator 扩展 | shadcn/deps/alias/token checks | repair input 有结构化 failed check id |
| 5 | completed | ThemePack MVP | theme pack registry + CSS variable output | 同 prompt 不同 theme 产生稳定差异 |
| 6 | completed | visual review | screenshot + layout checks | blank/overflow/overlap/mobile breakage 可阻断 |
| 7 | completed | component edit loop | selected component + dirty state + local repair | 点选按钮后局部修改，不重写整页 |
| 8 | completed | export pipeline | PDF / ZIP / PPTX MVP | export artifact 关联 source artifact |
| 9 | completed | marketplace / corpus | registry trust + replay fixture | 成功 artifact 可回放和回归 |

## Phase 0：Skill 上下文最后一公里

目标：让 agent profile 中已有的 `inheritSkills` / `skills` 字段真正进入模型上下文，特别是 DesignBuild child runner。

状态：截至 2026-05-24 已完成基础实现。

已完成：

- [x] 新增 selected skill body formatter：`packages/agent/src/skills/prompt.ts`。
- [x] `packages/agent/src/skills/index.ts` 导出 formatter 与 skill root resolver。
- [x] 通用 `StreamingSubagentRunner` 消费 `inheritSkills` 与 `skills`。
- [x] `SubagentManager` / orchestrator 透传 `skills` 字段。
- [x] DesignBuild `DesignBuildChildProfile` 保留 `inheritSkills` / `skills`。
- [x] `DesignBuildChildRunner` 将 profile selected skills 内联到 child system prompt。
- [x] 新增 `skills/design-shadcn-generation/SKILL.md`。
- [x] `design-component-scout` / `design-worker` / `design-reviewer` 绑定 `skills: design-shadcn-generation`。

验收：

- `pnpm --filter @telegraph/agent test` 通过。
- `pnpm --filter @telegraph/design test` 通过。
- `pnpm --filter @telegraph/extension-telegraph-subagents test` 通过。
- `pnpm -r typecheck` 通过。

No-Go：

- 不把 skill body 直接硬编码进 DesignBuild prompt。
- 不让 DesignBuild child 在只有 submit tool 的情况下再依赖 read skill 文件。

## Phase 1：DesignSystemPolicy MVP

目标：把 shadcn-first、standalone-preview、dependency/token/alias policy 建成 DesignBuild 的一等输入。

交付：

- [x] 新增 `apps/design/src/application/common/design-system-contract.ts`。
- [x] 定义 `DesignSystemPolicy`、`DesignRegistryRef`、`ThemePackRef`、`DesignExportPolicy`。
- [x] 在 `DesignBuildContextSnapshot` 中加入 `designSystem` 字段。
- [x] DesignBuild workflow 在 Context Assembly 阶段输出 resolved policy。
- [x] `DesignBuildChildRunner` 的 `modelInput` 注入 policy。
- [x] `DesignBuildReviewPolicy` 接收 policy 并将 check id 命名空间化。

验收：

- trace 的 Context Assembly step 可看到 policy id、mode、allowed registries、handwrite policy。
- worker/reviewer child modelInput 都能读取同一 policy。
- 未配置时默认 policy 为 `shadcn-first-standalone`。

No-Go：

- 不在 renderer 临时拼 policy。
- 不把 policy 仅作为字符串 prompt；必须是结构化对象。
- 不支持 workspace apply 与 standalone preview 混用 import 规则。

## Phase 2：shadcn Registry Retrieval

目标：让 Component Retrieval 阶段从“静态 workspace UI 列表”升级为“shadcn registry evidence-first retrieval”。

交付：

- [x] 新增 `ShadcnRegistryIndexer`。
- [x] 支持调用 `shadcn search` 获取 official registry candidates。
- [x] 支持 `shadcn docs <component> --json` 获取 docs/examples metadata。
- [x] 支持 `shadcn view <item>` 获取 registry item JSON。
- [x] 新增 `ComponentRetrievalLedger` 类型与 artifact/trace 投影。
- [x] `Design Component Scout` 输出 selected/rejected/fallbacks，而不是只输出组件列表。
- [x] 给 login / dashboard / settings / pricing / landing 五类 prompt 加 retrieval fixture。

验收：

- “登录页”召回 login block、button、input、card。
- “设置页”召回 tabs、switch/input/button。
- “dashboard”召回 card、table、badge、chart/sidebar 候选。
- 每个 selected item 有 registry、name、type、reason、dependencies/files。
- fallback 必须有 reason，不能空白允许手写。

No-Go：

- 不默认启用任意社区 registry。
- 不让模型凭自然语言声称“已使用 shadcn”，必须有 ledger。
- 不在 offline / CLI unavailable 时静默降级为自由手写；要显示 degraded retrieval。

## Phase 3：Registry Source Materialization

目标：把 retrieval selected items 物化为 generated standalone project 的本地文件与依赖。

交付：

- [x] 新增 `ShadcnRegistryMaterializer`。
- [x] 生成 `src/components/ui/*`、`src/lib/utils.ts`、`components.json`。
- [x] 合并 registry item `dependencies` / `devDependencies` 到 `package.json`。
- [x] 输出 `vite.config.ts` / `tsconfig.json` alias。
- [x] 输出 `design-system.provenance.json`。
- [x] `DesignBuildArtifacts` fallback scaffold 改为 shadcn-compatible scaffold。
- [x] `DesignSandpackerPreview` 不再依赖 Telegraph UI stub 作为主要路径；stub 仅作 legacy compatibility。

验收：

- generated project 只用 local shadcn source 或 declared npm deps。
- `@/components/ui/button` 能在 Sandpacker 中解析。
- 删除 Telegraph UI stub 后，shadcn-first artifact 仍能预览。
- provenance 能说明每个 UI primitive 来源。

No-Go：

- 不在 generated project 中 import `@/packages/ui/...`。
- 不把 registry item 写入 repo 根 `packages/ui`，除非用户明确执行 workspace apply。
- 不让 materializer 覆盖模型生成的 app-specific 文件。

## Phase 4：Validator 扩展与 Repair

目标：把 shadcn-first 从“要求”变成硬门禁。

交付：

- [x] `standalone-external-dependencies`：源码 import 外部包必须声明依赖。
- [x] `standalone-alias-config`：使用 `@/` 必须有 alias config。
- [x] `standalone-shadcn-components-json`。
- [x] `standalone-shadcn-local-files`。
- [x] `standalone-shadcn-provenance`。
- [x] `standalone-no-fake-primitives`。
- [x] `standalone-cn-helper`。
- [x] `standalone-radix-deps`。
- [x] `standalone-theme-tokens-present`。
- [x] `standalone-no-raw-colors`。
- [x] repair prompt 输入 failed check id + repair hint。

验收：

- 漏 `src/lib/utils.ts` 会被 checker 拦截。
- 漏 Radix / CVA / clsx deps 会被 checker 拦截。
- 手写 fake Button primitive 会被 reviewer 或 validator 标记。
- repair 后最多一轮能补齐常见缺文件/缺依赖。

No-Go：

- 不等 Sandpacker compile error 才发现结构错误。
- 不让 reviewer 自由描述问题却不输出 check id。
- 不无限 repair。

## Phase 5：ThemePack MVP

目标：将“风格要求”变成可选择、可复用、可验证的 ThemePack。

交付：

- [x] 新增 `ThemePackRegistry`。
- [x] 定义 `ThemePack` schema。
- [x] 首批 pack：`shadcn-new-york-neutral`、`dense-operator-console`、`editorial-commerce`、`studio-dark`。
- [x] Design Entry / Settings 提供 theme pack 选择。
- [x] Generated project 输出 CSS variables 与 theme metadata。
- [x] reviewer 增加 theme pack checks。

验收：

- 同一 prompt 选择不同 theme pack，首屏视觉差异稳定且可解释。
- theme token 出现在 `src/styles.css`。
- raw color 限制生效。
- reviewer 能指出“违反 dense SaaS / editorial / dark studio”的具体 check。

No-Go：

- 不把 theme pack 做成一段自由 prompt。
- 不用 SVG/gradient blob 伪装风格。
- 不让 theme pack 改变基础 artifact contract。

## Phase 6：VisualReviewWorker

目标：把“能跑”升级为“明显视觉错误可阻断”。

交付：

- [x] 建立 preview screenshot worker。
- [x] desktop / mobile 两个 viewport。
- [x] blank canvas / nonblank check。
- [x] horizontal overflow check。
- [x] text clipping / button clipping check。
- [x] element overlap heuristic。
- [x] compile/runtime error 面板进入 review report。
- [x] visual review report 写入 run trace。

验收：

- 空白 iframe 被判定失败。
- mobile 横向溢出被判定失败。
- button 文本被裁切被判定失败。
- visual failure 能触发 repair pass。

No-Go：

- 不在第一版做复杂审美评分。
- 不把视觉报告只放 console，必须进 trace/artifact metadata。
- 不让视觉 worker 阻塞关键 run lifecycle 事件。

## Phase 7：Component Edit Loop

目标：实现“选中 preview 元素后局部修改”的稳定闭环。

交付：

- [x] `ComponentEditContext` 类型。
- [x] dirty operations state。
- [x] selection source location 与 provenance 绑定。
- [x] Style editor / Inspector 修改统一转成 patch operations。
- [x] DesignBuild revision context 区分 natural-language diff 与 component-edit diff。
- [x] reviewer 增加 primitive edit / composition edit 检查。

验收：

- 用户点中按钮后说“改成绿色并放大”，只修改相关 usage/composition。
- 修改 shadcn primitive instance 不直接改 `src/components/ui/button.tsx`。
- dirty source 能进入下一轮 modelInput。
- artifact revision 不覆盖旧 artifact。

No-Go：

- 不直接写 workspace 文件。
- 不把选中元素只作为自然语言 label，必须有 artifact/source context。
- 不让 style editor 看到变更但 artifact operations 不更新。

## Phase 8：Export Pipeline

目标：让 generated artifact 可导出为 PDF、PPTX、ZIP/HTML，并保留 lineage。

交付：

- [x] `DesignExportArtifact` contract。
- [x] `DesignExportPipeline` service。
- [x] HTML ZIP export：project source / manifest。
- [x] PDF export MVP。
- [x] PPTX export MVP。
- [x] Export panel 展示状态与文件。
- [x] export artifacts 关联 sourceArtifactId。

验收：

- 用户可从当前 artifact 导出 HTML ZIP。
- 用户可从当前 artifact 导出 PDF。
- 用户可生成基础 PPTX，每个主要 section 一页。
- export artifact 记录 theme pack 与 source artifact。

No-Go：

- 不用 prompt 重新生成 PDF/PPTX 内容。
- 不让 export 丢失 provenance。
- PPTX MVP 不承诺完全语义可编辑。

## Phase 9：Community Registry 与 Regression Corpus

目标：开放更多组件素材，同时保持信任与回归质量。

交付：

- [x] Registry allowlist / blocklist。
- [x] Community registry metadata：license、trust level、last checked。
- [x] dependency policy 与 version pinning。
- [x] successful generated project fixture corpus。
- [x] replay/regression command。
- [x] retrieval quality metrics：hit rate、fallback rate、repair rate、visual failure rate。

验收：

- 未 allowlist 的 registry 不会被默认使用。
- 成功 artifact 可 replay。
- shadcn-first 规则调整后能跑 corpus 回归。
- fallback rate 可被追踪。

No-Go：

- 不把社区 registry 当成无条件可信源码。
- 不把 regression corpus 变成大文件垃圾场。
- 不把指标只放日志，不进入 run history 或开发者可读报告。

## 5. 后续 TODO 清单

### Policy / Contract

- [x] 定义 `DesignSystemPolicy`。
- [x] 定义 `ComponentRetrievalLedger`。
- [x] 定义 `ThemePack`。
- [x] 定义 `DesignExportArtifact`。
- [x] 将 policy / ledger / theme metadata 纳入 artifact output。
- [x] 将 export metadata 纳入 artifact output。

### shadcn

- [x] 封装 `shadcn search/docs/view`。
- [ ] 支持 shadcn MCP 作为可选 retrieval backend。
- [x] materialize official registry items。
- [x] 处理 registry item dependency merge。
- [x] 生成 `components.json` / aliases。

### Theme

- [x] 首批 theme packs。
- [x] Theme selector UI。
- [x] Theme reviewer checks。
- [x] Raw color scanner。

### Preview / Review

- [ ] packaged Electron preview smoke。
- [x] visual screenshot worker。
- [x] mobile viewport review。
- [x] compile/runtime error report 进入 trace。

### Editing

- [x] source location mapping。
- [x] dirty state。
- [x] Inspector form。
- [ ] edit-to-patch conflict handling。

### Export

- [x] HTML ZIP。
- [x] PDF。
- [x] screenshot PPTX。
- [ ] semantic PPTX spike。

## 6. Repo 落点建议

```text
apps/design/src/application/common/
  design-system-contract.ts
  design-export-contract.ts

apps/design/src/application/node/design-build/
  DesignSystemPolicy.ts
  ComponentRetrievalLedger.ts
  ShadcnRegistryIndexer.ts
  ShadcnRegistryMaterializer.ts
  ThemePackRegistry.ts
  VisualReviewWorker.ts
  DesignExportPipeline.ts

apps/design/src/application/browser/
  DesignSystemPanel.tsx
  DesignRetrievalPanel.tsx
  DesignExportPanel.tsx

skills/
  design-shadcn-generation/
  design-theme-<pack>/
  design-export-deck/
```

## 7. 风险清单

| 风险 | 表现 | 缓解 |
|---|---|---|
| shadcn CLI/MCP 不可用 | retrieval 阶段降级，模型自由手写 | 加 registry cache 与 degraded state，不静默降级 |
| registry item 依赖漂移 | Sandpacker 编译失败 | dependency pinning + closure validator |
| community registry 不可信 | 引入不合规源码或依赖 | allowlist、license metadata、manual approval |
| theme pack 过度 prompt 化 | 风格不稳定 | token + reviewer checks + examples/anti-patterns |
| visual review 成本高 | run 变慢 | 先异步或分级；关键 lifecycle 不被阻塞 |
| PPTX 还原度差 | 导出像截图拼贴或内容丢失 | MVP 明确 screenshot deck；V2 再 semantic deck |
| generated project 文件过多 | Sandpacker 卡顿 | file count/source size cap + materializer prune |
| workspace apply 与 standalone preview 混淆 | import 规则冲突 | policy.mode 严格区分 |

## 8. 第一批 PR 建议

1. **PR-1：DesignSystemPolicy contract**
   - 新增 common contract。
   - Context Assembly 输出 policy。
   - reviewer/modelInput 透传。

2. **PR-2：ComponentRetrievalLedger + shadcn CLI indexer**
   - 封装 search/docs/view。
   - scout 输出 ledger。
   - trace 展示 selected/rejected/fallback。

3. **PR-3：ShadcnRegistryMaterializer MVP**
   - materialize button/card/input/tabs/badge/table。
   - 输出 local files、deps、components.json、aliases。
   - Sandpacker preview 通过。

4. **PR-4：shadcn validator checks**
   - local files、deps、alias、cn helper、provenance。
   - repair hint。

5. **PR-5：ThemePack MVP**
   - 首批 packs。
   - generated styles.css tokens。
   - raw color scanner。

6. **PR-6：Visual smoke worker**
   - desktop/mobile screenshots。
   - blank/overflow/overlap。
   - visual report in trace。

7. **PR-7：Export artifact MVP**
   - HTML ZIP + PDF。
   - sourceArtifactId lineage。

## 9. 长期判断

- Design Page 的长期价值在于可解释设计生产线，而不是单次生成能力。
- shadcn-first 是第一套默认 DesignSystemPack，未来可替换为企业 UI kit。
- ThemePack 是风格一致性的关键资产，比单句 prompt 重要。
- ComponentRetrievalLedger 是提高召回率与还原度的抓手，也是后续评测指标来源。
- PDF/PPTX/ZIP export 必须消费同一 artifact lineage，否则产品会变成多个不一致的生成器。
- successful generated projects 应变成 regression corpus，持续逼近“稳定还原”。
