<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37777
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>

# Project Status

本仓库是 `openspec-buddy` 与 `openspec-buddy-auto` 的版本化源码仓库，用于把两个全局技能转为团队可审查、可发布、可显式升级的项目资产。

当前约定：

- 技能源码位于 `skills/openspec-buddy/` 与 `skills/openspec-buddy-auto/`。
- npm 包入口位于 `bin/openspec-buddy.mjs`，实现位于 `src/cli.mjs`。
- 包名为 `openspec-buddy`，当前版本为 `0.1.0`。
- 本机全局技能目录 `/Users/YW/.agents/skills/openspec-buddy*` 应保持为指向本仓库 `skills/` 的软链接。
- 协作者安装默认使用 npm copy 模式；symlink 模式只用于本仓库本机开发。
- 项目级长期记忆位于 `docs/memory/`。进入仓库后先读 `docs/memory/00-index.md` 与 `docs/memory/02-recent-summary.md`。

验证命令：

```bash
rtk npm test
rtk npm pack --dry-run
```

发布前要求：

- `package.json` 版本必须与 GitHub tag `vMAJOR.MINOR.PATCH` 去掉 `v` 后一致。
- 发布 npm 前必须先完成 `npm login`。
