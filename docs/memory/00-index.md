# OpenSpec Buddy Memory Index

状态: active
最后更新: 2026-05-22
摘要: 本仓库长期记忆的总入口，记录技能分发、npm 包装和本机软链接事实。
上游:
- [README.md](README.md)
下游:
- [02-recent-summary.md](02-recent-summary.md)
- [01-reading-map.md](01-reading-map.md)
相关:
- [../README.md](../README.md)

## 当前事实

- 本仓库是 `openspec-buddy` 与 `openspec-buddy-auto` 的版本化源码仓库。
- 技能源码位于 `skills/openspec-buddy/` 与 `skills/openspec-buddy-auto/`。
- npm 包名为 `openspec-buddy`，版本从 `0.1.0` 开始。
- 默认协作者安装方式是 npm 显式升级后复制到 skill root；软链接只用于本机开发 checkout。
- 本机全局技能路径已替换为指向本仓库 `skills/` 子目录的软链接。

## 维护入口

- 最近变化读取 [02-recent-summary.md](02-recent-summary.md)。
- 文件导航读取 [01-reading-map.md](01-reading-map.md)。
