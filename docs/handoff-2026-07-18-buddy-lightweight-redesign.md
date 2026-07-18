# Buddy 极简模式重构访谈交接

日期：2026-07-18
状态：访谈完成，共同理解已确认；整改计划已形成，尚未修改生产代码。

## 目标

将 `openspec-buddy-auto` 默认模式重构为面向 GPT-5.6 主模型的极简模式，只保留避免多代理重复实施、越界交付和错误合并所必需的协调节点。现有复杂能力不删除，迁移到显式 `buddy-auto full` 模式。

默认模式不支持 Project 协调、双车道、缓存、持久 controller、签名回执或复杂恢复状态机。它不规定详细实施流程，只要求变更完整、范围正确、测试通过、完成本地审核，并在 PR 上取得针对最新提交的明确 Codex 清场评论后才允许合并。Auto 在成功合并后继续选择下一项工作。

## 已确认决策

### 1. Issue 与 Local-only change

- `buddy-auto` 无目标运行时先检查可用 GitHub Issue。
- Issue 已注册但对应本地 OpenSpec change 不存在时，停止并询问用户，不自动创建 change。
- 用户明确要求执行某个本地 change 时，即使没有 Issue 也可进入流程。
- Local-only change 不自动创建 Issue，但需要提醒用户该变更尚未注册 Issue。
- 显式授权按用户意图判断，不绑定某个精确 CLI 拼写。

### 2. 最小 Issue 映射

- Issue 必须显式包含 `change_id`。
- 极简格式采用最小隐藏标记，例如：

  ```html
  <!-- openspec-buddy change_id: add-example -->
  ```

- 默认模式不依赖标题猜测，不要求 YAML front matter、Project、系列、风险、mode 或其他 full metadata。
- 已有 full 模式 metadata 仍需保持可读取，以保证兼容。

### 3. 默认选择条件

Available Issue 必须同时满足：

- Issue 开放；
- 带有 `status:ready`；
- 显式映射到一个存在的本地 OpenSpec change；
- 不存在未关闭的 GitHub 原生 `blockedBy` 关系。

GitHub 原生 `blockedBy` 是默认模式唯一依赖真源。默认选择不读取 `depends_on`，不考虑同系列优先、Project、风险、mode、coupling、缓存或多车道调度。

### 4. 最小排他 Claim

保留一个单一 Claim 脚本，完成：

- 实时确认 Issue 开放、未被其他代理认领且本地 change 存在；
- 令 claim branch 等于 `change_id`，以该远端 branch 的首次创建作为排他锁；
- 将当前 GitHub 用户设为唯一 assignee；
- 写入最小结构化认领评论，记录 Issue、`change_id`、branch 和 agent/worktree 身份；
- 将 Issue 从 `status:ready` 改为 `status:claimed`；
- 立即重新读取远端分支、assignee、评论和状态，任何不一致都停止。

默认模式不保留 lease、Project、缓存、复杂状态标签或自动恢复状态机。Claim 失败后重新读取远端事实，不从本地状态猜测恢复。

### 5. 人工可见状态

- 默认模式保留 `status:ready`、`status:claimed`、`status:in-progress` 和 `status:in-review`。
- Claim 脚本只负责并复核 `ready -> claimed`。
- 后续状态修改由 5.6 主模型根据实际进度自主决定。
- 保留一个极小 `set-issue-status.sh <issue> <status>`：删除旧 `status:*`、添加一个新状态并重新读取确认。
- 状态标签用于人工检查，不作为 controller 状态机。

### 6. 实施完成与本地审核

- 不强制具体编码流程。
- 提交前必须确认实现完整、没有超出 change 范围、相关测试通过，并检查完整 diff。
- 默认由 GPT-5.6 主模型完成 Local Review，不强制独立子代理审核。
- 用户显式授权子代理后，主模型可按风险自主决定是否派发独立审核，以及使用何种允许的模型与推理强度。
- 简单变更可以在测试和主模型 Local Review 通过后直接提交。

### 7. PR 路径同 PR 归档

- OpenSpec change 的任务必须完成。
- `openspec validate <change> --strict` 必须通过。
- 执行标准 `openspec archive <change> --yes`。
- PR 交付路径中，实现、测试、同步后的主 specs 和 archive 必须进入同一个 PR；显式 no-PR 例外见第 27 节。
- 归档只是完成记账，不形成单独的 pre-archive 状态机。

### 8. Codex review 与自动合并

- PR 必须出现明确的 Codex 清场评论后才能自动合并。
- 清场评论必须针对最新提交；旧 head 的清场不能授权合并。
- quota exhausted、service failure、沉默、模糊肯定或其他无法完成审查的结果都不是清场，必须阻断。
- 极简模式面向 GPT-5.6，由主模型读取 PR、review request、评论、提交和 thread 信息并判断清场是否对应最新提交。
- 默认模式不使用清场 verifier、签名回执、持久 review 状态或强制 controller 框架。
- 明确清场后仍需确认当前 head 没有未解决 review thread，且 CI 成功或仓库确实没有 CI，随后自动合并。
- Auto 仅在合并成功后继续选择下一项工作。

### 9. Available Issue 选择顺序

- 同时存在多个 Available Issue 时，选择编号最小者。
- Claim 竞态失败后实时重读远端事实；只有明确证明该 Issue 已被他人认领或不再 Available，才选择下一个。
- 网络失败、部分写入或远端事实矛盾时停止并报告，不跳过该 Issue，也不进入自动恢复状态机。

### 10. 合并后 Issue 终态

- 先确认 PR 已成功合并，再执行 Issue 收尾。
- 将 Issue 唯一的 `status:*` 标签改为 `status:archived`。
- 完成评论至少记录合并 PR 和 OpenSpec archive 路径。
- 关闭 Issue；若 PR 已自动关闭 Issue，则补齐标签和评论。
- Issue 标签、完成评论或关闭失败时停止，不选择下一项工作。
- 合并时请求删除 claim branch，并在事后核对；仅分支删除失败时记录警告并继续，因为分支清理不是完成真源。

### 11. Codex review request 发起方式

- 最终提交推送后，在 PR 发布固定顶层评论：`@codex review 中文回复，即使没有重大问题也必须给出显式回复`。
- 发布后立即重读 PR，确认评论存在并保留评论 URL 作为本轮工作上下文中的证据。
- 同一最新 head 之后已经存在该请求时不重复发布。
- 默认模式不依赖 `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`、缓存、签名回执或 full 模式 request helper。

### 12. Codex review 单轮等待

- Review Request 发布后先等待 300 秒。
- 此后每 60 秒读取最新 head、Codex 回复和 review thread。
- 从请求发布起累计 900 秒仍无有效结果时结束本轮等待，后续按第 14 节的一次性 Timeout Retry 规则处理。
- Review Window 本身不包含自动复审。

### 13. Codex 复审触发条件

- PR head 在上次 Review Request 后发生变化时，重新完成测试和 Local Review，再为新 head 发起 Review Request。
- 若主模型判定 feedback 无需代码修改，则回复并解决相关 thread，随后为同一 head 发起复审，并在请求中明确说明未修改的原因。
- 同一 head 的无修改复审是普通重复请求检查的例外；必须能看到此前 feedback、处理回复和未修改理由的顺序关系。
- 回复 feedback 或解决 thread 都不能替代 Clearance Comment。
- quota exhausted、service failure 或模糊回复不属于普通 feedback 复审；纯超时按下一节的一次性 Timeout Retry 处理。

### 14. Review Window 超时恢复

- 第一个 900 秒 Review Window 没有收到 Codex 响应时，自动发起一次 Timeout Retry。
- 发起 Timeout Retry 前最后重读一次当前 head、Codex 回复和 review thread；边界时刻已经出现结果时不重复请求。
- Timeout Retry 请求必须在 PR 上明确标识这是同一 head 的唯一一次超时重试，使 GitHub 评论顺序本身足以阻止重复自动重试。
- Timeout Retry 进入新的 900 秒 Review Window，仍采用首次等待 300 秒、此后每 60 秒检查的节奏。
- 第二个 Review Window 再次超时时，Auto 停止，Issue 保持 `status:in-review`，等待用户显式要求继续。
- 用户恢复时重新读取全部远端 review 真相；不保存本地重试次数或持久恢复状态。

### 15. Codex 服务不可用

- Codex 返回 quota exhausted 或 service failure 时立即停止，不等待当前 Review Window 结束。
- 服务不可用不触发也不消耗 Timeout Retry。
- Issue 保持 `status:in-review`，等待用户显式要求继续。
- 用户恢复时重新读取远端事实，再为当前 head 发布带恢复原因的 Review Request。

### 16. 不扩展假设性的模糊回复分支

- 当前没有遇到 Codex 回复既非 feedback、又非 Clearance Comment、也非明确服务不可用的实际案例。
- 默认模式不为该假设新增状态、自动澄清、恢复分支或专项测试。
- 继续遵守已有合并硬规则：缺少明确 Clearance Comment 时不得合并。

### 17. 已存在 Claim branch 的分类

- Issue、远端 claim branch、唯一 assignee、最新结构化 Claim 评论和 agent/worktree 身份全部匹配当前执行者时，视为已有有效 Claim，直接继续。
- 上述远端事实完整一致但属于其他执行者时，不修改其 Claim；无目标 Auto 选择下一个 Issue，显式目标执行则停止。
- 只有 branch 存在，或者状态、assignee、Claim 评论与身份之间缺失或冲突时，视为不一致的部分 Claim，立即停止并报告。
- 默认模式不自动删除、接管或修复已有 claim branch；GitHub 用户相同不足以证明同一执行者。

### 18. Claim 中途失败

- 任一远端写入命令失败后，立即重读 branch、Issue 状态、assignee 和 Claim 评论。
- 最终事实已经形成当前执行者的完整 Claim 时，视为响应失败但写入成功，继续执行。
- 完整 Claim 属于其他执行者时，按认领竞态处理。
- 远端事实只有部分写入或相互矛盾时，停止并报告精确差异。
- 默认模式不自动重试缺失步骤，不删除 branch，不撤销 assignee，也不恢复 `status:ready`。

### 19. Auto CLI 入口

- 技能目录中的 `scripts/buddy-auto.mjs` 是唯一 Auto 工作流入口。
- `buddy-auto.mjs` 默认进入极简模式并自动选择 Available Issue。
- `buddy-auto.mjs --issue <number>` 以指定 Issue 进入极简模式。
- `buddy-auto.mjs --change <change_id>` 以指定本地 change 进入极简模式。
- `buddy-auto.mjs --change <change_id> --no-pr` 是用户明确要求不开 PR 的 Local-only 例外。
- `buddy-auto.mjs full` 进入现有复杂模式，`full` 后继续承接其恢复参数。
- npm `openspec-buddy` CLI 继续只负责 `install`、`init`、`doctor` 和 `version`，不新增工作流执行职责。

### 20. Auto 执行范围

- 无目标 `buddy-auto.mjs` 连续选择编号最小的 Available Issue；每项成功合并并完成 Issue 收尾后继续，直到没有 Available Issue 或发生阻断。
- `buddy-auto.mjs --issue <number>` 只执行该 Issue，完成后停止。
- `buddy-auto.mjs --change <change_id>` 只执行该 change，完成后停止。
- 显式目标失败或阻断时不改选其他工作。

### 21. 显式 change 的协调路径

- `--change` 只限定目标，不强制 Local-only。
- 恰好一个开放 Issue 映射该 `change_id` 时，按 Issue-backed change 执行，包括依赖检查和 Claim。
- 映射 Issue 不是 Available 或 Claim 属于其他执行者时停止，不绕过协调。
- 完全不存在映射 Issue 时才作为 Local-only change 执行，并提醒用户尚未登记 Issue。
- 多个 Issue 映射同一 change，或者只有已关闭 Issue 而本地 change 仍为 active 时，停止并报告不一致。

### 22. 极简模式脚本边界

- `buddy-auto.mjs` 是无持久状态的薄入口，只解析 `full`、`--issue`、`--change` 和受限的 `--no-pr` 并完成模式与目标路由。
- 极简模式只保留三个确定性协调脚本：Available Issue selector、Claim 和 Issue status update。
- selector 实时读取 Issue、`change_id`、本地 change 和 `blockedBy`，按 Issue 编号选择。
- Claim 脚本建立并复核排他 Claim；status 脚本替换并复核唯一 `status:*` 标签。
- 协调脚本内部可以复用少量纯解析模块，但不增加可独立调用的工作流 helper。
- Review Request、等待、feedback 处理、测试、Local Review、PR、归档、合并和 Issue 收尾均由 GPT-5.6 主模型按已确认合同执行。

### 23. 脚本目录布局

- `skills/openspec-buddy-auto/scripts/buddy-auto.mjs` 是新的唯一公开 Auto 入口。
- 极简模式三个协调脚本及其纯解析模块位于 `scripts/lite/`。
- 当前 `openspec-buddy-auto/scripts/` 中的 controller、lane、receipt 和 review-truth 模块迁入 `scripts/full/`。
- `skills/openspec-buddy/scripts/` 中 manual Buddy 与 full 模式共用的 core 脚本保持原位。
- `buddy-auto.mjs full` 委托 `scripts/full/buddy-auto.mjs`。
- 不为旧内部 Auto 模块路径保留兼容 shim；公开兼容面只有 `scripts/buddy-auto.mjs`。

### 24. Full 模式兼容范围

- `buddy-auto.mjs full` 保留现有 single、multi 和 goal 行为。
- 保留现有 `OPENSPEC_BUDDY_AUTO_*` 目标、模式和车道环境输入。
- controller、lane、receipt 和 cache 的文件位置与格式保持兼容，使未完成 full 任务可以继续。
- 保留 `DONE`、`HANDOFF`、`BLOCKED` 协议以及现有恢复参数。
- 有意改变的公开行为只有入口：原来的无参数 full 调用改为显式 `buddy-auto.mjs full`。
- 旧内部 Auto 模块路径不属于兼容范围。

### 25. Lite 最小测试矩阵

- Auto Entry 测试默认、`--issue`、`--change` 和 `full` 路由，以及互斥参数、退出码和参数透传。
- Selector 测试最小编号、隐藏 `change_id`、full metadata 兼容、本地 change 存在、开放 `blockedBy` 排除，以及缺失或重复映射停止。
- Claim 测试成功写入与复核、当前 Claim 继续、外部 Claim 拒绝、branch 竞态、部分写入停止，以及命令失败但远端已形成完整 Claim。
- Status 测试删除旧 `status:*`、写入唯一目标状态、重读确认和失败差异。
- 技能 eval 覆盖 latest-head Clearance Comment、同 PR archive、一次 Timeout Retry、quota/service 立即停止等模型合同。
- 实现后不运行全量 `npm test`，也不把 controller、cache、lane 测试移植到 lite。
- 只额外运行一个 full 冒烟测试，验证 `buddy-auto.mjs full` 能加载迁移后的 controller、透传现有参数并读取既有状态。
- full 的设计目标仍是完整行为与状态兼容，但本次测试证据不构成完整 full 行为回归；最终报告必须明确该边界。

### 26. Local-only 默认 PR 交付

- `--change` 指向确实没有映射 Issue 的 Local-only change 时，默认仍创建 branch 和 PR。
- 该路径不执行 selector、Claim、Issue status 或 Issue 收尾，但仍提醒用户该 change 未登记 Issue。
- 实现、测试、同步后的主 specs 和 archive 进入同一个 PR，并继续要求最新 head 的 Clearance Comment、无未解决 thread 和 CI 成功。
- 用户明确要求不开 PR 时可使用 no-PR 例外；该例外不能用于任何已有映射 Issue 的 change。
- Local-only PR 成功合并后停止，因为 `--change` 是显式单目标运行。

### 27. Local-only no-PR 直接集成

- no-PR 路径仍在实现分支完成全部任务、相关测试、GPT-5.6 主模型 Local Review、strict validate 和标准 archive。
- 实现、测试、同步后的主 specs 与 archive 一并提交，并先推送实现分支。
- 再次读取远端集成分支；只有远端集成分支仍是实现分支祖先时，才允许将其 fast-forward 到实现分支。
- 若集成分支已经前进，则先把实现分支更新到最新基线，处理冲突并重新完成相关测试和 Local Review，再重新推送和尝试集成。
- 禁止 force push；完成后必须核验远端集成分支包含实现提交与 archive。
- 该路径没有 PR、在线 Codex review、PR thread、PR CI 门禁或 Issue 收尾。

### 28. 发布版本

- 本次不兼容默认行为变更发布为 `v0.26.0`。
- 项目仍处于 `0.x`，minor 版本用于承载新的重要能力和不兼容默认合同。
- Release notes 必须突出说明：无参数 `buddy-auto.mjs` 改为 lite，原有行为通过 `buddy-auto.mjs full` 保留。

### 29. Lite 与 Full 初始化配置

- `openspec-buddy init` 默认只要求 `OPENSPEC_BUDDY_BASE_BRANCH`，用于 PR 和 Direct Integration Delivery 的目标分支。
- `openspec-buddy init --full` 继续要求现有 release branch、Project owner/number/title 和 review 配置。
- 已有 `.env.openspec-buddy` 是 lite 所需字段的超集，升级后继续可用，不迁移也不删除字段。
- lite 使用固定 Review Request，不读取 `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`。
- full 继续读取现有全部配置。

### 30. `v0.26.0` 直接切换

- `v0.26.0` 发布后，无参数 `buddy-auto.mjs` 立即进入 lite。
- 原 full 用户必须显式使用 `buddy-auto.mjs full`。
- 不增加兼容环境变量、旧配置自动探测或弃用警告期。
- README、两个技能文档、`--help` 和 release notes 提供明确的旧/新命令对照。
- 既有 full 状态通过显式 `full` 继续，不迁移状态文件。

## 最终确认

- 所有已识别决策分支均已完成。
- 用户已确认双方理解一致，访谈结束。
- 可执行整改计划见 `docs/superpowers/plans/2026-07-18-buddy-lite-redesign.md`。
- 后续进入实现时，以本 handoff、七份 ADR、`CONTEXT.md` 和整改计划为依据；发现相互冲突时先停止并回到这些文档核对，不自行扩展边界。

## 已创建的访谈文档

- `CONTEXT.md`：已确认的领域术语。
- `docs/adr/0001-model-judged-review-clearance.md`
- `docs/adr/0002-main-model-local-review.md`
- `docs/adr/0003-archive-change-in-implementation-pr.md`
- `docs/adr/0004-select-ready-issues-without-full-coordination.md`
- `docs/adr/0005-keep-workflow-execution-in-the-skill-entry.md`
- `docs/adr/0006-limit-lightweight-automation-to-coordination.md`
- `docs/adr/0007-preserve-full-mode-state-compatibility.md`
- `docs/superpowers/plans/2026-07-18-buddy-lite-redesign.md`
- 本 handoff。

以上文件当前均未提交。它们是访谈产物，不代表重构实现已经开始。
