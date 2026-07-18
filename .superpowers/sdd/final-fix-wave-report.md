# Final Fix Wave Report

日期：2026-07-18

## 状态

合并前最终审核列出的 7 项缺陷均已按测试先行修复。实现与测试提交：`1ae94ea fix: close buddy lite final review gaps`。

未运行 `npm test`、full controller/cache/lane 全套或其他完整 full 回归。Full 证据仅限公开入口冒烟及相关语法检查。

## RED / GREEN 记录

### 1. Full 输出使用公开入口

- RED：`full-entry-smoke.test.mjs` 在 HANDOFF 输出中捕获 `resume_action: rerun buddy-auto.mjs`；断言失败。
- GREEN：所有 user-facing rerun、resume、allowed_work、legacy reset 与 help 命令统一为 `buddy-auto.mjs full ...`。
- 冒烟覆盖：DONE、HANDOFF、BLOCKED、无状态 child failure、child protocol failure、带状态非零退出、legacy lane state、controller reset、help；恢复参数仍透传。
- 文件：`scripts/full/buddy-auto.mjs`、`evals/full-entry-smoke.test.mjs`。

### 2. 唯一 identity 规则与无 alias 恢复

- RED：contracts identity 返回空 worktree，缺少 `agent: codex/<viewer>` 和 canonical realpath SHA256 fallback。
- GREEN：`buildIdentity(viewer, alias, realWorktree)` 成为唯一纯规则；alias 存在时直接使用，否则生成 `worktree-<12-char sha256>`。selector 与 Claim 均解析 realpath 后调用该规则。
- 端到端覆盖：无 alias Claim 写入 hash identity，随后再次 Claim 返回 `current_claim`；selector 对同一无 alias identity 恢复 current Claim。
- 文件：`scripts/lite/contracts.mjs`、`select-available-issue.mjs`、`claim-issue.mjs`、selector/claim tests。

### 3. Selector 使用完整实时 Claim tuple

- RED：缺失 branch、额外 assignee、重复 status 未被完整判定；无目标 current Claim 编号高于 ready Issue 时错误选择 ready（`10 !== 20`）。
- GREEN：共享 `classifyIssueClaim` 同时校验 open Issue、远端 branch、唯一 `status:claimed`、唯一且与评论一致的 assignee、最新结构化评论的 issue/change/branch/agent/worktree tuple。
- 行为：partial/矛盾立即停止；完整 foreign 在无目标模式跳过、显式目标停止；完整 current 在显式与无目标模式均继续，并优先于取得任何新 ready Issue。
- GitHub branch/comments/issues 均实时读取，不使用 cache。
- 文件：`contracts.mjs`、`select-available-issue.mjs`、`selector.test.mjs`。

### 4. Claim 写前与最终不变量复核

- RED：selector 后 Issue mapping 改变时 Claim 仍成功创建 ref；closed Issue、缺失本地 change 也未在首写前阻断。
- GREEN：首次写入前、每次失败后的唯一完整重读、最终重读均验证 Issue open、body 恰好一个 mapping 且等于 changeId、本地 active change 目录存在，并由共享分类验证 branch/status/assignee/comment。
- 竞态覆盖：mapping 在 ref 创建前改变时没有 POST ref；最终 status 后 mapping 改变时最终复核失败。
- 文件：`claim-issue.mjs`、`claim.test.mjs`。

### 5. Status 写失败后的最终真相

- RED：remove 失败后 shell 因 `set -e` 立即退出，只报告命令错误，不执行最终读取；add 失败同样缺少最终差异。
- GREEN：remove/add 分别捕获错误并继续到唯一一次最终只读复核。最终唯一目标已形成时按远端真相成功；否则同时报告写错误和 expected/observed 差异。
- 覆盖：remove fail、add fail、remove response failure but applied、add response failure but applied、幂等与多旧 status。
- 文件：`set-issue-status.sh`、`status.test.mjs`。

### 6. 实施分支合同

- RED：skill contract 未找到 fetch、tracking/switch、change_id 与当前分支等于 Claim branch 的完整约束。
- GREEN：Issue-backed 实施前明确 fetch 远端 Claim branch，切换或建立跟踪 `change_id` 的本地 branch，并核验当前分支等于返回的 Claim branch。
- 文件：`SKILL.md`、`skill-contract.test.mjs`。

### 7. 重复目标参数

- RED：public Entry 接受重复 `--issue` 或重复 `--change` 并退出 0。
- GREEN：Entry 与 selector 均计数并拒绝重复参数，同时保留 `--issue`/`--change` 互斥与缺值校验。
- 文件：`scripts/buddy-auto.mjs`、`select-available-issue.mjs`、entry/selector tests。

## 最终验证

以下命令全部通过：

```text
rtk node skills/openspec-buddy-auto/evals/lite/selector.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/claim.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/status.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/entry.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/skill-contract.test.mjs
rtk node skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs
rtk node test/cli-lite-init.test.mjs
rtk node --check <全部相关变更 mjs>
rtk bash -n skills/openspec-buddy-auto/scripts/lite/set-issue-status.sh
rtk npm pack --dry-run
rtk git diff --check
```

`npm pack --dry-run` 产物名：`openspec-buddy-0.26.0.tgz`。

计划审计：`docs/superpowers/plans/2026-07-18-buddy-lite-redesign.md` 与 `.superpowers/sdd/execution-plan.md` 未出现普通 `git push` 指令，GitHub REST ref 创建方案未回退。

## 自审与顾虑

- 未发现阻断性问题。
- Full controller/cache/lane 的完整行为未回归；本轮仅证明公开 `full` 入口、既有状态读取、恢复参数、协议输出和所列失败分支的冒烟兼容。
- selector 为优先发现 current Claim，需要实时检查所有候选 Claim；这是无 cache 的安全取舍，会增加 GitHub REST 请求，但符合本次合同。
- 未运行 `npm test`，这是任务明确限制，不应把本报告视为全仓测试证据。
