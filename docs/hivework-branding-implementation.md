# HiveWork（蜂巢智工）品牌改造实施记录

实施日期：2026-10-11。方案：[品牌改造实施方案](hivework-branding-plan.md)。安装与升级：[操作说明](hivework-install.md)。

实施分支为 `feature/hivework-branding`，基于获取后的 `origin/develop` 提交 `544ea757`。品牌代码已接入，验证结果记录在本文；没有提交、推送、创建 Release 或上传软件包。

## 1. 已完成的代码范围

| 阶段          | 实际交付                                                                     | 验收边界                                                                     |
| ------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0 基线       | 获取远程引用，在 `develop` 基线上建立功能分支                                | 原有问题与品牌变更分别记录                                                   |
| P1 资料与加载 | 共享 profile，独立前后端中英文覆盖，名称 helper，加载与切换回归              | 保留原 locale 解析、插值和 fallback                                          |
| P2 Web 展示   | Logo、蜂巢图标、小蜜蜂吉祥物、默认科技蓝、页面文案、启动和离线页、PWA        | 保留用户已有主题；产品 Logo 已按用户提供素材同步到品牌目录与兼容 public 路径 |
| P3 更新与构建 | 官方自更新副作用前拒绝，源码强制构建及重装，wheel/Docker 接入，fork 发布保护 | 只生成本地或 Actions 审阅制品，没有外发                                      |
| P4 综合验证   | 静态检查、品牌回归、构建、安装包、隔离浏览器与 Docker 启动                   | 真实已有部署升级、PWA 已安装实例与回滚仍需部署验收                           |
| P5 平台源码   | 桌面窗口/托盘/启动展示，FnOS 显示字段与打包暂存素材                          | 安装器身份、签名、真实平台安装/升级/卸载尚未验收                             |

### 单一品牌资料

[profile.json](../src/octop/branding/profile.json) 保存英文名 `HiveWork`、中文名 `蜂巢智工`、项目/反馈链接、默认色和 `allow_official_self_update: false`。品牌资料属于发行代码，不写入用户 `config.json`，也不提供运行时品牌后台。

前后端分别使用 `frontend.{en,zh}.json` 与 `backend.{en,zh}.json` 覆盖显示文案。原大型翻译文件只增加更新保护所需的新错误码；品牌词替换集中于独立覆盖文件。上游新增键或改变原文时，应审核覆盖目标，而非执行全库文本替换。

| 入口     | 实际实现                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 后端加载 | [i18n/loader.py](../src/octop/i18n/loader.py) 在载入 canonical bundle 后合并品牌覆盖                                                |
| 前端加载 | [branding.ts](../dashboard/src/branding.ts) 与 [i18n.ts](../dashboard/src/i18n.ts) 在首次加载、切换与 fallback 使用同一覆盖         |
| 默认构建 | [branding/plugin.ts](../dashboard/branding/plugin.ts) 接入原 Vite 配置，不需要额外品牌 build 命令                                   |
| API/CLI  | API/Scalar 标题、介绍、CLI 帮助、版本与欢迎语使用品牌资料                                                                           |
| 视觉素材 | [branding/assets](../dashboard/branding/assets/) 保存由用户 [Logo 素材](../hivework-logo-assets/) 派生的资源，已有资源 URL 保持可用 |

### 构建与缓存

插件在 `logs/hivework-branding/public/` 生成独立 public 暂存目录，合成上游资源与品牌素材，覆盖 manifest 的显示字段和离线页，再交给原 Vite/PWA 构建流程。HTML 显示标题和启动色通过明确模板目标接入；目标缺失或重复会报错，避免上游模板变化被静默忽略。

没有对压缩 JS 或构建后的哈希资源进行批量替换。PWA 的 `id`、`start_url`、`scope` 保持原值，Service Worker 由正常构建生成；已有浏览器安装名称和图标能否立即刷新，仍依赖浏览器，需要真实安装升级验收。

默认科技蓝（`tech`）只作用于没有有效保存偏好的用户。已保存的颜色、明暗模式、语言、专家名称、SOUL 和个性化设置不被批量改写。

### 更新与发行保护

[共享更新器](../src/octop/infra/setup/self_update.py) 在任何 pip 安装、子进程或平台更新副作用前检查品牌策略。API 返回 `UPDATE_BRAND_MANAGED`（403），CLI 给出自有制品升级说明；更新状态提供 `self_update_allowed` 和项目升级入口。HiveWork 的设置页不挂载原官方更新组件，因此不触发官方 PyPI 检查；状态获取失败可显式重试。

源码安装器发现品牌 profile 后重新构建并验证 SPA；安装时使用 `--reinstall-package octop`，防止同路径、同版本普通源码安装复用旧包或旧内置前端。验证针对真实 `site-packages`，不靠工作区 import 冒充安装成功。

继承的上游打标、PyPI、Docker、桌面 Release、FnOS 发布任务限定在 `TencentCloud/Octop`。普通 CI 和桌面 PR 构建保留。`make publish` 对当前 HiveWork profile 拒绝上传原 `octop` 包。

[HiveWork 制品流程](../.github/workflows/hivework-artifacts.yml) 只允许在自有仓库手动启动，构建 wheel 与 Linux amd64 镜像，记录 commit 和 SHA256 后归档。它不推送镜像、不上传 PyPI、不创建 tag/Release、不级联平台发行。

## 2. 兼容性与保留的标识

本次没有数据库迁移、配置搬迁或数据路径重命名。以下标识保留：

- Python distribution、import 和可执行命令 `octop`；依赖 `octop-harness`、`octop-gateway` 等。
- `OCTOP_*` 环境变量，`.octop` 数据目录、认证文件与原系统服务。
- API 路由、请求头、localStorage 键、PWA 安装身份和用户 workspace。
- 桌面 productName、应用 ID、可执行文件名、安装位置及 FnOS `appname`。
- 第三方名称、上游归属说明与版权；这些不是应替换的产品显示文案。

因此 wheel 文件名仍是 `octop-*.whl`。安装与升级必须核对 HiveWork 来源、commit 和制品哈希，不能按包名选择官方 Octop wheel。

## 3. 验证记录

所有完整日志、截图、测试报告与临时安装环境在 `logs/hivework-branding/`，该目录不提交。下面区分已通过检查与尚需部署验收的事项。

| 检查               | 结果与证据                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端 Ruff          | `ruff check src tests`、`ruff format --check src tests` 通过；包含新品牌脚本的额外检查通过，1182 个文件无需格式化                                                                                         |
| 后端类型           | `uv run --no-sync mypy src/octop` 通过，570 个源文件                                                                                                                                                      |
| 品牌后端回归       | i18n/更新/API/CLI 相关 271 项通过；Scalar 2 项通过；mobile Docker 安装模块 17 项通过                                                                                                                      |
| Linux 完整后端测试 | 非 live 全套：`4565 passed, 67 failed, 21 skipped`；清理镜像环境变量、使用普通用户、仅在容器副本规范化 shell 换行并修正 FnOS 旧断言后，相关 7 个模块 `191 passed`；逐节点核对原 67 个失败全部通过，遗漏 0 |
| 前端构建           | 默认 `npm run build` 通过，包括 TypeScript、Vite 与 PWA；Windows 使用已有 Node 22 复核                                                                                                                    |
| 品牌前端回归       | 资料、locale、主题与更新设置回归通过；默认专家颜色的旧 rose 断言改为共享默认值，profile 明确断言 amber；品牌/专家颜色复测 16 项通过                                                                       |
| 前端完整测试       | 同 Dockerfile 的 Linux Node 20 环境：244 文件，237 通过、7 失败；1260 项，1256 通过、4 失败。修正品牌断言后，其余 6 个失败文件全部在原始 `544ea757` dashboard 副本复现                                    |
| 品牌资源与归档     | `scripts/check_branding.py --built --wheel <wheel>` 通过，包含 HTML 引用资源检查                                                                                                                          |
| wheel              | `uv build --wheel --out-dir dist` 成功；Python 3.12 的独立 venv 使用 `--no-deps` 安装，`-I` 检查实际 site-packages 的名称、策略、4 份覆盖、SPA/manifest/offline/SW 全部通过                               |
| Docker             | 主 Dockerfile 构建通过；独立 tmpfs 数据目录、无网络/端口映射启动，默认 ENTRYPOINT 的 `/api/health` 返回 200                                                                                               |
| 浏览器             | 隔离 API fixture：中文浅/深色、英文浅色、Logo 实际加载、页面标题与离线页通过                                                                                                                              |
| 源码重装           | 同路径、同版本、未改变 pyproject 时间戳的第二次安装，实际安装包中的 profile 与 SPA 更新通过                                                                                                               |
| 桌面               | Windows `go build` 通过；`go test` 被原有重复声明阻塞，见下文                                                                                                                                             |
| FnOS staging       | Docker/native 有效与拒绝路径共 6 场景通过，派生图标尺寸检查通过；manifest/compose 旧品牌断言已更新，定向 3 项通过，原应用身份、标签与持久挂载断言保留                                                     |
| 工作流             | 新流程及修改的上游发布流程 actionlint 检查通过；FnOS 原有参数问题单独记录                                                                                                                                 |

浏览器冒烟使用构建后 SPA 和隔离的启动状态接口，没有连接真实用户数据或调用 LLM。Docker 启动使用临时数据卷，不构成生产升级验证。

Linux 原始全套与失败模块复跑分别保存报告，未再运行完整套件，因此不表述为“完整套件单轮全绿”。21 个条件跳过用例仍不在本轮验证范围。测试用容器已移除；规范化只作用于容器中的测试副本，没有扩大宿主源文件改动。

### 已知基线问题与环境差异

- 全量前端 ESLint 有 3 个原有错误，位于 `Channels/components/constants.test.ts`、`Chat/hooks/chatStore.ts`、`Models/components/modals/ModelListEditor.tsx`；品牌改动的定向 lint 通过。未借品牌任务修改这些业务文件。
- 原桌面 `filedrop_test.go` 在 75/91 行重复声明 `err`，全量 `go test` 无法通过；本次未改该测试。Windows 桌面编译本身通过。
- 原 FnOS workflow 的 3 处 `download-artifact@v4` 使用不支持的 `if-no-files-found` 参数，基线复现；未扩展本次改造去修复。
- Windows 全量 Vitest 的测试进程崩溃，完整前端测试另在 Linux 容器本地文件系统复核；没有修改项目 Node 版本或锁文件来规避。
- Linux 前端剩余基线失败：`AuthGuard.test.tsx` 的导航断言、`knowledgeBases.test.ts` 缺少 `bridgeAgentHeaders` mock、`publishedExperts.test.ts` 请求体断言过时；`DocumentPreviewCore.docxSanitize`、`skillMarkdown`、`SkillDrawer` 3 个套件缺少 `DOMMatrix`。当前与基线使用相同锁文件哈希；没有修复与品牌无关的业务或测试。
- Windows 非 live 后端全套得到 `4438 passed, 201 skipped, 10 failed, 4 errors`：8 项 shell 测试缺少 Bash 且原测试未应用 POSIX 跳过标记；其余为 worker 崩溃、Argon2 内存分配及子进程读取版本失败。后者按顺序定向重跑为 `7 passed`，没有修改生产代码；完整 Linux 结果另行记录。
- 本机没有 GNU make，按 Makefile 组成执行对应命令；不能据此声称本机运行了 `make all`。

本地 wheel 文件为 `dist/octop-1.0.2b6-py3-none-any.whl`，SHA256 为 `a76d6f8aec79e1e9b9e62a85cc42f5d47feb1928f209298bb54c2c58aef9317e`。这是本工作区未提交代码的审阅产物；未来修改或重建后必须重新记录哈希，不能视为已发布版本。

## 4. 使用与维护

普通构建继续使用原入口：

```sh
npm --prefix dashboard ci
npm --prefix dashboard run build
uv run --no-sync python scripts/check_branding.py --built
uv build --wheel --out-dir dist
uv run --no-sync python scripts/check_branding.py --built --wheel dist/<生成的wheel文件>
docker build -f docker/Dockerfile -t hivework:local .
```

2026-10-12 的 Logo 替换统一使用用户提供的 `hivework-logo-assets/` PNG 素材。Web 与文档中的标志、README 横版图、桌面应用图标和托盘、FnOS 图标均从该目录复制或按目标尺寸派生。兼容路径中的 SVG 仅是嵌入 PNG 的容器，不是真正的矢量图；放大不会增加原始细节。`desktop/src/build/appicon.png` 已替换为橙色 512 px 图标，macOS 使用橙色 1024 px 素材并保留 824/1024 留白规范。

重新生成素材使用现有项目依赖；`build_brand_assets.py` 负责 Web/文档素材，`prepare_platform_branding.py` 负责桌面与 FnOS 素材。以上历史验证与安装包哈希不自动证明本次替换后的构建结果，本次证据保存于 `logs/logo-replacement/`：

```sh
uv run python scripts/build_brand_assets.py
uv run python scripts/prepare_platform_branding.py --generate-assets
```

品牌检查会校验覆盖目标、en/zh 键一致性、插值集合、修改的服务端拥有文案、图标尺寸、产物内容与 wheel 包含项。上游改变文案语义时仍要人工审阅，不能仅凭脚本通过判断适配完成。

同步上游先遵守方案第 12 节，重点审阅 loader、Vite、更新器、安装器与打包/发布接入点。不要把独立品牌资源移回原大型翻译文件，不要在冲突时对整个业务文件统一选择 ours/theirs。

## 5. 正式发行前的验收边界

代码接入与本地审阅制品已交付。正式上线时仍需针对自己的真实部署完成：

1. 备份现有配置、数据库与 workspace，停止实例，安装确切 HiveWork 制品后恢复原启动方式，确认用户、会话与原数据可用。
2. 在已有 PWA 安装上接受 Service Worker 更新，核对缓存素材、启动名、离线页与回滚结果；浏览器 fixture 不覆盖此项。
3. 桌面补齐安装器 ICO/ICNS、签名以及 Windows/macOS/Linux 安装、升级、卸载和数据行为；当前未声明独立应用身份可并存。
4. FnOS 使用已审核的自有镜像标签或本地加载镜像，验证真实 NAS 的 FPK 安装、升级、卸载和数据行为；本机缺少 fnpack/Wails3 发行工具。
5. 需要发布时单独审核自有渠道及 Release 内容；当前流程只归档审阅制品。

以上事项保留为明确的部署/平台验收，不以源码显示、模拟 staging 或编译成功替代。

本轮 Logo 验证记录在 `logs/logo-replacement/`：49 项素材/平台/wheel 校验、前端 10 项定向测试、TypeScript、Ruff、mypy，以及前端、Windows 桌面和 wheel 构建均通过。浏览器核对了浅色主标志、深色反白标志与离线页。后端全量首次为 `4423 passed, 201 skipped, 27 failed, 2 errors`；UTF-8、Git Bash 和串行执行下，29 个失败/错误用例复跑全部通过。未再次执行完整后端套件，不表述为完整套件单轮全绿。本机无 GNU make；仓库全量 Prettier 仍报告 1094 个文件，未借 Logo 替换批量格式化。历史功能截图保留原版本界面示例，文档直接使用的 Logo、横版图和总览图已更新。
