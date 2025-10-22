# YGO 卡组编辑器

一款游戏王卡组编辑轻量工具，支持多种功能。支持桌面 Electron 窗口和浏览器两种使用方式。

## 主要功能

- 高效查卡与卡组构建
  - 借助百鸽（ygocdb）搜索 api 实现查卡功能，返回官方数据源同款字段。
  - 搜索结果可一键加入卡组。

- 支持多种模式
  - 内置 OCG/TCG/CN/AE 多地区禁限表；支持在界面中切换模式查看不同环境下的禁限情况。
  - 组卡时按当前禁限表强约束
  - 支持 GENESYS 环境，搜索结果中可显示单卡的 GENESYS 评分，组卡时可显示总分（GENESYS 环境下灵摆/连接怪兽默认禁用，该工具尚未与其同步）

- 卡组导入与导出
  - 导入：解析本地 `.ydk` 文件并导入应用（主要为了便于在 Linux 环境下进行卡组编辑）。
  - 导出：将编辑好的卡组保存为本地 `.ydk` 文件。

- 先行卡
  - 支持先行卡：从 Moecube CDN 下载先行卡补丁包（.ypk）并解包到本地，用于组建包含先行卡的卡组。

- 两种运行形态
  - 基于 Electron 的桌面模式。
  - 浏览器模式：本地静态服务器 + 系统默认浏览器或隔离的 Chromium 窗口（基于 Playwright）。

## 安装

前提：Node.js >= 18，建议使用 npm。

标准安装：

```bash
npm install
```

说明：本项目不再依赖 Puppeteer，安装阶段不会下载或安装额外浏览器组件。

## 运行（图形界面）

桌面模式（Electron）：

```bash
npm run dev
```

- 如在 Linux 下遇到 Chromium 沙箱报错，可临时使用（仅用于本地调试）：

```bash
npm run dev:nosandbox
```

浏览器模式（本地服务器）：

```bash
npm start            # 默认使用系统浏览器打开
npm run start:chromium  # 使用隔离的 Playwright Chromium 窗口
npm run start:system    # 强制使用系统默认浏览器
npm run start:none      # 仅启动本地服务器，不自动打开浏览器
```

## 运行（命令行 / CLI）

- 更新禁限表（OCG/TCG/AE 合并）：

```bash
npm run update-data
```

- 更新简中禁限表（CN）：

```bash
npm run update-data-cn
```

- 更新评分/权重等辅助数据：

```bash
npm run update-genesys
```

- 仅启动本地服务器（不自动打开浏览器）：

```bash
npm run start:none
```

## 使用方法

1) 搜索卡片，点击添加到主卡组/额外/副卡组；超过上限会有提示。
2) 导入/导出 .ydk：使用界面上的导入/导出按钮。
3) 禁限状态会在卡片上以多地区标记显示（OCG/TCG/CN/AE）。
4) 先行卡与数据更新：点击界面“更新先行卡”，或使用下面的 CLI 命令手动更新：

```bash
npm run update-prerelease
```

先行卡数据来源与覆盖：

- 默认从 `https://cdntx.moecube.com/ygopro-super-pre/archive/ygopro-super-pre.ypk` 下载。
- 可通过环境变量覆盖下载源（支持任意 .ypk 链接）：

```bash
PRE_URL="https://your.mirror/ygopro-super-pre.ypk" npm run update-prerelease
```

缓存与增量：脚本会使用 HEAD 请求对比 ETag/Last-Modified/Content-Length，若远端未变化则跳过重复下载与解包。

提示：所有数据文件位于 `data/`，前端按需通过本地接口加载；网络不佳时也可离线使用已有数据，之后再执行更新命令。

## 快速开始

```bash
npm install
npm run dev    # 或使用：npm start（浏览器模式）
```

---

致谢

本 README 在 GitHub Copilot Agent 的协助下撰写。

