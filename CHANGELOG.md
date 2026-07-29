# 更新日志

所有重要变更记录在此。版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added

- CreatorDistill 公开品牌、产品封面、流程图和能力地图。
- Apache-2.0 许可证、安全政策、贡献指南和 GitHub Issue 模板。
- Windows CI：语法检查与无账号单元测试。

### Fixed

- 本地 Whisper 转写不再继承云端通道的 100 条提交上限；云端仍保持每次最多 100 条。
- 升级 Axios、Playwright，并锁定已修复的传递依赖版本，清理 GitHub Dependabot 安全告警。

## [0.1.0] - 2026-07-28

### Added

- 博主主页、单条作品和本人收藏夹目录获取。
- JSON 证据审核、去重和有限恢复 Loop。
- 云端链接转写与本地 FFmpeg + Whisper 双通道。
- SQLite 任务、日志、订阅、缓存、审计结论和产物索引。
- 多作品爆款拆解、证据选题、博主智能体画像与稿件审阅。
- 内容采集账号和收藏夹账号共享或独立登录。

### Known limitations

- 当前主要验证环境为 Windows 单用户本地运行。
- 收藏夹全目录数量对账仍需更多账号样本。
- 页面结构和平台策略变化可能导致目录抓取需要适配。
