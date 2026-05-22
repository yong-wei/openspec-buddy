# Recent Summary

状态: active
最后更新: 2026-05-22
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

## 当前警惕点

- README 面向使用者，不承载 release 和 GitHub automatic publishing 这类维护者流程。
- 协作者应优先使用 npm copy 安装，避免把个人机器上的绝对路径软链接提交到项目中。
