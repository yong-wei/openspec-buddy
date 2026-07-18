---
name: openspec-buddy-auto
description: Use when the user asks GPT-5.6 to process GitHub Issue-backed or explicitly targeted Local-only OpenSpec changes through implementation, review, delivery, archive, and completion.
compatibility: Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and foreground access to live PR review facts.
---

# OpenSpec Buddy Auto

OpenSpec Buddy Auto 默认采用 Lightweight Mode（lite）。GPT-5.6 主模型依据实时 GitHub 与 OpenSpec 事实完成实现、审核、交付和收尾；确定性脚本只保护共享认领事实。现有 controller、lane、cache、receipt 与复杂恢复能力保留在显式 Full Mode。

将 `<openspec-buddy-auto-skill-dir>` 解析为本 `SKILL.md` 所在目录，不得把占位符原样传给 shell。

## 公开入口

`scripts/buddy-auto.mjs` default 行为是 lite。每次开始选择或恢复目标时调用一次：

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --issue <number>
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --change <change_id>
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --change <change_id> --no-pr
```

公开入口内部只使用三个确定性协调脚本，代理不得把它们组合成另一套工作流：

1. `scripts/lite/select-available-issue.mjs`
2. `scripts/lite/claim-issue.mjs`
3. `scripts/lite/set-issue-status.sh`

入口返回单个无持久状态的工作上下文：`claimed`、`current_claim`、`local_only` 或 `exhausted`。它不执行实现、review、merge 或 Issue 收尾。

无目标执行选择编号最小的 Available Issue。Issue 必须开放、仅带 `status:ready`、显式映射到存在的本地 OpenSpec change，且没有开放的 GitHub 原生 `blockedBy` 关系；本地 change 缺失时立即停止，不跳到其他 Issue。选择不读取 Project、series、risk、mode、coupling、`depends_on` 或 Buddy cache。

`--issue` 与 `--change` 都是单目标。`--change` 恰好映射一个开放 Issue 时仍走 Issue-backed 协调；只有完全没有映射 Issue 才是 Local-only。多个映射、仅有 closed 映射、外部 Claim 或部分 Claim 均停止，不接管、不修复、不回滚。Local-only 必须提醒用户该 change 未登记 Issue。

## 实施与 Local Review

取得工作上下文后，GPT-5.6 主模型自主完成 change 中全部任务和相关测试，不受 full controller 生命周期约束。提交前必须检查完整 diff，确认实现完整、没有越出 change 范围、相关测试通过，并完成 Local Review。只有用户已经授权子代理且主模型按风险认为必要时，才增加独立审核；简单变更不强制子代理。

Issue-backed change 可在实现开始与进入 review 时，分别通过公开入口所列 status 脚本记录 `status:in-progress` 和 `status:in-review`。这些标签只供人检查，不是状态机。

完成实现后必须执行：

```bash
openspec validate <change_id> --strict
openspec archive <change_id> --yes
```

实现、测试、同步后的主 specs 与 archive 必须处于 same PR delivery unit；Local-only `--no-pr` 也必须把它们放在同一交付单元。归档不形成独立生命周期阶段。

## PR 交付

Issue-backed 与 Local-only 默认都走 PR。Local-only 默认 PR 不执行 Claim、Issue status 或 Issue 收尾；成功合并后结束该显式目标。

最终提交推送后，在 PR 发布固定 Review Request：

```text
@codex review 中文回复，即使没有重大问题也必须给出显式回复
```

立即重读 PR，确认评论存在并保留 URL。同一 latest head 已有该请求时不重复发布；feedback 的无代码变化复审与 Timeout Retry 是有明确理由的例外。lite 不读取 `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`。

## Review Window

每个 Review Window 的等待节奏固定为 300 秒后首次检查、此后每 60 秒检查一次、从请求起累计 900 秒结束。检查实时 latest head、Codex 回复与 review threads，不用本地状态代替远端评论顺序。

首个窗口完全没有 Codex 响应时，在边界处最后重读一次远端事实；仍无响应才发布 one Timeout Retry，并在顶层评论明确标识它是同一 head 唯一一次超时复审。第二个窗口再次 timeout 时立即停止，Issue 保持 `status:in-review`，等待用户显式恢复。

quota exhausted 或 service failure 出现时立即停止。服务不可用不触发也不消耗 Timeout Retry；用户恢复后先重读全部远端 review 真相，再为当前 head 发布带恢复原因的 Review Request。

## Feedback 与复审

Codex feedback 必须处理并复审，回复或 resolve thread 本身不构成 Clearance Comment。

- feedback 需要代码变化：修改后运行相关测试和 Local Review，提交并推送形成 new head，再为新 head 发布 Review Request。
- no code change feedback：在原 thread 回复无需代码修改的证据，resolve 该 thread，并在请求中说明不修改原因，再为 same head 发布 Review Request。

新的 Review Request 启动新的 Review Window。quota/service、纯超时和假设性的模糊回复不进入普通 feedback 分支；没有明确 Clearance Comment 就不得合并。

## 合并门禁

自动合并必须同时满足：latest head 之后存在明确的 Clearance Comment，当前 head 没有 unresolved review thread，CI 成功或仓库经核实确实没有 CI。旧 head 清场、沉默、模糊肯定、quota 或 service failure 均不能授权合并。主模型必须在 merge 前再次读取 head、request、回复、threads、checks 和 mergeability。

Issue-backed PR 合并成功后，依次完成：

1. 将唯一 `status:*` 标签改为 `status:archived`；
2. 发布 completion comment，记录 merged PR 与 OpenSpec archive 路径；
3. close Issue；若 PR 已自动关闭 Issue，仍补齐标签与评论。

任一 Issue 收尾写入失败都停止。claim branch deletion 是 best-effort cleanup；只有分支删除失败时记录警告并继续，因为它不是完成真源。

无目标运行在一项成功合并并完成 Issue 收尾后，继续 select 下一项；没有 Available Issue 时停止。显式 `--issue` 或 `--change` 完成后停止。

## Local-only `--no-pr`

`--no-pr` 只允许显式指定且没有任何映射 Issue 的 Local-only change。该路径没有 PR、Codex review、PR thread、PR CI 或 Issue 收尾，但仍必须完成相关测试、完整 diff Local Review、strict validate、标准 archive、提交与实现分支推送。

直接集成前重读远端 base branch。只有远端 base 仍是实现分支祖先时才允许 fast-forward；若基线已前进，先更新实现分支、处理冲突、重新测试与 Local Review，再推送并重试。禁止 force push。结束前核验远端 base 已包含实现提交和 archive。

## Full Mode（full-only）

只有用户明确要求 full，或需要继续既有 full controller 状态时，才调用公开命令：

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full
```

目标、goal、multi-lane 与恢复输入继续使用既有 `OPENSPEC_BUDDY_AUTO_*` 环境变量和 `full` 后参数。不得直接调用 `scripts/full/` 内部模块。Full controller 运行期间保持静默，等待它返回 `DONE`、`HANDOFF` 或 `BLOCKED`；`HANDOFF` 只授权所述外部工作，`BLOCKED` 只处理所述阻断。任何外部状态变化后重新运行同一公开 `full` 命令，由 controller 复核并推进。

恢复命令也必须显式带 `full`：

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full --reset-controller-state
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full --reset-lane-state --reason "<why>"
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full --recover-unauthorized-merge --reason "<user-approved reason>"
```

`references/driver-states.md`、`selection-rules.md`、`execution-loop.md`、`review-waiting.md` 与 `failure-recovery.md` 全部是 full-only 参考，不适用于 lite。

## 最终报告

报告目标类型、Issue/change/branch/PR、测试与 Local Review、archive、review request 与清场所绑定的 head、merge/Issue 收尾结果，以及阻断事实。Full Mode 另报告 controller 返回阶段与 interrupt。
