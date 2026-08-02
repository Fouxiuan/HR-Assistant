# 开发约定

- Node.js 24+ 与 Electron 43+ 是受支持运行时。
- 数据持久化统一通过 `LocalDatabase` 和三个 SQLite 仓储，禁止添加第二套数据库驱动。
- 新迁移只能追加，不能修改已发布的迁移版本。
- SQL 写操作涉及多表时必须使用事务；外键和级联行为必须有测试。
- Web 和 API 保持同源；监听地址必须显式使用 `127.0.0.1`。
- 外部能力通过 `src/core/ports.ts` 注入，测试使用 fake port，不连接真实 BOSS、BrowserWing、AI 或邮箱。
- 密钥不得写入日志、普通 JSON 响应或 SQLite 业务字段。
- 备份格式变更必须增加格式版本和兼容性测试。
- 每次提交前运行 `npm run check`；桌面交付前额外运行后端 bundle 与 NSIS 构建。
