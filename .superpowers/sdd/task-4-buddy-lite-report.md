# Task 4：技能合同、初始化、文档与 v0.26.0 报告

日期：2026-07-18
状态：完成

## 实现结果

- `openspec-buddy-auto/SKILL.md` 已改为默认 lite 主模型执行合同，固定三个协调脚本边界、Review Request、300/60/900 等待、一次 Timeout Retry、quota/service 立即停止、feedback 必复审、latest-head Clearance、同 PR archive、Issue closeout、Local-only PR/no-PR 和无目标连续选择。
- Full Mode 只通过公开 `scripts/buddy-auto.mjs full` 进入；五份 Auto reference 均标为 full-only，恢复命令已统一增加 `full`。
- `evals/evals.json` 已将默认、连续选择、review 与 Local-only 场景改为 lite，并保留显式 full 场景。
- Manual Buddy skill 已更新 Auto 入口、`init --full` 配置与 Local-only 说明。
- `openspec-buddy init` 默认只写 `OPENSPEC_BUDDY_BASE_BRANCH`；`init --full` 保持原有 release branch、Project 与 review 配置。旧 full 配置仍是有效 lite 超集。
- README、环境变量示例、近期记忆、`v0.26.0` release notes、`package.json` 与 lockfile 已同步。
- `CONTEXT.md`、handoff、七份 ADR 与实施计划已纳入交付；计划中的 Git Refs 原子锁和五处 core 相对路径更正保持不变。

## TDD 证据

先新增 `skill-contract.test.mjs` 与 `cli-lite-init.test.mjs`，首次运行分别按预期失败：

- skill contract：旧技能没有声明无参数默认 lite。
- CLI init：旧实现仍要求 Project owner 与 Project number。

完成最小实现后，两份测试均通过。

## 限定验证

以下命令全部通过：

- `node skills/openspec-buddy-auto/evals/lite/entry.test.mjs`
- `node skills/openspec-buddy-auto/evals/lite/selector.test.mjs`
- `node skills/openspec-buddy-auto/evals/lite/claim.test.mjs`
- `node skills/openspec-buddy-auto/evals/lite/status.test.mjs`
- `node skills/openspec-buddy-auto/evals/lite/skill-contract.test.mjs`
- `node skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs`
- `node test/cli-lite-init.test.mjs`
- 四个 Node 入口/模块的 `node --check`
- `bash -n skills/openspec-buddy-auto/scripts/lite/set-issue-status.sh`
- `npm pack --dry-run`，产物名为 `openspec-buddy-0.26.0.tgz`
- `git diff --check`

未运行 `npm test`、`npm run test:full`、既有 `test/cli.test.mjs` 或 controller/cache/lane 完整套件，符合 Task 4 限定验证要求。

## Full 证据边界

本次 full 证据只覆盖：公开 `full` 入口可加载迁移后的 controller、既有 target/state 能被读取、恢复参数可透传、`DONE/HANDOFF/BLOCKED` 输出不被包装。它不证明 full controller、cache、lane 和全部恢复分支已经完成行为回归；发布或合并判断不得把该冒烟结果表述为完整 full 兼容验证。

## 自审

完整 diff 自审未发现阻断问题。Lite 文档没有把 Project、cache、controller 或 receipt 作为执行依赖；Full 文档没有暴露 `scripts/full/` 内部模块为公开入口；版本、帮助、README、环境示例、release notes 与技能合同一致。
