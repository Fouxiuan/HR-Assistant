# 第三方组件声明

本项目权利人拥有版权的代码按 MIT License 提供。第三方组件不因此被重新许可，仍适用各自的许可证、版权声明和附加条款。

## BrowserWing

本项目使用 [BrowserWing](https://github.com/browserwing/browserwing) 1.1.0 作为本机受控浏览器自动化组件，并在 Windows 安装包中随附其可执行文件。HR筛选简历助手会在本机启动 BrowserWing，并将其服务绑定到 `127.0.0.1`。

BrowserWing 按 MIT License 发布：

> MIT License
>
> Copyright (c) 2025 BrowserWing contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

BrowserWing 的名称和商标归其权利人所有。本项目与 BrowserWing 项目及其维护者不存在隶属、合作或背书关系。

## 其他主要运行时组件

- Electron 43.2.0 — MIT License；其安装目录同时包含 Electron 与 Chromium 的许可证文件。
- `@modelcontextprotocol/sdk` 1.30.0 — MIT License。
- `dotenv` 16.6.1 — BSD-2-Clause。
- `express` 4.22.2 — MIT License。
- `imapflow` 1.6.1 — MIT License。
- `mailparser` 3.9.14 — MIT License。
- `pdf-parse` 2.4.5 — Apache License 2.0。
- React 与 React DOM 18.3.1 — MIT License。
- `@napi-rs/canvas` 及 Windows x64 原生组件 — MIT License。

完整依赖版本记录在各级 `package-lock.json`。依赖包的许可证与版权文本可在其源代码发行包、npm 包及 Electron 安装目录的许可证文件中查阅。各第三方名称和商标归其权利人所有。
