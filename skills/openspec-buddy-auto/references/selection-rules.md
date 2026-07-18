# Full Mode Selection Rules（Full Mode Only）

本参考只描述 Full controller 的内部选择语义，不适用于默认 lite。代理不得直接调用 claim、relationship list 或 selector helper；正常推进只有一个公开入口：

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full
```

Controller 返回 `HANDOFF` 或 `BLOCKED` 后，代理只完成该 interrupt 明确授权的外部工作，再重新运行同一公开命令。Helper 的调用顺序、输入拼装、重试与状态更新均属于 controller 内部实现。

## 候选来源

Full controller 每轮从实时 GitHub 与 active OpenSpec change 重新计算候选。显式 target 限定本轮目标；没有 target 时，只有 goal 状态允许从空上下文选择新工作。既有 controller state 优先于新的环境 seed。

普通开放 Issue 在深入实现或拆分前先进入 full claim。Controller 内部核验：

- Issue 未关闭，也未被其他执行者有效认领；
- 当前 worktree 与绑定分支满足 claim guard；
- 远端 claim branch、Development link、assignee、claim comment 与状态不存在矛盾；
- status 与 issue 类型允许进入 claim；
- 任何部分 Claim 或不一致事实进入恢复或人工处理，不作为普通 ready 候选。

Claim 后的 triage 只消费已经验证的 `.buddy/triage.json` disposition，不在 selection 阶段重新做研究或产品判断：

- `executable`：继续该变更；
- `series-parent`：保持父 Issue 的 claim，创建并关联可独立执行的 children，满足 readiness 后转 tracking；
- `needs-human`：进入人工处理；
- `blocked`：记录依赖或冲突证据；
- `close`：记录明确原因并关闭，不创建重复 change。

## 已准备的 Issue-backed change

Full controller 内部将 active OpenSpec changes、GitHub relationship facts 与可选 current series 交给 full selector。可执行候选至少满足：

```text
local active OpenSpec change exists on the latest configured base
issue metadata parses and maps to the same change_id
openspec_path exists
claim_branch equals change_id
base_branch equals the configured base branch
issue has status:ready and is not a tracking parent
native blockedBy has no open unfinished blocker
no conflicting open PR, remote claim branch, Development link, or claim comment exists
depends_on and coupling constraints are satisfied
```

`status:ready` 与远端 branch、Development link、open PR 或 Claim comment 并存时属于部分 Claim 或状态不一致。Controller 必须进入既有 recovery/needs-human 规则，不能按普通候选继续，也不能由代理直接调用 helper 修补。

## Local-only 候选

Full controller 保留既有 Local-only 识别：active change 明确包含 `no_issue: true`、`noIssue: true`、`issue: false` 或 `coordination: local`。该路径不创建 GitHub Issue、Project、Development link 或 claim branch。

Controller 内部必须保留 `openspec list --json` 的结构化条目，不能在识别 no-issue marker 前退化为 change 名称字符串。Local-only 只在用户显式指定，或没有可执行 Issue-backed change 且 full 状态允许选择时进入。

## 排序与重算

所有可执行 Issue-backed 候选按 Issue 编号升序，选择编号最小者。Current series、downstream blocking、risk 与 coupling 只作为 full 诊断和可执行性事实，不改变编号排序。

Claim 竞态或候选远端事实变化后，controller 重新读取关系并计算候选。旧缓存列表没有选择权；cache 只用于降低读取成本，不能覆盖 claim、dependency 或 availability 的远端真源。

## 停止条件

以下事实必须由 controller 返回 `BLOCKED` 或相应恢复 interrupt，不得让代理绕过公开入口自行选择另一项：

- metadata 与 OpenSpec change 不一致；
- 远端 Claim tuple 部分写入或相互矛盾；
- dependency、series 或 coupling 状态无法确定；
- claim branch 已包含来源不明的提交；
- 同一 change 已存在冲突 PR 或 Development link；
- controller 无法证明当前 worktree 的 claim ownership。
