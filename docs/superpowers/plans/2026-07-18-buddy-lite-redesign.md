# Buddy Lite 默认模式重构实施计划

日期：2026-07-18
状态：可执行，尚未开始实现
目标版本：`v0.26.0`

## 1. 目标与依据

将 `openspec-buddy-auto` 的无参数默认行为改为无持久状态的 lite 模式；现有 controller、lane、receipt、cache 与恢复状态机整体迁入显式 `buddy-auto.mjs full`。本计划只落实以下已确认文档，不重新解释产品边界：

- `CONTEXT.md`
- `docs/handoff-2026-07-18-buddy-lightweight-redesign.md`
- `docs/adr/0001-model-judged-review-clearance.md`
- `docs/adr/0002-main-model-local-review.md`
- `docs/adr/0003-archive-change-in-implementation-pr.md`
- `docs/adr/0004-select-ready-issues-without-full-coordination.md`
- `docs/adr/0005-keep-workflow-execution-in-the-skill-entry.md`
- `docs/adr/0006-limit-lightweight-automation-to-coordination.md`
- `docs/adr/0007-preserve-full-mode-state-compatibility.md`

本次不重写 manual Buddy core，不把工作流搬进 npm CLI，不为旧 Auto 内部路径增加 shim，不增加 lite controller、cache、lease、receipt 或恢复状态机。

## 2. 完成条件

同时满足以下条件才算实现完成：

1. `scripts/buddy-auto.mjs` 默认进入 lite，`full` 后的参数、环境、状态文件和输出协议保持兼容。
2. lite 只有 selector、Claim、status 三个可执行协调脚本；其余新增文件只能是纯解析模块。
3. 无目标选择、`--issue`、`--change`、Local-only PR、Local-only `--no-pr` 均符合 handoff。
4. latest-head Codex Clearance、feedback 复审、一次 Timeout Retry、服务不可用立即停止等规则写入主模型技能合同。
5. 实现、测试、主 spec 与 archive 在 PR 路径中同 PR 交付；no-PR 路径只允许 Direct Integration Delivery。
6. `openspec-buddy init` 默认只要求 base branch，`init --full` 保持现有全量配置。
7. 仅运行完整 lite 流程测试和一个 full 冒烟；不运行全量 `npm test`，最终报告明确 full 未做完整回归。
8. 包版本与 release notes 更新到 `0.26.0`，`npm pack --dry-run` 包含新布局。

## 3. 资料发现结论

### 3.1 可直接沿用的现有模式

- `skills/openspec-buddy-auto/scripts/buddy-auto.mjs:1-26` 已使用 `spawnSync` 和环境变量委托 driver；新的公开入口沿用同步委托、stdio 与退出码透传方式。
- `skills/openspec-buddy-auto/scripts/buddy-auto.mjs:43-68`、`:98-127`、`:464-510` 定义了 full 参数、环境 seed、恢复参数和 `DONE/HANDOFF/BLOCKED` 行为；迁移时复制行为，不重新设计。
- `skills/openspec-buddy/scripts/claim-issue.sh:366-400` 已有 base SHA、远端 branch 和 Development branch 的核验模式；lite 只借鉴实时读取与首次 branch 创建，不复制 Project、cache、lease 或现有写入顺序。
- `skills/openspec-buddy/scripts/claim-lock.sh:414-590` 已有 assignee、结构化评论、状态写入及远端复核的命令形态；lite 复制远端复核原则，改用已确认的最小 Claim 元组。
- `skills/openspec-buddy/scripts/set-status-label.sh:25-81` 已有“删除旧状态、添加目标状态、重新读取确认”的模式；lite 不复制其 cache/Project 后处理。
- `skills/openspec-buddy/scripts/github-fetch.sh:765-795` 已有 GitHub 原生 `blockedBy` GraphQL 字段；lite selector 只查询所需边和邻接 Issue 的 `state/number`。
- `src/cli.mjs:74-105` 与 `:144-206` 已集中处理配置渲染、必填校验和交互提示，适合拆分 lite/full 配置集合。
- `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs:23-90` 已有假 `git`、假 driver、临时状态目录模式；新的 full 冒烟复用这种测试结构。

### 3.2 明确不能复用的实现

- `parse-issue-metadata.mjs:121-211` 要求完整 metadata，不能解析单行最小标记；lite 需独立的只读 `change_id` 解析器，full parser 行为不改。
- `worktree-identity.sh:55-130` 会创建 run-id 和 ledger，违反 lite 无持久状态约束；lite 只从 GitHub viewer、worktree alias/路径哈希和当前分支即时生成身份。
- `list-ready-change-relationships.sh`、现有 selector、`buddy-cache.mjs` 和 `github-fetch.sh` 的缓存路径不能成为 lite 真源。
- `request-pr-review.sh`、review verifier、receipt、controller 和 lane helper 不进入 lite 调用链；相关语义由 GPT-5.6 主模型按技能合同执行。
- npm `openspec-buddy` CLI 继续只做安装、初始化、诊断和版本查询。

## 4. 目标文件布局

```text
skills/openspec-buddy-auto/
  SKILL.md
  scripts/
    buddy-auto.mjs
    lite/
      contracts.mjs
      select-available-issue.mjs
      claim-issue.mjs
      set-issue-status.sh
    full/
      auto-decision.mjs
      buddy-auto-driver.mjs
      buddy-auto-lane-driver.mjs
      buddy-auto.mjs
      controller-reconciler.mjs
      controller-state.mjs
      lane-action-runner.mjs
      lane-state.mjs
      lane-switch-gate.mjs
      receipt-truth.mjs
      review-truth.mjs
  evals/
    lite/
      entry.test.mjs
      selector.test.mjs
      claim.test.mjs
      status.test.mjs
      skill-contract.test.mjs
    full-entry-smoke.test.mjs
```

`contracts.mjs` 是唯一计划内的新增纯模块，负责最小 metadata 解析、Claim 评论解析、身份比较和远端 Claim 分类；它不执行命令、不读写文件、不访问网络。

## 5. 阶段一：先建立 lite 合同测试

### 5.1 Entry 测试

新建 `evals/lite/entry.test.mjs`，先让以下断言失败：

- 无参数调用 selector，再将选中 Issue 交给 Claim。
- `--issue <number>` 只处理指定 Issue，不回退到其他候选。
- `--change <id>` 查明映射后选择 Issue-backed 或 Local-only。
- `--change <id> --no-pr` 只允许无任何映射 Issue 的 Local-only change。
- `--issue` 与 `--change` 互斥；无值、未知参数、裸 `--no-pr` 和 Issue-backed `--no-pr` 非零退出。
- `full` 必须是首个位置参数，后续参数原样传给 full 入口，stdout、stderr、signal 与退出码不包装。
- lite 成功输出单个 JSON 对象：`claimed`、`current_claim`、`local_only` 或 `exhausted`；阻断写 stderr 并非零退出。这是无持久状态的调用结果，不引入新的生命周期协议。

测试使用临时脚本替身记录参数，不访问真实 GitHub。

### 5.2 Selector 测试

新建 `evals/lite/selector.test.mjs`，通过假的 `gh` 和临时 `openspec/changes/` 覆盖：

- 读取单行 `<!-- openspec-buddy change_id: ... -->`。
- 兼容 YAML front matter 和旧多行隐藏 metadata，只提取 `change_id`。
- open + `status:ready` + 本地 change 存在 + 无开放 `blockedBy` 才可选。
- 多个候选按 Issue 编号升序，返回最小编号。
- closed blocker 不阻断，open blocker 阻断。
- ready Issue 映射的本地 change 缺失时停止并报告，不跳到下一 Issue。
- 同一 Issue 无映射、多个冲突映射、多个开放 Issue 映射同一 change 时停止。
- `--change` 只有一个开放映射时返回它；无映射时返回 Local-only；仅有 closed 映射或重复映射时停止。
- selector 不创建 `openspec/.buddy-cache`，也不调用 Project API。

### 5.3 Claim 测试

新建 `evals/lite/claim.test.mjs`，用假 `git`、`gh` 与可变远端快照覆盖：

- branch 不存在时先创建 `refs/heads/<change_id>`，再写唯一 assignee、Claim 评论和 `status:claimed`。
- Claim 评论包含 Issue、`change_id`、branch、GitHub viewer 和 worktree 身份，不含 lease、claim_id 或绝对路径。
- 完成后实时重读 branch、Issue state、assignee、最新 Claim 评论和唯一 status，全部匹配才成功。
- 已有完整当前 Claim 返回 `current_claim`，不重复写入。
- 已有完整外部 Claim：无目标调用可判定“被占用”，显式目标必须阻断。
- branch 已存在但 assignee、评论、状态或身份缺失/矛盾时阻断，不接管、不修复、不回滚。
- branch 创建竞态失败后重读；完整外部 Claim 按竞态处理，部分事实阻断。
- 任一写命令失败后只重读一次完整真相；已形成完整当前 Claim 则成功，否则阻断。
- 不调用 Project、cache、lease、Development-link helper，不删除远端 branch。

### 5.4 Status 测试

新建 `evals/lite/status.test.mjs`，覆盖：

- 只接受 `ready`、`claimed`、`in-progress`、`in-review`、`archived`。
- 删除 Issue 上全部旧 `status:*`，添加且仅保留目标标签。
- 写入后重读确认；失败时输出缺失、重复或残留标签差异。
- 不写 Project，不写 cache，不尝试回滚。

### 5.5 技能合同测试

新建 `evals/lite/skill-contract.test.mjs`，以文本断言固定：

- 默认 lite、显式 full、三个协调脚本和 Local-only 两种交付路径。
- 默认选择编号最小者，缺失本地 change 停止。
- 标准 strict validate 和 archive 与实现同交付单元。
- 固定 Review Request 文本。
- 300/60/900 等待、一次同 head Timeout Retry、第二次超时停止。
- quota/service 立即停止且不消耗 Timeout Retry。
- feedback 有代码变化时测试和 Local Review 后按新 head 复审；无代码变化时回复、resolve，并说明不修改原因后同 head 复审。
- latest-head 明确 Clearance、无 unresolved thread、CI 成功或确认无 CI 才合并。
- 合并后必须完成 Issue 标签、完成评论和关闭，分支删除仅为 best effort。

运行本阶段测试，确认它们因目标文件尚不存在或合同尚未更新而失败，保留失败摘要作为 TDD 起点。

## 6. 阶段二：迁移并封装 full 模式

1. 用 `git mv` 将当前 `scripts/` 下 11 个 full 模块整体迁入 `scripts/full/`，不改业务逻辑。
2. 保持 full 模块之间的相对 import 不变；将以下五处 core 相对路径从 `../../openspec-buddy/scripts` 调整为 `../../../openspec-buddy/scripts`：
   - `full/buddy-auto.mjs`
   - `full/buddy-auto-driver.mjs`
   - `full/buddy-auto-lane-driver.mjs`
   - `full/lane-action-runner.mjs`
   - `full/lane-switch-gate.mjs`
3. 机械更新既有 full eval 对内部模块的 import/路径，使其指向 `scripts/full/`；不改变测试语义，也不把它们纳入本次执行矩阵。
4. 新建 `evals/full-entry-smoke.test.mjs`：
   - 通过公开入口调用 `full`；
   - 使用既有环境变量注入假 single driver、临时 controller/lane state 和假 `git`；
   - 证明迁移后的 controller 能读取预置状态并把既有 target 传给 driver；
   - 证明 `--help`/恢复参数透传且 `DONE/HANDOFF/BLOCKED` 文本不被包装。
5. 不迁移或重写现有状态文件，不改 `OPENSPEC_BUDDY_AUTO_*` 含义，不增加旧内部路径 shim。

## 7. 阶段三：实现 lite 入口与三个协调脚本

### 7.1 纯合同模块

在 `scripts/lite/contracts.mjs` 实现并导出：

- `parseChangeId(body)`：识别单行最小标记、旧多行隐藏块和 YAML front matter；缺失、重复或冲突时返回明确错误。
- `parseClaimComment(body)`：只识别 lite Claim marker，提取 Issue、change、branch、agent、worktree。
- `currentIdentity(...)`：agent 字段使用 `codex/<GitHub viewer>`；worktree 优先使用 `buddy.worktreeAlias`，否则使用 repo realpath 的短 SHA-256；以 `(agent, worktree)` 作为当前执行者身份，远端评论不写绝对路径。
- `classifyClaim(snapshot, expected)`：只返回 `unclaimed`、`current`、`foreign`、`partial` 四类及字段差异。

不从 full parser 导入，不创建 run-id，不落盘。

### 7.2 Selector

在 `scripts/lite/select-available-issue.mjs` 实现三种查询：

- 无目标：REST 读取 open + `status:ready` Issue，解析映射并检查本地 change；对候选批量执行最小 GraphQL `blockedBy` 查询，选择最小编号。
- `--issue`：读取该 Issue 的实时 state、labels、body 与 blockedBy；只返回该目标或阻断。
- `--change`：读取 all-state Issue 映射；恰好一个 open 映射时返回 Issue-backed，无映射时返回 Local-only，重复或仅 closed 映射时阻断。

所有 GitHub 读取绕过 Buddy cache。selector 输出一个 JSON 结果，不修改远端。

### 7.3 Claim

在 `scripts/lite/claim-issue.mjs` 固定以下顺序：

1. 实时读取 Issue、映射、本地 change、viewer、assignees、labels、Claim 评论和远端 branch。
2. 先用 `classifyClaim` 处理既有 branch；current 继续，foreign/partial 按目标类型返回或阻断。
3. branch 不存在时，读取配置 base branch 的远端 SHA，并通过 GitHub Git Refs REST API 原子创建 `refs/heads/<change_id>`；已存在时 API 必须失败，以此建立 create-if-absent 锁。
4. 将 viewer 设置为唯一 assignee。
5. 发布最小结构化 Claim 评论。
6. 调用 lite status 脚本完成 `ready -> claimed`。
7. 重读完整远端快照并分类；只有 `current` 成功。
8. 第 3-6 步任何命令失败时不补写、不重试、不回滚，只执行一次第 7 步；最终 current 才可继续。

### 7.4 Status

在 `scripts/lite/set-issue-status.sh` 实现实时 label replacement：读取当前标签，删除所有 `status:*`，添加目标标签，再读取并要求目标标签唯一。脚本使用 `set -euo pipefail`，但捕获写入失败后仍执行最终只读核验并报告差异。

### 7.5 公开 Entry

重写 `scripts/buddy-auto.mjs` 为薄路由：

- 首个位置参数为 `full` 时透明委托 `scripts/full/buddy-auto.mjs`。
- 其他调用只接受 `--issue`、`--change` 和受限 `--no-pr`。
- lite 无目标时调用 selector 和 Claim，返回一个工作上下文；它不自行实施、等待 review 或持久化生命周期。
- `--change` 先由 selector 判定 Issue-backed/Local-only，不能由参数绕过已有 Issue。
- 整个技能的“连续处理”由 GPT-5.6 主模型在每项合并并完成 Issue 收尾后再次调用公开 Entry 实现；薄入口本身不保存循环状态。

完成后运行阶段一的五个 lite 测试，逐项修正到通过。

## 8. 阶段四：重写主模型技能合同

### 8.1 `openspec-buddy-auto/SKILL.md`

以 handoff 的 30 项决策为唯一语义来源，重写为：

1. 默认调用公开 Entry 获取一个 target/context。
2. 主模型自主完成实现、相关测试、完整 diff Local Review、strict validate 和标准 archive。
3. Issue-backed 与 Local-only 默认开 PR；只有显式 Local-only `--no-pr` 走 Direct Integration Delivery。
4. PR 流程固定 Review Request、等待节奏、feedback/resolve/复审、latest-head Clearance、thread/CI/merge gate。
5. merge 后执行 Issue archived 标签、完成评论、关闭和 best-effort branch 删除；无目标模式随后重新调用 Entry。
6. Direct Integration Delivery 必须在实现分支完成相关测试、Local Review、strict validate、archive、提交和推送；只有远端集成分支仍为实现分支祖先时才可 fast-forward，基线前进则同步后重新测试与审核，禁止 force push，并核验远端集成结果。
7. `full` 章节只指导调用 `scripts/buddy-auto.mjs full ...`，保留当前 controller interrupt 与恢复说明。

技能正文不要求模型直接组合 full 内部 helper，也不暴露迁移后的 driver 路径。

### 8.2 相关引用与 eval

- 将 `openspec-buddy-auto/references/` 现有 controller 文档明确标为 full-only，并统一公开命令为 `buddy-auto.mjs full`。
- 重写 `evals/evals.json` 的默认、目标、goal、review 场景，使默认 prompt 期望 lite 合同；保留一个显式 full 场景。
- 更新 `skills/openspec-buddy/SKILL.md` 中 Auto 跳转、配置和 Local-only 表述；manual core 流程本身不改。
- 运行 `skill-contract.test.mjs`，确认模型合同不存在 Project/cache/controller/receipt 误入 lite 的表述。

## 9. 阶段五：初始化、用户文档与版本

### 9.1 npm init

修改 `src/cli.mjs` 与 `test/cli.test.mjs`，并新增窄范围 `test/cli-lite-init.test.mjs`：

- 将现有配置键拆为 lite 必填集合和 full 必填集合。
- `openspec-buddy init` 只要求并写入 `OPENSPEC_BUDDY_BASE_BRANCH`。
- `openspec-buddy init --full` 继续使用现有 release branch、Project owner/number/title 与 review request 提示。
- 已有 full `.env.openspec-buddy` 保持可读取；不删除多余键。
- help 增加 `init --full`，但不增加 workflow 命令。
- 既有 `test/cli.test.mjs` 只更新已经过时的预期，留待未来 full 回归；本次只运行 `cli-lite-init.test.mjs`，覆盖默认 init、`init --full` 和已有 full 配置作为 lite 超集。

把相关 init/渲染断言加入 lite 测试执行清单；不要因此运行整个 npm suite。

### 9.2 文档

更新：

- `README.md`：默认 lite、显式 full、三种目标命令、Local-only 默认 PR/no-PR 例外、lite/full 配置对照。
- `.env.openspec-buddy.example`：首段只展示 lite base branch，后段标注 full-only 配置；固定 lite Review Request 不作为可配置项。
- `CONTEXT.md` 与七份 ADR：只修正实现后发现的术语或链接错误，不扩大决策。
- `docs/memory/02-recent-summary.md`：增加 `v0.26.0` 默认模式切换摘要，并明确 full 仍可显式调用。
- `docs/release-notes/v0.26.0.md`：突出无参数调用的不兼容变化和旧/新命令对照。

### 9.3 版本

- 将 `package.json` 与 lockfile 版本改为 `0.26.0`。
- 确认 npm 包 `files` 已通过 `skills/` 包含 `scripts/lite/` 与 `scripts/full/`，不新增重复入口。

## 10. 阶段六：限定验证

只执行以下测试，不运行 `npm test`、`npm run test:full` 或现有 controller/lane 全套：

```bash
rtk node skills/openspec-buddy-auto/evals/lite/entry.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/selector.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/claim.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/status.test.mjs
rtk node skills/openspec-buddy-auto/evals/lite/skill-contract.test.mjs
rtk node skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs
rtk node test/cli-lite-init.test.mjs
```

再执行非全量行为验证：

```bash
rtk node --check skills/openspec-buddy-auto/scripts/buddy-auto.mjs
rtk node --check skills/openspec-buddy-auto/scripts/lite/contracts.mjs
rtk node --check skills/openspec-buddy-auto/scripts/lite/select-available-issue.mjs
rtk node --check skills/openspec-buddy-auto/scripts/lite/claim-issue.mjs
rtk bash -n skills/openspec-buddy-auto/scripts/lite/set-issue-status.sh
rtk npm pack --dry-run
rtk git diff --check
```

最终报告必须逐项列出通过结果，并明确：full 只验证了入口、参数、既有状态读取与协议冒烟，没有执行 full controller/cache/lane 完整回归。

## 11. 实施与交付顺序

1. 从最新 `origin/main` 创建隔离 worktree 和 `codex/` 实现分支；当前主工作树中的访谈文档保持不丢失。
2. 按阶段一至五实施，每个阶段只修改列出的文件，不顺带重构 manual core。
3. 按阶段六完成限定验证和完整 diff Local Review。
4. 若要使用独立子代理审核，先取得本次任务的显式授权；未授权时不派发。
5. 修复所有审核发现后提交并推送实现分支，默认创建 PR。
6. 对实现 PR 使用固定 Codex Review Request；处理全部 feedback、resolve threads，并按是否改代码发起 new-head 或 same-head 复审。
7. 只有 latest-head 明确 Clearance、无 unresolved thread、CI 成功或确认无 CI 后合并到集成分支。
8. 合并后核对远端分支、版本、release notes 和包内容；发布动作另按 `release-package` 技能执行，不把“计划完成”误报为“版本已发布”。

## 12. 明确不做

- 不为假设性的模糊 Codex 回复设计新状态。
- 不在 lite 中引入 Project、depends_on、series、risk、mode、coupling、cache、lease、receipt、controller 或 lane。
- 不自动创建缺失的 OpenSpec change，不从标题猜 `change_id`。
- 不自动修复、接管或回滚部分 Claim。
- 不允许 Issue-backed `--no-pr`，不允许 force push 集成分支。
- 不用本地状态或旧 head 清场替代远端最新事实。
- 不以本次 full 冒烟声称完整 full 回归已经通过。
