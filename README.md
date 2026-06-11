# OpenSpec Buddy

`openspec-buddy` 是一组面向 OpenSpec 工作流的代理技能包，包含两个技能：

- `openspec-buddy`：把一个 OpenSpec 变更和 GitHub Issue、声明分支、Pull Request、GitHub Project 状态绑定起来，适合人工控制的开放 issue 领取、提案登记、实现后归档。
- `openspec-buddy-auto`：在 `openspec-buddy` 的约束上执行自动化循环，负责选择可领取 issue、建立 claim、实现、开 PR、等待 review、合并、同步归档状态。

这两个技能不替代 OpenSpec 自身的设计和实现技能。推荐配合方式是：

1. 对已有 GitHub issue，先用 `openspec-buddy claim [issue]` 建立 claim；不指定 issue 时会选择最小编号的可领取开放 issue。
2. 对还没有 issue 的新变更，用 `openspec-buddy propose` 默认创建本地 OpenSpec change 并登记 GitHub Issue；该 issue 会带上协作标签、父子/依赖关系和 GitHub Project `Todo` 状态。若明确希望单人本地推进，不登记 GitHub，可使用 `openspec-buddy propose --no-issue`，此时只创建 `openspec/changes/<change_id>`，不创建或更新 GitHub Issue。
3. 用 `openspec-buddy apply` 在已 claim 的 GitHub Issue 上完成代码、测试和 spec 同步。
4. 用 `openspec-buddy achieve` 在 PR 合并后同步 GitHub Issue、GitHub Project 和 OpenSpec 归档记录。
5. 需要连续处理一组开放 issue 或已登记变更时，再使用 `openspec-buddy-auto`，让它按 claim、依赖、状态、review 和 CI 闸门逐个推进。对于 `--no-issue` 创建的本地 change，auto 应先识别本地候选再执行；`openspec-buddy-auto --no-pr` 只适用于这类 local-only change，只做本地 review、验证与合并，不开 PR。对 GitHub issue-backed change，仍保持一变更一 PR 的协调闭环。

核心约束是：一个可执行协调变更对应一个 GitHub Issue、一个 `change_id`、一个声明分支、一个 OpenSpec change 和一个 PR。复杂开放 issue 会先被 claim，再拆分成多个子 issue；原 issue 只作为跟踪父 issue。GitHub 负责跨分支、跨代理、跨工作树的协作状态；OpenSpec 仍然是需求、任务和 spec 的本地事实源。

## 安装

全局安装 npm 包后，把技能复制到常用 skill root：

```bash
npm install -g openspec-buddy
openspec-buddy install --target agents --force
```

也可以用常见 JavaScript CLI 一次性安装：

```bash
npx openspec-buddy install --target agents --force
pnpm dlx openspec-buddy install --target agents --force
yarn dlx openspec-buddy install --target agents --force
bunx openspec-buddy install --target agents --force
```

安装目标：

- `agents`：`$HOME/.agents/skills`
- `codex`：`$CODEX_HOME/skills`，未设置时使用 `$HOME/.codex/skills`
- `project`：当前项目下的 `./.agents/skills`

默认安装模式是 `copy`，适合团队成员显式升级。只有在直接维护本仓库技能源码时，才建议使用 `symlink`：

```bash
git clone https://github.com/yong-wei/openspec-buddy.git
cd openspec-buddy
npm install
npm test
openspec-buddy install --target agents --mode symlink --source ./skills --force
```

## 首次配置

在一个项目中第一次使用 `openspec-buddy` 或 `openspec-buddy-auto` 前，先生成项目级配置：

```bash
openspec-buddy init
```

命令会询问：

- Buddy 基线分支
- 发布分支
- GitHub Project owner
- GitHub Project number
- GitHub Project title
- Buddy PR 进入 review 前要写入 PR 评论的 review 请求语句

配置会写入当前项目的 `.env.openspec-buddy`。这个文件通常不提交到 Git；如需给团队提供模板，可参考 `.env.openspec-buddy.example`。

配置检查：

```bash
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh auto
```

若仅使用 `openspec-buddy propose --no-issue` 或配合
`openspec-buddy-auto --no-pr` 走本地最小路径，可只准备
`OPENSPEC_BUDDY_BASE_BRANCH`，并使用：

```bash
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh local
```

这一路径不要求 GitHub Project 字段，也不要求
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST`。

`OPENSPEC_BUDDY_PR_REVIEW_REQUEST` 不由包默认硬编码；每个项目应按自己的
review 机制显式配置。需要 Codex 正式 review 的 Major 类项目可使用：

```bash
OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
```

`mark-review.sh` 会把该字符串作为 PR 评论写入并做幂等检查；
`openspec-buddy-auto` 只调用核心 helper，不另写一套 review 请求逻辑。

## 常用命令

```bash
openspec-buddy install --target agents --mode copy --force
openspec-buddy install --target project --mode copy
openspec-buddy install --target agents --mode symlink --source ./skills --force
openspec-buddy init
openspec-buddy doctor --target agents
openspec-buddy version
```

## 平台说明

npm 安装器使用 Node.js，要求 Node.js 18 或更高版本。

Buddy 技能脚本目前以 Bash 为主要运行环境，并依赖 `git`、`gh`、`openspec`、`node` 等命令。因此：

- macOS 和 Linux 是主要支持环境。
- Windows 推荐通过 WSL2 使用。
- Windows 原生 PowerShell 或 cmd 目前不作为完整支持环境。
