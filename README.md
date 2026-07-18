# OpenSpec Buddy

`openspec-buddy` 是一组面向 OpenSpec 工作流的代理技能包，包含两个技能：

- `openspec-buddy`：把一个 OpenSpec 变更和 GitHub Issue、声明分支、Pull Request、GitHub Project 状态绑定起来，适合人工控制的开放 issue 领取、提案登记、实现后归档。
- `openspec-buddy-auto`：默认由 GPT-5.6 主模型按实时 GitHub/OpenSpec 事实执行 lite 工作流，只把 Issue 选择、排他 Claim 和状态标签交给确定性脚本；原有 controller、双车道、缓存和复杂恢复能力保留在显式 `full` 模式。

这两个技能不替代 OpenSpec 自身的设计和实现技能。推荐配合方式是：

1. 对已有 GitHub issue，先用 `openspec-buddy claim [issue]` 建立最小 claim lock，再通过 `.buddy/triage.json` 记录问题真实性、重复实现、spec/active change 冲突、信息充分性和执行 disposition；不指定 issue 时会选择最小编号的可领取开放 issue。已安装的研究类方法技能可以辅助收集证据，未安装时使用 Buddy 原生仓库与 GitHub 检查，工件和门禁不变。
2. 对还没有 issue 的新变更，用 `openspec-buddy propose` 默认创建本地 OpenSpec change 并登记 GitHub Issue；`.buddy/triage.json` 先完成真实性与重复检查，proposal review 通过 `.buddy/proposal-review.yaml` 明确记录纵向切片、series children、依赖完整性和宽范围迁移策略，并通过 `design.md` 的 `## Testing Strategy` 确定公共测试 seam 与每项 AC 的证据映射，三项合同都在 Issue 变更前校验。该 issue 会带上协作标签、父子/依赖关系和 GitHub Project `Todo` 状态。若明确希望单人本地推进，不登记 GitHub，可使用 `openspec-buddy propose --no-issue`，此时只创建 `openspec/changes/<change_id>`，不创建或更新 GitHub Issue。
3. 用 `openspec-buddy apply` 在已 claim 的 GitHub Issue 上完成代码、测试和 spec 同步。
4. 用 `openspec-buddy achieve` 在 PR 合并后同步 GitHub Issue、GitHub Project 和 OpenSpec 归档记录。
5. 需要自动处理一项或连续处理全部 Available Issue 时，使用 `openspec-buddy-auto` 的公开入口。无参数为 lite；`--issue <number>` 和 `--change <change_id>` 是单目标。Local-only 默认仍创建 PR，只有明确的 `--change <change_id> --no-pr` 才走 fast-forward 直接集成。原 full 用户改用 `scripts/buddy-auto.mjs full`。

核心约束是：一个可执行协调变更对应一个 GitHub Issue、一个 `change_id`、一个声明分支、一个 OpenSpec change 和一个 PR。复杂开放 issue 会先被 claim，再拆分成多个可独立执行的子 issue；只有子 issue 已关联并全部处于 `status:ready` 后，原 issue 才转换为跟踪父 issue。GitHub 负责跨分支、跨代理、跨工作树的协作状态；OpenSpec 仍然是需求、任务和 spec 的本地事实源。

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
npm run test:fast
openspec-buddy install --target agents --mode symlink --source ./skills --force
```

测试分为三层：

- `npm run test:fast`：语法、纯 Node 单元和关键状态机模拟，适合日常开发。
- `npm run test:helpers`：在 fast 基础上运行本地 shell/helper 集成测试，但跳过最耗时的全量 lane-driver 回归。
- `npm run test:full` 或 `npm test`：发布前完整回归。

## 首次配置

默认 lite 只需要目标基线分支：

```bash
openspec-buddy init
```

命令只询问 Buddy 基线分支，并写入：

```text
OPENSPEC_BUDDY_BASE_BRANCH=integration
```

Lite 的 Review Request 固定为：

```text
@codex review 中文回复，即使没有重大问题也必须给出显式回复
```

Lite 不读取 `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`。需要 manual Buddy 的完整
GitHub Project 协调或现有 Auto full controller 时，运行：

```bash
openspec-buddy init --full
```

`init --full` 继续询问发布分支、GitHub Project owner/number/title 和 review
配置。旧版生成的 `.env.openspec-buddy` 是 lite 所需字段的超集，升级后无需迁移或删除字段。

配置会写入当前项目的 `.env.openspec-buddy`。这个文件通常不提交到 Git；如需给团队提供模板，可参考 `.env.openspec-buddy.example`。

Manual Buddy 与 Auto full 的合并门禁默认要求观察到 CI 信号。只有仓库明确不使用 CI 时，才应在
`.env.openspec-buddy` 中设置 `OPENSPEC_BUDDY_ALLOW_NO_CI=true`；默认值
`false` 会在完整观察窗口持续没有 check suite、check run 或 legacy status
时拒绝合并。Lite 由主模型读取实时 checks，并直接核实仓库是否确实没有 CI，
不读取该 full-only 配置。

长期隔离工作树建议再设置本地绑定分支，避免代理从 detached HEAD 或其他
工作树分支进入 claim/auto 流程：

```bash
git config extensions.worktreeConfig true
git config --worktree buddy.boundBranch dev2
git config --worktree buddy.boundBase origin/integration
git config --worktree buddy.worktreeAlias dev2
```

配置了 `buddy.boundBranch` 后，`sync-base-branch.sh`、`claim-issue.sh` 和
`claim-change.sh` 会要求进场阶段必须在该分支上执行；未配置的普通仓库保持
旧的 base 对齐行为。

配置检查：

```bash
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh auto
```

若仅使用 `openspec-buddy propose --no-issue` 或 Auto lite 的 Local-only 路径，可只准备
`OPENSPEC_BUDDY_BASE_BRANCH`，并使用：

```bash
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh local
```

这一路径不要求 GitHub Project 字段，也不要求
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST`。

以下可配置 Review Request 只供 manual Buddy 与 Auto full 使用。请求文本应保留完整代码审查能力，再追加 scope 与 Acceptance Checklist 检查：

```bash
OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 请进行完整代码审查，包括正确性、回归风险、边界条件、测试覆盖、可维护性、安全性、数据一致性和现有行为兼容性；此外额外检查本 PR 是否仍在原 issue/OpenSpec change 范围内、是否覆盖 Acceptance Checklist、已完成 task 是否有 evidence、是否引入未登记需求。中文回复，即使没有重大问题也必须给出显式回复"
```

`mark-review.sh` 会把该字符串作为 PR 评论写入并做幂等检查；Auto full 继续调用该 helper。

## Auto 模式与迁移

安装到 `$HOME/.agents/skills` 后，公开入口示例如下：

```bash
$HOME/.agents/skills/openspec-buddy-auto/scripts/buddy-auto.mjs
$HOME/.agents/skills/openspec-buddy-auto/scripts/buddy-auto.mjs --issue 123
$HOME/.agents/skills/openspec-buddy-auto/scripts/buddy-auto.mjs --change add-example
$HOME/.agents/skills/openspec-buddy-auto/scripts/buddy-auto.mjs --change local-change --no-pr
$HOME/.agents/skills/openspec-buddy-auto/scripts/buddy-auto.mjs full
```

`v0.26.0` 直接切换默认行为：旧版无参数 full 调用需要增加 `full` 子命令；既有
controller/lane/cache/receipt 文件不迁移，显式 full 会继续读取原位置和格式。
Lite 的 PR 路径要求实现、测试、同步后的主 specs 和 archive 位于同一 PR，且只有
最新 head 的明确 Codex 清场评论、无未解决 thread、CI 成功或确认无 CI 时才允许合并。

## 常用命令

```bash
openspec-buddy install --target agents --mode copy --force
openspec-buddy install --target project --mode copy
openspec-buddy install --target agents --mode symlink --source ./skills --force
openspec-buddy init
openspec-buddy init --full
openspec-buddy doctor --target agents
openspec-buddy version
```

## 平台说明

npm 安装器使用 Node.js，要求 Node.js 18 或更高版本。

Buddy 技能脚本目前以 Bash 为主要运行环境，并依赖 `git`、`gh`、`openspec`、`node` 等命令。因此：

- macOS 和 Linux 是主要支持环境。
- Windows 推荐通过 WSL2 使用。
- Windows 原生 PowerShell 或 cmd 目前不作为完整支持环境。
