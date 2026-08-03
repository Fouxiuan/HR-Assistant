# 版本历史

## v2.8.6 - 2026-08-03

- 项目自有代码由 PolyForm Noncommercial License 1.0.0 改为标准 MIT License，允许使用、修改、分发和商业使用，但必须保留版权及许可声明。
- 保留招聘自动化、AI 辅助决策、候选人隐私、第三方平台和数据安全免责声明；免责声明不增加 MIT License 之外的使用限制。
- README 增加 BrowserWing 的用途介绍、官方仓库链接和无隶属或背书关系说明。
- `THIRD_PARTY_NOTICES.md` 保留 BrowserWing 1.1.0 的完整 MIT 版权及许可声明。
- NSIS 安装向导展示 MIT License，安装目录继续附带 `LICENSE`、`DISCLAIMER.md` 和 `THIRD_PARTY_NOTICES.md`。
- 完整检查通过：47 项后端测试、13 项前端测试、类型检查、lint 和生产构建；打包应用启动冒烟测试通过。
- NSIS 安装包：`HR筛选简历助手-Setup-2.8.6.exe`，大小为 121,154,585 字节。
- SHA-256：`88B13ABCE54C8E61196A6C268B2575A5AEFA5039F9ACC60FB8DA105EACBB8D49`。
- 安装包暂未使用商业代码签名证书，安装时可能触发 Windows SmartScreen 提示。

## v2.8.5 - 2026-08-02

- 项目自有代码改用 PolyForm Noncommercial License 1.0.0，仅允许学习、研究、实验和其他非商业用途。
- README 与安装目录加入针对招聘自动化、AI 辅助决策、候选人隐私、第三方平台和数据安全的免责声明。
- NSIS 安装向导展示完整许可条款，安装目录附带 `LICENSE`、`DISCLAIMER.md` 和 `THIRD_PARTY_NOTICES.md`。
- 明确第三方依赖继续适用各自的 MIT、BSD、Apache 等许可证。
- 完整检查通过：47 项后端测试、13 项前端测试、类型检查、lint 和生产构建。
- NSIS 安装包：`HR筛选简历助手-Setup-2.8.5.exe`，大小为 121,156,170 字节。
- SHA-256：`1066EC44E5C3370E51BB2FDFFEE1D08FC60F14F70C4AFC2B660AB135378AD7ED`。
- 安装包暂未使用商业代码签名证书，安装时可能触发 Windows SmartScreen 提示。

## v2.8.4 - 2026-08-02

这是“HR筛选简历助手”Windows 单机独立版的首个版本。

- 使用 Electron 43 和 Node.js 24+，支持 Windows NSIS 安装与源码启动。
- 所有候选人、运行记录、AI 评估、JD、简历邮件和 PDF 附件保存在本机 SQLite。
- 启动后直接进入主界面，JD、BOSS、AI 和招聘邮箱按需配置。
- AI 与招聘邮箱为可选项；未配置 AI 时使用规则降级评分。
- 招聘邮箱首次启用时从最新 UID 建立基线，只处理之后收到的新邮件。
- 设置页提供带密码的 `.hrbackup` 加密备份与恢复。
- 本地后端、开发服务器和受控浏览器服务仅监听 `127.0.0.1`。
- 应用不包含账号登录、跨设备配置或业务数据外发能力。
- 完整检查通过：47 项后端测试、13 项前端测试、类型检查、lint 和生产构建。
- NSIS 安装包：`HR筛选简历助手-Setup-2.8.4.exe`。
- 安装包大小为 121,144,099 字节，SHA-256 为 `3DAC2D7C2C668AA59B9C2E8BD32C105EECECAC19AD4ABD9724B3C94B535E4996`。
- 安装包暂未使用商业代码签名证书，安装时可能触发 Windows SmartScreen 提示。

独立版从本机空数据库开始，不读取旧版业务数据。后续升级沿用同一用户数据目录，并自动执行 SQLite 版本迁移。
