# 贡献指南

感谢你帮助改进 CreatorDistill。项目优先接受能降低安装成本、提高抓取可观测性、补充
真实兼容性证据或修复明确缺陷的贡献。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. 功能变化先创建 Issue，说明用户问题、范围和验收标准。
3. 不要提交真实账号、Cookie、API 密钥、收藏夹内容、本机路径或未经授权的视频材料。
4. 不要用“100% 抓全”“永不风控”等无法验证的承诺描述功能。

## 本地开发

```powershell
npm ci
npm run check
npm run test:unit
```

需要浏览器 UI 回归时，先运行 `npm start`，再执行：

```powershell
npm run test:ui
```

## Pull Request 要求

- 每个 PR 只解决一个清晰问题。
- 描述修改目的、范围、风险和验证结果。
- 新增失败分支时补充可复现测试。
- 用户控制的文档与界面使用中文；代码标识、协议字段和第三方原文保留原语言。
- 新能力必须区分“设计完成”“静态测试通过”和“真实路径已验证”。
- 修改第三方快照前更新 `skills/vendor-lock.json` 和 `THIRD_PARTY_NOTICES.md`。

## Commit 建议

使用简洁的 Conventional Commit：

```text
feat: add creator profile audit
fix: stop retrying after verification challenge
docs: clarify local Whisper setup
test: cover favorites cache expiration
```

## 不接受的贡献

- 绕过验证码、登录限制或平台风控；
- 默认上传用户全部本地资产；
- 将密钥写入前端、示例或日志；
- 在没有来源和许可证的情况下复制第三方代码或 Skill；
- 以大规模重写替代可验证的小范围修复。
