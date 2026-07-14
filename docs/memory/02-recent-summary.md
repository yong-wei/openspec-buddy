# Recent Summary

状态: active
最后更新: 2026-07-14
摘要: 记录本仓库初始化后的最近稳定状态。
上游:
- [00-index.md](00-index.md)
下游:
- []
相关:
- [../README.md](../README.md)

## 最近状态

- 仓库从公开远端 `yong-wei/openspec-buddy` 的初始 `main` 历史启动，保留原 MIT License。
- `openspec-buddy` 与 `openspec-buddy-auto` 已复制到 `skills/`。
- 本机全局 `openspec-buddy` 与 `openspec-buddy-auto` 技能入口已改为指向本仓库技能目录的软链接。
- npm CLI 提供 `install`、`init`、`doctor` 和 `version` 命令。
- npm 包已发布；后续版本通过 GitHub Release 触发 npm Trusted Publishing。
- `v0.2.0` 发布线引入 `openspec-buddy claim`，用于先领取普通开放 GitHub issue，再判断它是单个可执行 OpenSpec 变更，还是需要拆分为子 issue 的父跟踪项。
- `v0.3.0` 发布线强化 PR 进入 review 前的协调检查：`mark-review.sh` 统一配置 PR 元数据、写入项目显式 review 请求，并通过 `verify-pr-coordination.sh` 校验标签、assignee、Project 状态、origin issue 和 Development-link 策略。
- `v0.3.1` 发布线修复 claim 阶段对工作树模式的限制，并新增 `verify-review-clear.sh` 合并前闸门，防止 Codex review body、review comments 或 unresolved threads 中的 `P0/P1/P2` 反馈被误判为可合并。
- `v0.4.0` 发布线将 `openspec-buddy propose` 改为默认同时调用 `openspec-propose` 创建本地 OpenSpec change，并登记带完整协作标签、关系和 Project `Todo` 状态的 GitHub Issue。
- `v0.5.0` 发布线强化 review 清场判断：`request-pr-review.sh` 会在新 head 后刷新 review request，`verify-review-clear.sh` 只有在当前 head 后的 request 之后出现明确清场评论时才接受顶层 clear comment，并输出评论摘要、时间和 URL 作为判断记录。
- `v0.6.0` 发布线新增 `wait-for-review-clear.sh` 前台阻塞等待 helper；Buddy Auto review 等待不再由主代理轮询，而由 helper 低频检查 review 状态并在必要时调用 `verify-review-clear.sh`。
- `v0.6.1` 发布线要求 Buddy apply/auto 在 pre-archive 前先运行 `openspec validate <change_id> --strict` 校验 active change/delta spec，并修复重复 review request gate 对 unresolved/P0-P2 blocker 的优先级。
- 本机项目目录新增被 git 忽略的 `.agents/skills/release-package/` 项目级发布技能：后续发布默认由代理判定 SemVer、维护 release notes 和相关文档，再用本地 `npm publish` token 文件完成 GitHub Release、npm 打包发布与发布后验证；`.agents/` 不放行进仓库。
- 从 2026-06-13 起，后续 OpenSpec-buddy 修改默认在隔离 git worktree 中完成，避免本仓库软链接技能影响其他正在运行的项目代理；开发结束后必须经子代理审核通过，再提交、推送、合并到 `main`，删除开发 worktree，将本地 `main` 对齐远端，然后直接发版和打包 npm。可使用 Superpowers 的工作树技能。
- `v0.9.4` 发布线强化多代理 claim 竞态门禁：claim 前后必须绕过缓存读取 GitHub 真源，先写最小 `status:claimed` 与 claim comment 并通过 REST 复查，之后才允许创建 Development link、远端 claim branch 和 Project Start/Status。
- `v0.11.0` 发布线补齐 review-fix loop 的 current-head review request 硬闸门：旧 Codex review threads 经 `review-response-gate.sh` 回复并 resolved 后，必须再通过 `request-pr-review.sh` 为当前 head 发起复审，`wait-for-review-clear.sh` 启动前会用 REST 验证 fresh review request，不满足则直接失败而不是静默等待。
- `v0.12.0` 发布线将 `wait-for-review-clear.sh` 改成两级等待：初始 300 秒后默认每 60 秒只读轻量 PR REST 状态，状态变化后才刷新完整 PR REST bundle 并触发 `verify-review-clear.sh`；首轮 900 秒无 clean review 时自动用固定 review request 加 retry context 复审一次，第二轮仍超时则转人工介入。
- `v0.13.0` 发布线为 `openspec-buddy propose` 新增 `validate-issue-body.mjs`：创建或更新 GitHub Issue 前必须同时通过 metadata、Acceptance Checklist、task-to-AC、task Acceptance/Evidence/Reviewer Check 校验；legacy claim/apply 路径继续只要求 metadata 以保持兼容。
- `v0.14.0` 发布线将 `openspec-buddy` 与 `openspec-buddy-auto` 主技能精简为 driver-first 入口文档，并新增 `buddy-driver.mjs` 与 `buddy-auto-driver.mjs`；Auto driver 使用签名本地 receipt 防止伪造阶段推进，`--no-pr` 仅允许显式 local-only `--change` 路径。
- `v0.15.0` 发布线将两个 driver 改为默认无参执行：确定性 helper 成功时静默推进并只返回 `DONE`，失败返回 `BLOCKED`，需要代理接管时返回 `HANDOFF`；技能入口明确要求 driver 运行期间不得执行命令、查询 GitHub、检查时间或输出进度，必须静默等待 driver 反馈。
- `v0.16.0` 发布线为 Buddy Auto driver 增加用户指定目标绑定：`OPENSPEC_BUDDY_AUTO_TARGET_ISSUE` 不会被当前工作树历史 PR 覆盖，`OPENSPEC_BUDDY_AUTO_TARGET_PR` 只从目标 PR 读取 origin issue 和 head；issue-only 目标由 driver 执行 `claim-issue.sh` 并记录 `claimed` receipt 后再 handoff 实现。
- `v0.17.0` 发布线修复 Buddy Auto goal-loop 空上下文入口：只有 `OPENSPEC_BUDDY_AUTO_GOAL=1` 或 `--goal` 明确授权时，driver 才会在无 issue/PR 上下文时运行 selector，并把选中的 issue-backed 候选转入 `claim-issue.sh`；普通空上下文仍停止，且 goal 模式不再被协调分支上的历史 PR 推断覆盖。
- `v0.18.0` 发布线将 Buddy Auto driver 推进为确定性状态机执行器：claim 后自动精确发现 issue-bound PR，review 阶段连续执行 mark-review/wait/merge gates，合并后通过 achievement truth 与 post-merge helper 在绑定协调分支同步 issue/Project 终态；同时新增 same-thread review reply helper、review-response-gate 可重跑输出、轻量 PR/thread 查询和高频 helper `--help`。
- 2026-07-12 review quota 与 merge gate hardening：共享 Codex response classifier 将 quota/service-limit 响应判为 `unavailable`；最新 review request cycle 的最新响应才拥有 clearance 权；`review_unavailable` 会持久阻断且不重复请求；foreground wait 在 unavailable 时返回 `4` 并停止 retry；合并改由 controller-owned helper 执行并写入 head/request/response 绑定的 `merge_authorized` 与 `merged` 回执，helper 失败或证据不匹配会清除授权；远端无授权回执的合并进入持久 `unauthorized_merge` 审计阻断。
- `v0.23.0` 发布线为手动 Buddy propose 增加 `.buddy/proposal-review.yaml` 形态合同和确定性校验：每个可执行 child change 必须形成可独立认领、测试、审核并由单个 PR 交付的纵向路径；GitHub `blockedBy` 保持依赖真源，宽范围机械迁移使用 `expand-migrate-contract`。同时，Buddy Auto single mode 只在核验远端合并真相并生成绑定 issue/change/PR/head 的签名恢复证据后，才允许恢复外部合并的 PR。
- `v0.23.1` 发布线补齐 review-wait cache-refresh eval 的负载容错：首次外层预算耗尽时清理专属缓存和后代进程，再以双倍预算重试一次；首次运行前也清空缓存，避免旧缓存掩盖刷新回归。

## 当前警惕点

- 用户要求提交时，必须先使用高推理子代理独立审查；有问题则修改并复审，直到报告没有问题后才可以提交。
- 除本次已经开始的主工作树分支外，后续修改不要直接在主工作树开发；先创建隔离 worktree，完成后清理开发 worktree 并确认本地 `main` 跟随 `origin/main`。
- README 面向使用者，不承载 release 和 GitHub automatic publishing 这类维护者流程。
- 协作者应优先使用 npm copy 安装，避免把个人机器上的绝对路径软链接提交到项目中。
