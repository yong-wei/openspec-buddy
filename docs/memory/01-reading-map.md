# Reading Map

状态: active
最后更新: 2026-05-22
摘要: 指导后续代理按任务类型读取最少必要文件。
上游:
- [00-index.md](00-index.md)
下游:
- []
相关:
- [../README.md](../README.md)

## 技能内容变更

先读：

- `skills/openspec-buddy/SKILL.md`
- `skills/openspec-buddy-auto/SKILL.md`

再按需读对应 `references/` 或 `scripts/`。

## npm 安装器变更

先读：

- `src/cli.mjs`
- `test/cli.test.mjs`
- `package.json`

验证使用 `npm test` 和 `npm pack --dry-run`。

## 发布变更

先读：

- `package.json`
- `docs/release-notes/`
- `README.md`

发布前确认 manifest 版本与 `v` 前缀 tag 一致。

## 提交变更

当用户要求提交时，先读：

- `git status --short --branch`
- 当前暂存/未暂存 diff

硬性流程：

- 提交前必须使用高推理子代理进行独立审查。
- 子代理发现问题时，先修改，再复审。
- 只有子代理明确报告没有问题后，才可以 `git commit`。
- 该规则适用于所有提交请求，包括技能、脚本、文档和发布准备提交。
