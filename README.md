# HR筛选简历助手

面向单个 HR 的 Windows 单机招聘助手。应用可以在 BOSS 直聘执行候选人筛选、读取简历、AI 评分和打招呼，也可以从招聘邮箱接收新的 PDF 简历。候选人、JD、邮件、附件、运行记录和配置均保存在当前电脑。

## 功能

- 无账号，启动后直接进入主界面，按需配置 JD、BOSS、AI 和招聘邮箱
- BOSS 候选人筛选、AI 评分与自动/手动打招呼
- 本机候选人库、运行历史与失败统计
- 本机 JD 创建、Markdown 导入和编辑
- 招聘邮箱 IMAP 轮询、PDF 原件保存、联系方式合并和邮件幂等
- AI 与邮箱密钥使用 AES-256-GCM 单独加密
- `.hrbackup` 一键加密备份与恢复
- Windows Electron NSIS 安装包，以及 Node.js 24+ 源码运行

## 数据与联网边界

业务数据库位于 Electron 用户数据目录的 `data/hr-assistant.sqlite`，使用 Node/Electron 内置的 `node:sqlite`。SQLite 启用外键、WAL、busy timeout、事务和版本迁移。PDF 原件以 BLOB 存入数据库。

应用只需要访问：

- BOSS 直聘
- 用户填写的 AI Base URL
- 用户填写的招聘邮箱 IMAP 服务

本机 Express 后端和 BrowserWing 都绑定 `127.0.0.1`，Web 控制台通过同源接口访问。应用不包含应用账号、跨电脑配置共享、遥测、自动云备份或业务数据上传接口。

日常 SQLite 文件不做整体加密。建议为 Windows 用户设置强密码并启用 BitLocker。

## 配置方式

启动后直接进入主界面，不再显示首次配置引导。请在设置页创建或导入 JD，并按需配置 AI 与招聘邮箱。开始筛选时会打开受控浏览器；如果 BOSS 尚未登录，请先在浏览器中手动完成登录。

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
