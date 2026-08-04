# HR筛选简历助手

面向 HR 的招聘助手。应用可以在绿色招聘网站执行候选人筛选、读取简历、AI 评分和打招呼，也可以从招聘邮箱接收新的 PDF 简历。候选人、JD、邮件、附件、运行记录和配置均保存在当前电脑。

> 本项目采用标准的 [MIT License](LICENSE) 开源，允许使用、复制、修改、分发、再许可和销售软件副本，但必须保留原版权及许可声明。使用本项目仍须遵守目标平台条款、适用法律和本项目的风险说明。

## 功能

- 无账号，启动后直接进入主界面，按需配置 JD、BOSS、AI 和招聘邮箱
- BOSS 候选人筛选、AI 评分与自动/手动打招呼
- 本机候选人库、运行历史与失败统计
- 本机 JD 创建、Markdown 导入和编辑
- 招聘邮箱 IMAP 轮询、PDF 原件保存、联系方式合并和邮件幂等
- 支持 Gmail、Outlook、163.com、vip.163.com、126.com、vip.126.com、188.com、vip.188.com 以及任何标准 IMAP/SMTP 服务器。
- AI 与邮箱密钥使用 AES-256-GCM 单独加密
- `.hrbackup` 一键加密备份与恢复
- Windows Electron NSIS 安装包，以及 Node.js 24+ 源码运行

## 数据与联网边界

业务数据库位于 Electron 用户数据目录的 `data/hr-assistant.sqlite`，使用 Node/Electron 内置的 `node:sqlite`。SQLite 启用外键、WAL、busy timeout、事务和版本迁移。PDF 原件以 BLOB 存入数据库。

应用只需要访问：

- Boss直聘
- 用户填写的 AI Base URL
- 用户填写的招聘邮箱 IMAP 服务

本机 Express 后端和 BrowserWing 都绑定 `127.0.0.1`，Web 控制台通过同源接口访问。应用不包含应用账号、跨电脑配置共享、遥测、自动云备份或业务数据上传接口。

日常 SQLite 文件不做整体加密。建议为 Windows 用户设置强密码并启用 BitLocker。

## BrowserWing

本项目使用 [BrowserWing](https://github.com/browserwing/browserwing) 1.1.0 作为本机受控浏览器自动化组件。Electron 会随应用启动其可执行文件，并将服务绑定到 `127.0.0.1`，后端通过本机接口控制浏览器、读取页面和维护登录会话。

BrowserWing 按 MIT License 发布；其原始版权和完整许可文本已保留在 [第三方组件声明](THIRD_PARTY_NOTICES.md) 中。本项目与 BrowserWing 项目及其维护者不存在隶属、合作或背书关系。

## 配置方式

启动后直接进入主界面，不再显示首次配置引导。请在设置页创建或导入 JD，并按需配置 AI 与招聘邮箱。开始筛选时会打开受控浏览器；如果尚未登录，请先在浏览器中手动完成登录。

首次启用邮箱只会把当前最新 UID 作为基线，不导入此前的历史邮件。以后每分钟检查一次新邮件，也可以手动触发。

## 加密备份

在 **设置 > 数据与备份** 中可以导出或恢复 `.hrbackup`：

- 备份先创建 SQLite 一致性快照，再连同运行参数、关键词、AI/邮箱加密配置及密钥、BOSS Cookie 和初始化状态一起压缩。
- 外层使用 `scrypt` 派生密钥和 AES-256-GCM 认证加密。
- 密码不保存且无法找回。
- 恢复会先验证文件标识、格式版本、数据库版本、文件白名单、路径安全、文件哈希和 SQLite 完整性；验证成功后才替换本机数据。
- 恢复失败会自动回滚；恢复成功后建议重启应用。
- 不备份完整 Chrome 用户目录。

## 环境要求

- Windows 10/11（安装包）
- Node.js 24 或更高版本（源码运行）
- 可登录 BOSS 直聘的 Chrome
- AI API Key 可选
- 招聘邮箱及客户端授权码可选

不需要安装额外数据库组件。

## 从源码启动

```powershell
npm install
npm --prefix web install
Copy-Item .env.example .env
npm run build:web
npm start
```

默认访问 `http://127.0.0.1:3000`。开发时可以分别运行：

```powershell
npm run dev
npm run dev:web
```

Markdown JD 批量导入：

```powershell
npm run import:jds
```

## 构建 Windows 安装包

```powershell
npm install
npm --prefix web install
npm --prefix electron install
npm run build:app
```

NSIS 产物写入 `electron/dist-electron/`，文件名为 `HR筛选简历助手-Setup-<version>.exe`。应用使用独立的 `appId` 和用户数据目录，不会覆盖其他产品的数据。

当前公开安装包暂未使用商业代码签名证书，Windows SmartScreen 可能显示未知发布者提示。请从 GitHub Release 下载，并按版本说明提供的 SHA-256 校验值核对文件完整性。

安装向导会展示完整许可条款；安装目录同时包含 `LICENSE`、`DISCLAIMER.md` 和 `THIRD_PARTY_NOTICES.md`。

## 本地 API

数据备份：

- `GET /api/data/backup/status`
- `POST /api/data/backup/export`
- `POST /api/data/backup/restore`

现有候选人、JD、运行控制、AI 配置、日志和邮件接口保持本机同源使用。

## 验证

```powershell
npm run check
npm run build:backend
npm run build:app
```

测试覆盖 SQLite 候选人去重、运行生命周期、评估、分页统计、JD CRUD、邮件幂等、联系方式合并、附件 BLOB、级联删除、事务回滚、数据库重启、无引导直达主界面、备份往返、错误密码、文件篡改和未来版本拒绝。

## 许可证

本项目权利人拥有版权的代码按标准 [MIT License](LICENSE) 提供。该许可证允许使用、复制、修改、合并、发布、分发、再许可及销售软件副本；传播软件或其主要部分时，必须保留版权声明和许可声明。

[免责声明](DISCLAIMER.md)用于说明招聘自动化、平台账号、AI 决策、隐私和数据安全风险，不增加 MIT License 之外的使用限制。第三方组件继续适用各自许可证，详见 [第三方组件声明](THIRD_PARTY_NOTICES.md)。

## 免责声明

- 本项目与 BOSS 直聘、看准科技、AI 服务商及邮箱服务商均无隶属、合作、授权或背书关系。使用者必须遵守相关平台条款、访问限制及适用法律，不得绕过验证码、风控或权限控制；自动化可能导致账号验证、限制或封禁。
- AI 评分和关键词匹配可能存在错误或偏差，仅可作为辅助信息。不得仅凭自动结果作出录用、拒绝等影响候选人权益的决定，必须进行实质性人工复核，并避免违法歧视。
- 简历、联系方式、邮件、Cookie 和附件可能包含敏感个人信息。使用者负责取得合法处理依据或授权，落实告知、访问控制、保存期限和删除要求；配置 AI 后，相关内容可能发送到使用者选择的第三方 AI 服务。
- 本机存储不等于自动合规。业务数据库不做整体加密，请使用 Windows 强密码、BitLocker、最小权限及加密备份，并且不要在 Issue、Discussion 或日志中提交真实候选人数据及密钥。
- 软件按“现状”提供，不保证无错误、连续可用、评分准确、平台兼容或数据不丢失。在法律允许的最大范围内，许可方不承担账号限制、招聘结果、数据丢失、隐私事件或第三方费用等损失。

完整内容见 [DISCLAIMER.md](DISCLAIMER.md)。如免责声明与许可证冲突，以 [LICENSE](LICENSE) 的英文正式条款为准。
