# OpenSpec Buddy 细粒度共享缓存与广播协议实施版

## 1. 目标

本版直接采用细粒度协议，不保留粗粒度过渡层。

目标只有四项：

- 降低 Buddy 高频流程中的 GraphQL 调用次数。
- 允许多个工作树显式共享一份本地缓存。
- 允许不共享磁盘的代理通过远端 Ref 收到失效信号。
- 让缓存失效范围落到具体对象，不再因为单个状态变更清空整类关系缓存。

不改变 npm CLI 对外命令，不改变 Buddy / Buddy Auto 的既有语义。

## 2. 基本判断

### 2.1 默认模式

默认仍是本地缓存，不是共享缓存。

- 未设置 `OPENSPEC_BUDDY_CACHE_DIR` 时：
  - 每个工作树使用自己的 `openspec/.buddy-cache/`
- 设置 `OPENSPEC_BUDDY_CACHE_DIR` 时：
  - 多个工作树才显式共享同一个缓存目录

### 2.2 为什么必须直接细粒度

如果先上粗粒度广播，再改细粒度，会出现两类兼容成本：

- 旧广播 scope 无法表达“只失效边，不失效节点”
- 旧关系缓存把邻居 issue 的标签和状态嵌入自身，后续无法只替换单个节点缓存

因此本版直接改成：

- 关系缓存只保存边
- issue / pr / project item 各自保存自己的节点快照
- 广播 signal 只发送 scope，不承载业务真相

## 3. 协议总览

系统分成两层。

### 3.1 数据面

数据面是本地结构化缓存。

```text
openspec/.buddy-cache/
  meta.json
  signal-state.json
  signal-payload.json
  repo.json
  project.json
  issues/
    391.json
  prs/
    397.json
  relationships/
    issue-391.json
    ready-scan-limit-50.json
  locks/
```

### 3.2 控制面

控制面是远端自定义 Ref：

```text
refs/openspec-buddy/cache-signal
```

它只做三件事：

1. 给出全局递增的广播序号。
2. 提供最近若干条失效事件。
3. 让异地代理知道哪些缓存 scope 需要重新应用或失效。

## 4. 缓存对象设计

### 4.1 issue / pr cache

`issues/<n>.json` 与 `prs/<n>.json` 保存该对象自己的可复用字段：

- `number`
- `id`
- `title`
- `url`
- `state`
- `updatedAt`
- `labels`
- `assignees`
- `body`
- `projectItems`

字段允许是不完整子集，但不能伪造未读取到的值。

### 4.2 relationship cache

`relationships/issue-<n>.json` 只保存边，不再保存邻居节点的标签、状态、body。

建议结构：

```json
{
  "number": 391,
  "updatedAt": "2026-06-12T13:02:41Z",
  "parentNumber": 300,
  "subIssueNumbers": [392, 393],
  "blockedByNumbers": [280],
  "blockingNumbers": [401]
}
```

hydrate 时再从 `issues/<n>.json` 读取节点快照，组装成现有 selector / verifier 需要的对象形态。

### 4.3 ready scan cache

`relationships/ready-scan-limit-<n>.json` 继续存在，但它是派生结果：

- 来源是 open issue REST 轻量列表
- 候选 issue body 补取结果
- 关系边 hydrate 结果

只要收到 `ready-scan` scope，就直接失效重算。

### 4.4 signal state

`signal-state.json` 继续使用 Buddy 统一缓存包装格式，下面展示的是其 `data`
字段形态。它保存本地已应用到哪一个 signal tip：

```json
{
  "repo": "owner/repo",
  "ref": "refs/openspec-buddy/cache-signal",
  "tipSha": "abc123",
  "sequence": 42,
  "generation": 42,
  "appliedAt": "2026-06-12T13:02:50Z"
}
```

`generation` 与 `sequence` 同步递增。进程内快照只比较 `generation`，不直接比较对象内容。

### 4.5 signal payload

`signal-payload.json` 也使用同样的缓存包装格式，`data` 字段保存最近一次解析后的载荷，
供同机其他进程直接复用。

## 5. 广播载荷协议

远端 Ref 指向一个只包含 `signal.json` 的专用 commit。

不把 JSON 塞进 commit message；使用 Git Data API 写单文件 tree。

`signal.json` 建议结构：

```json
{
  "version": 2,
  "sequence": 42,
  "generation": 42,
  "repo": "owner/repo",
  "updatedAt": "2026-06-12T13:02:41Z",
  "writer": {
    "viewer": "login-or-unknown",
    "host": "machine-id-or-unknown",
    "worktree": "cache-signal-fine-grained",
    "pid": 12345
  },
  "event": {
    "kind": "claim",
    "scopes": ["issue:391", "ready-scan", "project"]
  },
  "recentEvents": [
    {
      "sequence": 40,
      "kind": "link-parent",
      "scopes": ["relationship:issue:300", "relationship:issue:391", "ready-scan"]
    },
    {
      "sequence": 41,
      "kind": "set-status",
      "scopes": ["issue:391", "ready-scan", "project"]
    },
    {
      "sequence": 42,
      "kind": "claim",
      "scopes": ["issue:391", "ready-scan", "project"]
    }
  ]
}
```

固定约束：

- `recentEvents` 保留最近 32 条。
- 不写绝对路径。
- 不写 token、review 正文、完整 issue body。

## 6. scope 语义

本版只使用这些 scope：

- `issue:<n>`
- `pr:<n>`
- `project`
- `relationship:issue:<n>`
- `ready-scan`

语义如下：

- `issue:<n>`：该 issue 节点缓存失效，或已被写穿更新。
- `pr:<n>`：该 PR 节点缓存失效，或已被写穿更新。
- `project`：`project.json` 与对象上的 `projectItems` 需要最小重校验。
- `relationship:issue:<n>`：该 issue 的边关系失效，需要重新拉 parent / subIssue / blockedBy / blocking。
- `ready-scan`：候选选择派生结果失效，必须重算。

关键原则：

- 状态标签变化通常只发 `issue:<n>`，不发 `relationship:*`
- parent / dependency mutation 才发 `relationship:*`
- `ready-scan` 只用于 claimable 集合的派生缓存，不作为节点缓存的替代

## 7. 读写规则

### 7.1 signal 写入

写入顺序固定为：

1. 读取当前 Ref tip。
2. 读取当前 `signal.json`。
3. `sequence + 1`。
4. 合并并裁剪 `recentEvents`。
5. 创建 `signal.json` blob。
6. 创建只包含 `signal.json` 的 tree。
7. 创建 commit。
8. 以非强制快进方式更新 Ref。
9. 若 Ref 已被其他写者推进，则重读后重试。

串行化只保护第 1-9 步，不阻塞本地业务逻辑。

### 7.2 signal 读取

代理只在阶段边界读取 signal，不做后台常驻轮询。

读取顺序固定为：

1. 看本地 `signal-state.json`
2. 读取远端 Ref tip
3. tip 未变化则直接继续
4. tip 变化则读取最新 `signal.json`
5. 计算需要应用的 scopes
6. 定向失效缓存
7. 更新 `signal-state.json` 与 `signal-payload.json`

### 7.3 保守失效

若本地 `sequence` 落后太多，最新 `recentEvents` 已无法覆盖中间缺口，则执行保守失效：

- 删除全部 `ready-scan-limit-*.json`
- 删除当前执行对象涉及的 `relationships/issue-<n>.json`
- 删除最新事件中出现的 `issue:<n>` / `pr:<n>` 对应缓存
- 保留无关 issue / pr 缓存

不再退回“删光全部关系缓存”的粗粒度行为。

## 8. 与 GraphQL 降额改造的结合点

### 8.1 REST 优先不变

本版不改变此前的总原则：

- open issue 列表走 REST
- PR reviews / comments / commits 走 REST
- GraphQL 只保留：
  - issue 边关系
  - reviewThreads
  - mutation

### 8.2 关系查询必须去范式化落库

`buddy_issue_relationships_graphql` 要分成两步：

1. GraphQL 返回 requested issue 与其邻居节点的最小字段
2. 落库时：
   - requested issue 与邻居 issue 写入 `issues/<n>.json`
   - 边写入 `relationships/issue-<n>.json`

对外输出仍保持现有 hydrate 形态，避免 selector / verifier 语义回退。

### 8.3 状态修改不再全量清关系缓存

例如 `set-status-label.sh` 成功后：

- 只更新或失效 `issues/<n>.json`
- 失效 `ready-scan-limit-*.json`
- 发布 `issue:<n>`、`ready-scan`、必要时 `project`

不再因为节点标签变化删除所有 `relationships/*.json`。

## 9. 接入范围

### 9.1 第一批必须接入

- `load-config.sh`
- `buddy-cache.mjs`
- `github-fetch.sh`
- `cache-signal.sh`
- `cache-signal-read.mjs`
- `cache-signal-commit.mjs`
- `list-ready-change-relationships.sh`
- `claim-issue.sh`
- `claim-change.sh`
- `link-issue-parent.sh`
- `link-issue-dependencies.sh`
- `set-status-label.sh`

### 9.2 第二批接入

- `configure-pr-metadata.sh`
- `request-pr-review.sh`
- `verify-pr-coordination.sh`
- `mark-review.sh`
- `mark-achieved.sh`
- `close-completed-series-parent.sh`

### 9.3 保持现状

`wait-for-review-clear.sh` 与 `verify-review-clear.sh` 继续以 GitHub 当前真相为准。

signal 只用于：

- 复用已有 REST bundle
- 避免 Buddy 自己造成的重复抓取

不能替代 reviewer comment、thread state、CI 状态的读取。

## 10. 锁与并发

当前实施版约束为：

- 发布远端 Ref 时维护 `locks/signal-publish.lock.d`
- 本地缓存文件使用同目录临时文件 + `rename` 的原子替换
- 读缓存不加锁

后续若确实出现多工作树同时写同一对象的碰撞，再补：

- `locks/signal-sync.lock`
- `locks/issue-<n>.lock`
- `locks/pr-<n>.lock`
- `locks/relationship-issue-<n>.lock`

## 11. 实施顺序

### 阶段 1

- 补齐 `signal-state.json` / `signal-payload.json`
- 补齐 signal helper
- 固定 `.env.openspec-buddy` 中的共享缓存与远端 Ref 配置面

### 阶段 2

- 重构 `buddy_issue_relationships_graphql`
- 让关系缓存只保存边
- 让 hydrate 输出继续兼容现有 selector / verifier

### 阶段 3

- 接入 `list-ready-change-relationships.sh`
- 接入 `claim-issue.sh` / `claim-change.sh`
- 让 `ready-scan` 与 `relationship:*` 真正按 scope 失效

### 阶段 4

- 接入状态 / Project / PR 协调脚本
- 把 Buddy 自己成功写出的节点状态写穿到缓存

### 阶段 5

- 接入 achieve / parent closeout
- 补并发测试与远端 Ref 协议测试

## 12. 验收标准

- 修改单个 issue 状态时，不再清空全部关系缓存。
- 关系缓存文件不再嵌入邻居 issue 的标签、状态、body。
- 选择链路在 signal 未变化时可复用 `ready-scan`，变化时只失效相关 scope。
- claim 前边界会应用最新 signal，而不是继续使用旧候选快照。
- 广播载荷通过远端 `refs/openspec-buddy/cache-signal` 的 `signal.json` 单文件 commit 读写。
- 默认缓存仍是工作树本地缓存；共享缓存必须显式配置。
