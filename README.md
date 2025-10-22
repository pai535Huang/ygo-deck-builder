# YGO 卡组编辑器

一个专注于“搜索卡片、构建卡组、导入/导出 .ydk，并展示多地区禁限状态”的轻量工具。支持桌面 Electron 窗口和浏览器两种使用方式。

## 主要功能

- 高效搜索与建组
  - 支持中文/英文/日文卡名检索，返回官方数据源同款字段。
  - 搜索结果可一键加入“主卡组 / 额外卡组 / 副卡组”，自动识别卡片所属分组（融合/同调/超量/连接等归入额外卡组）。
  - 预览图自动加载，失败时回退到公共 CDN，确保基本可视化。

- 禁限模式与规则约束
  - 内置 OCG/TCG/CN/AE 多地区禁限表；支持在界面中切换模式查看标签（禁止/限制/准限制）。
  - 加卡时按当前模式强约束：禁止=不可加入；限制=同名最多1；准限制=同名最多2；常规同名上限=3。
  - 主卡组≤60，额外≤15，副卡≤15，数量超限会提示并阻止。

- Genesys 评分支持（可选）
  - 读取 `data/genesys_scores.json` 和 `data/name_id_map.json`，为卡片建立分值映射。
  - 切换到“GENESYS”模式时，界面显示当前卡组总分，便于做自定义打分/练习评价。

- 导入/导出与整理
  - 导入 `.ydk`：自动解析 `#main/#extra/!side` 段，按卡号批量补全卡面信息后填充到三个卡组。
  - 导出 `.ydk`：一键生成，遵循 YGOPRO 约定格式。
  - 拖拽排序：支持卡组内拖拽、跨卡组拖拽（主↔副、额外↔副），并提供“一键整理”按钮按常见分组/等级排序。

- 先行卡与本地数据
  - 内置“更新先行卡”按钮：流式显示更新日志，成功后搜索将优先合并本地 `data/pre-release/index.json` 中的先行条目（含图片）。
  - 离线友好：核心数据位于 `data/`，在网络较差时仍可使用已有数据，稍后再执行更新命令同步。

- 两种运行形态
  - 桌面模式（Electron）：更像独立应用，窗口关闭即退出，避免干扰系统浏览器环境。
  - 浏览器模式：本地静态服务器 + 系统默认浏览器或隔离的 Chromium 窗口（Playwright）。

## 安装

前提：Node.js >= 18，建议使用 npm。

标准安装：

```bash
npm install
```

可选：复用系统的 Chromium/Chrome，避免额外下载 Puppeteer 浏览器（首次安装前设置）：

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
npm install
```

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
4) 先行卡与数据更新：点击界面“更新先行卡”，或使用上面的 CLI 命令手动更新。

提示：所有数据文件位于 `data/`，前端按需通过本地接口加载；网络不佳时也可离线使用已有数据，之后再执行更新命令。

## 快速开始

```bash
npm install
npm run dev    # 或使用：npm start（浏览器模式）
```

---

致谢

本 README 在 GitHub Copilot Agent 的协助下撰写。

