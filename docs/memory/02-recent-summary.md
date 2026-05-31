# Recent Summary

状态: active
最后更新: 2026-05-25
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

## 当前警惕点

- 用户要求提交时，必须先使用高推理子代理独立审查；有问题则修改并复审，直到报告没有问题后才可以提交。
- README 面向使用者，不承载 release 和 GitHub automatic publishing 这类维护者流程。
- 协作者应优先使用 npm copy 安装，避免把个人机器上的绝对路径软链接提交到项目中。
