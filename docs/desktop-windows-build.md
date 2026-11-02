# HiveWork Windows 桌面构建

2026-10-12 已在 Windows amd64 主机上完成 `1.0.2b6` 生产构建。
安装包包含首次直接选择运行模式、统一后的服务器设置界面、远程直连、临时本地模式、多服务器设置、Python 3.12.12、本地后端、最新 HiveWork 前端及已更名的默认助手技能。

## 安装名称与首次初始化路径

安装器标题、安装提示、快捷方式和 Windows 产品名称已统一为 `HiveWork`。
默认安装目录为 `Program Files\HiveWork`，安装后的程序名为 `HiveWork.exe`。
首次初始化密码文件为用户主目录下的 `hivework-login.txt`，状态接口和页面提示使用同一路径。

此前品牌改造单独保存的安装包为
`desktop/src/bin/HiveWork-desktop-windows-amd64-1.0.2b6-branding.exe`（213.7 MiB），
SHA-256 为 `4b29156535a8b8f741552e242d0f9375b46ca6762d75a286ca171272c8d313a9`。
该历史安装包旁有 `.sha256` 校验文件；校验记录在 `logs/installer-branding/release-verification.json`。
当前源码的最新安装包见下一节。

相关后端测试 204 项通过，前端品牌测试 5 项通过；Go 测试、Go vet、Ruff、mypy、
前端构建和 NSIS 编译通过。实际运行时已在隔离目录验证密码文件生成和密码校验。
当前 Windows 环境缺少 `make`，未执行 `make all`；未在主机上执行安装或升级操作。

## 当前源码的最新构建产物

| 文件                                                                | 大小      | 用途                                                           |
| ------------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `desktop/src/bin/HiveWork-desktop-windows-amd64-1.0.2b6.exe`        | 217.5 MiB | Windows 安装程序，包含运行时，提供快捷方式及 WebView2 安装引导 |
| `desktop/src/bin/Octop.exe`                                         | 233.1 MiB | 桌面程序本体，完整本地运行时已嵌入                             |
| `desktop/portable/release/Octop-portable-windows-amd64-1.0.2b6.zip` | 220.3 MiB | 独立本地后端运行时，可用 `start.bat` 启动                      |

每个文件旁边都生成了 `.sha256` 校验文件。安装程序 SHA-256：

```text
ad84b25d8563a76c98956e9efcfea53dd1a0a841ba63d8056bbb49c8601854b0
```

Go 构建输出名仍为 `Octop.exe`，安装器将其安装为 `HiveWork.exe`。
当前产品标识为 `com.tencent.octop`，数据目录继续使用 `~/.octop`。
2026-10-12 后续 Logo 替换使用用户提供的 `hivework-logo-assets/icons/app-icon-orange-512.png`，
已同步到 `desktop/src/build/appicon.png`，供 Windows/Linux 图标生成使用。
通过 `uv run python scripts/prepare_platform_branding.py --generate-assets` 重新生成平台素材。
当前安装包包含 Logo、运行模式和启动修复、登录线路简略展示、服务器设置菜单、默认科技蓝主题，以及「HiveWork 助手」技能。

首次运行新版客户端直接显示「远程服务器」「本地模式」两张模式卡片；选择远程后输入
`https://work.hivekernel.com` 并点击「保存并连接」。以后直接连接已保存的目标，跳过本地启动。
服务器设置中的添加表单和已保存列表按需展开，与登录页统一圆角、间距和按钮样式。
失败时可重试、切换服务器或临时使用本地，临时本地不会覆盖远程默认地址。
详见 [多服务器连接](desktop-server-connections.md)。
连接云端不需要在桌面端填写 PostgreSQL 配置。

## 构建过程

本次沿用仓库原有打包步骤，使用 PowerShell 与项目临时构建脚本执行，依赖锁保持不变：

1. 从官方 GitHub release 下载仓库固定的 python-build-standalone
   `20251209 / CPython 3.12.12 / windows-amd64`，核对官方 SHA-256。
2. `uv export --frozen --no-dev --no-emit-project --no-hashes` 导出锁定依赖，
   按现有便携包规则加入 `uv==0.12.22`。
3. 构建当前项目 wheel，安装到 `packages/`，复制启动脚本、VERSION 和 Windows DLL，
   形成 `Octop-windows-amd64/`。该 wheel 的前端已包含新版桌面服务器入口及用户菜单中的版本号。
4. 执行 `verify_imports.py`，并用隔离数据目录启动实际本地后端。
5. 将运行时打包为 ZIP，生成 Windows ICO、版本资源及 manifest，复制 ZIP 到
   `desktop/src/bundled/portable.zip` 后编译：

```powershell
cd desktop/src
go build -tags production -trimpath -buildvcs=false `
  -ldflags="-w -s -H windowsgui" -o bin/Octop.exe .
```

6. 使用仓库固定 Wails `v3.0.0-beta.13` 生成 WebView2 bootstrapper，
   用 NSIS 3.13 和原有 `project.nsi` 生成安装器，通过 `INSTALLER_OUTFILE`
   参数指定 HiveWork 制品名。

Wails 与 NSIS 仅解压或编译在 `logs/desktop-build-20261012/tools/`，没有修改全局 PATH。
标准发布流程仍见 `desktop/README.md` 和 `desktop/package-release.sh`。
[Wails Windows 打包文档](https://v3.wails.io/guides/build/windows/)与
[NSIS 官方下载页](https://nsis.sourceforge.io/Download)是本次工具参考来源。

## 验证

- `go test ./... -count=1` 和 `go vet ./...` 通过。
- 新增启动模式与取消提交回归通过：首次等待、远程失败不回退、临时本地保留默认、重启恢复远程、窗口权限及独立服务保留。
- HTML 页面脚本校验、Prettier 和相关组件 ESLint 通过；浏览器预览验证模式页、空地址表单、已有列表、登录入口及展开编辑。
- 本轮重新构建的前端通过 TypeScript/Vite 和 12 项登录、服务器入口及语言测试；上轮初始化与品牌后端测试为 30 项通过、1 项平台跳过，本轮没有修改后端源码。
- 依赖版本及 `octop`、FastAPI、cryptography、LangChain 等核心导入检查通过。
- 实际 portable Python 在 `logs/desktop-launch-fix/backend-smoke/home/.octop/`
  中启动本地后端；`/api/health` 返回 `ok=true`、`db=true`，
  `/api/setup/status` 返回首次初始化状态，SPA 品牌检查通过。测试进程已停止。
- 用户主目录同时隔离在 `logs/desktop-launch-fix/backend-smoke/home/`，初始化密码文件路径和密码校验通过。
- 运行时 ZIP 的 40935 个文件完整性检查通过；生产 EXE 内的 ZIP
  与原归档 SHA-256 完全一致，确认完整运行时确实被嵌入。
- 桌面 EXE 的 PE 架构为 amd64、子系统为 Windows GUI，包含服务器管理页面及本地保存代码。
- NSIS 编译通过，安装器包含桌面 EXE 与 WebView2 安装引导。
- Windows 版本资源由仓库脚本生成 `ProductVersion=1.0.2b6`，数字文件版本为 `1.0.2.0`。
- EXE 中的两份原生 HTML 和横向品牌 Logo 与当前源码逐字节匹配，确认模式选择和新版服务器设置已包含在本次安装包中。
- 内置前端的 384 个文件与最新构建输出一致；6 个 Windows 图标帧和托盘图标均已校验。客户端和安装器版本资源均为 `HiveWork / 1.0.2b6`。

当前构建证据位于 `logs/desktop-settings-menu/release-verification.json`，构建日志、
临时工具及脚本也在该目录，均不提交到 Git。
Wails 与 NSIS 工具复用先前下载到 `logs/desktop-build-20261012/tools/` 的版本。
临时 `.syso`、`bundled/portable.zip` 和 NSIS 版本定义文件的清理被自动审批策略拦截，保留在原有构建目录中。
本轮误建的 `desktop/src/logs/desktop-launch-fix/screenshots/` 空目录清理也被自动审批拦截；实际诊断文件均写入项目根目录的 `logs/desktop-launch-fix/`。

本轮已备份并替换 `D:\HiveWork\HiveWork.exe`，实际启动后持续运行且无原始闪退。安装器向导、完整原生操作和卸载尚未联调，
产物未进行代码签名；macOS、Linux 和 Windows arm64 未在本次构建。

## Windows 启动修复与登录线路展示

本轮确认旧安装程序在远程连接快速返回时，WebView2 控制器尚未初始化就调用导航，导致空指针并退出。
修复后等待主窗口和服务器管理窗口的 `WindowRuntimeReady`，连接、聚焦及线路信息注入均在窗口就绪后进行。
启动连接上下文提前创建，用户手动选择后，迟到的启动事件不能覆盖该选择。

登录页只显示当前「线路名称 - 地址」，设置按钮采用现有 AntD 小号描边样式及齿轮图标。
长线路单行省略，悬停可查看完整信息；更改名称后立即同步显示。
点击设置按钮打开客户端内置的服务器设置页，列表继续在本机保存。

本轮 `go test ./... -count=1`、`go vet ./...`、12 项前端测试、93 项 i18n 测试、
相关 ESLint/Prettier、TypeScript/Vite、页面脚本校验、本地运行时启动及 ZIP 完整性检查通过。
浏览器预览已核对单行布局和设置按钮跳转；真实 Windows 修复程序进入远程登录页由用户截图确认。
最终生产 EXE 已备份替换安装目录，并再次实际启动，12 秒后持续运行，之后复查进程仍在且日志没有 fatal 或 panic。
安装目录中的 EXE 与本次构建 SHA-256 一致；旧文件保存在 `logs/desktop-launch-fix/installed-backup/`。

云端前端同步升级，HTTPS HTML、入口 JavaScript 和品牌 Logo 与本次构建逐字节一致。
其他后端文件及 PostgreSQL schema 未变；部署详情见 [1Panel 部署说明](deployment-1panel.md)。
本机无 GNU make，未运行 `make all` 全量门禁；无后端源码变更，未重跑完整后端业务测试集。
安装器已编译并校验资源，尚未交互运行其升级向导；完整原生 GUI 操作和代码签名未验证。

## 科技蓝默认主题与服务器设置菜单

桌面偏好中的「设置服务器」移入设置列表末尾，作为带右箭头的整行菜单。
底部只保留「显示蜂巢智工」和「退出」。内容高度调整为 `528px`，Windows 沿用 `24px` 额外补偿。
中英文 `400×528` 浏览器预览已核对菜单与按钮完整可见，并验证菜单点击打开服务器管理页。

品牌默认主题设为现有科技蓝 `tech`，主按钮色为 `#3A5FE0`。
桌面设置、运行模式、启动和离线页的按钮、悬停、焦点和进度配色同步使用科技蓝。
Web 页无有效保存偏好时使用新默认值；原有用户配色继续保留。
内置运行时同版本时比较 wheel `RECORD`，内容变化或安装记录缺失时沿用数据库备份和原子替换；
更高本地版本不降级，旧无 `RECORD` 包保持兼容，连续启动不会重复替换。

本轮完整 Go 测试和 vet、5 组同版本运行时回归、43 项品牌/主题/桌面入口前端测试、
93 项 i18n 测试、TypeScript/Vite 构建和相关格式/静态检查通过。
本地运行时导入、隔离启动、数据库健康、初始化及完整 ZIP CRC 校验通过；
最终 EXE 中的运行时、原生 HTML、前端及图标与当前构建匹配。
云端同步科技蓝配置及前端，部署记录见 [1Panel 部署说明](deployment-1panel.md)。

当前运行中的已安装客户端保留，本轮没有再次替换安装目录或操作安装器向导。
本轮界面通过浏览器 RPC 预览验证；真实启动闪退的原生验证保存在此前 `logs/desktop-launch-fix/`。
本机无 GNU make，未运行 `make all` 全量门禁；完整原生操作及安装器升级向导未实测。
本轮产物校验和截图位于 `logs/desktop-settings-menu/`。

## 默认助手技能品牌同步

最新安装包包含「HiveWork 助手 / HiveWork Assistant」技能、🐝 图标、
HiveWork 简介、自我介绍及发行渠道说明。内部技能目录和 CLI 保留兼容标识。
新智能体使用新模板；现有智能体启动时，只更新全文摘要匹配已确认原版的默认副本，
用户编辑过、缺失或已更新的技能保持原样。同步通过 `BackendWorkspace` 完成，
支持旧目录和 `.octop` 系统目录，不重新播种专家或覆盖 `SOUL.md`。
远程模式读取服务器技能，当前服务器已完成同步；本地模式需要使用本轮安装包。

本轮重新构建项目 wheel，仅替换 portable 的 `octop` 包，没有同步第三方依赖。
实际 portable Python 校验 2191 个 wheel RECORD 条目与安装内容一致，
完整旧技能在两种目录和 LF/CRLF 下均升级成功，重复调用不改写且保留用户编辑。
portable 与线上模板的归一化 SHA-256 一致。
隔离本地后端健康检查、SQLite、首次初始化与 HiveWork SPA 验证通过。

运行时 ZIP 共 40938 个文件，CRC 校验通过；其 SHA-256 为
`38b174488eea9f8f00768fbe89a45da83929f1642641298918df1b502404d2bc`，
与正式 EXE 内嵌运行时完全匹配。安装器和桌面程序的 PE 产品资源均为
`HiveWork / 1.0.2b6`；384 个前端文件、原生 HTML、Logo 和图标校验通过。
完整证据位于 `logs/assistant-branding/desktop/release-verification.json`。

相关 backend pytest 293 项通过、1 项平台跳过，Ruff 与全源码 mypy 检查通过。
本轮没有修改前端或 Go 源码，因此没有重复其业务测试。
已安装程序与用户数据保持原样；安装器升级向导和原生 GUI 本轮未实测，产物未签名。
本机无 GNU make，未运行 `make all` 全量门禁。
