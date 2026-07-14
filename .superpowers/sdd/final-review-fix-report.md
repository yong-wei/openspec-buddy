# Final Review Fix Report

## Outcome

修复终审指出的首次 `unauthorized_merge` 收据缺少远端合并真源问题。首次检测现在强制读取绑定仓库的精确 PR；仅当远端明确为 merged、提供 `mergedAt`，且 `remoteHead` 与当前 head 完全一致时，才写入签名违规收据。可用时同时签入 `mergeCommit`。

远端读取失败、PR 未合并、缺少必要合并证据或 head 不匹配时均返回阻断，不写入 `unauthorized_merge`。恢复链也要求违规收据包含签名覆盖的 `remoteHead` 与 `mergedAt`。

## RED

先扩展 `buddy-auto-driver.test.mjs`，断言首次检测调用 `gh api repos/owner/repo/pulls/707`，并要求违规收据包含 `remoteHead`、`mergedAt`、`mergeCommit`。首次运行失败于：

```text
AssertionError: Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'merged-head'
at buddy-auto-driver.test.mjs:871:10
```

同一测试覆盖远端不可用、远端 open、远端 merged 但 head 不匹配三种安全阻断情形，并断言均不得产生违规收据。

## Verification

- `rtk node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`：通过。
- `rtk node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`：通过。
- `rtk proxy node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`：完成且无失败输出（该测试成功时静默）。
- `rtk npm pack --dry-run`：通过，生成预览 `openspec-buddy-0.22.0.tgz`。
- `rtk git diff --check`：通过。
- `rtk npm test`：未计入完成证据。误并发启动的两次完整套件在既有 `wait-for-review-clear.test.sh` 内停留时间过长，已连同后代进程全部终止；按协调要求由父线程在提交后单实例运行。

## Commit

提交主题：`fix(auto): verify unauthorized merge truth`。最终提交哈希由交付消息给出。

## Risks

- 这是有意的 fail-closed 行为：GitHub API 暂时不可用时不会持久化未经远端证实的违规收据，需要远端恢复后重跑检测。
- 旧式不含 `remoteHead` / `mergedAt` 的单模式违规收据不再足以进入恢复链；需要由新检测路径基于远端真源重新生成。
- 未修改 Task 2，也未修改版本号。
