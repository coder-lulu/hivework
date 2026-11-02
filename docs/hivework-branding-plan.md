# HiveWork（蜂巢智工）品牌改造实施方案

> 状态：已按方案完成品牌代码接入；实现、验证证据与平台发行边界见[实施记录](hivework-branding-implementation.md)。
>
> 编制日期：2026-10-11。
>
> 分析基线：本地 `main`，提交 `0c5a46ab`；该基线不代表实时上游最新提交。
>
> 实施基线：拉取后的 `origin/develop`，提交 `544ea757`；本地分支 `feature/hivework-branding`。本次不提交、推送或正式发行。
>
> 目标：将用户可见品牌改为 **HiveWork／蜂巢智工**，尽量减少与 TencentCloud/Octop 上游同步时的冲突，并保持已有配置、数据和客户端兼容。

## 1. 推荐决策

采用 **独立品牌资料 + 少量显示入口接入 + 构建时素材覆盖**。

- 英文产品名：`HiveWork`。
- 中文产品名：`蜂巢智工`。
- 中文产品说明、欢迎语和界面标题使用“蜂巢智工”；需要中英文同时展示时使用“蜂巢智工（HiveWork）”。
- 产品显示品牌与底层技术标识分别管理。品牌改造不要求重命名 Python 包、CLI、数据库或协议。
- 首期完成 Web、API 文档、CLI 展示和源码／wheel／Docker 的一致品牌输出；桌面和 FnOS 按独立阶段验收。
- 使用现有构建命令和默认配置接入品牌，避免只有某个特殊命令才生成 HiveWork。
- 不新增依赖，不建设多品牌管理后台、租户品牌配置、动态换肤服务或通用品牌平台。

“最小合并影响”指降低上游原有文件的改动范围和长期维护成本，不承诺零冲突。独立覆盖文件仍需检查上游新增文案和语义变化。

### 1.1 方案比较

| 方案                                     | 上游合并影响                 | 兼容性和维护成本                           | 决策                             |
| ---------------------------------------- | ---------------------------- | ------------------------------------------ | -------------------------------- |
| 全量将 `Octop/octop/OCTOP` 重命名        | 很高，涉及大量业务与发布文件 | 需要迁移配置、数据、服务和客户端           | 不采用                           |
| 在各页面和原始 locale JSON 中逐项替换    | 中等，大型翻译文件容易冲突   | 初期简单，后续容易遗漏新增入口             | 仅用于无法集中接入的少量显示入口 |
| 构建后批量替换 HTML／压缩 JS             | 源码冲突少，但错误不易定位   | 可能改坏命令、协议、资源哈希和缓存         | 不采用                           |
| 单独品牌构建命令／Vite 包装配置          | 原配置改动少                 | 容易漏接普通 build、Docker、桌面或安装脚本 | 不作为默认方案                   |
| 独立品牌资料 + 默认构建接入 + 加载器覆盖 | 较低，冲突集中于少数接入点   | 可检查、可测试，覆盖文件需要定期维护       | 推荐                             |

## 2. 范围与兼容边界

### 2.1 首期改造范围

| 范围                               | 目标行为                                                  |
| ---------------------------------- | --------------------------------------------------------- |
| 浏览器标题、登录、设置向导、导航   | 按语言显示 HiveWork／蜂巢智工                             |
| 首屏加载、离线页、PWA 安装提示     | React 尚未加载或网络不可用时仍使用正确品牌                |
| Logo、favicon、PWA／Apple 图标     | 浅色、深色、移动端和安装图标保持一致                      |
| 吉祥物、欢迎页、空状态、连接等待图 | 纳入素材清单；发布范围内的 Octop 专属形象应替换或明确移除 |
| 中文、英文产品文案                 | 通过翻译键覆盖，保留插值和原有语言解析规则                |
| API 文档和 CLI 展示                | 产品标题、介绍、欢迎语使用新品牌，命令仍可使用 `octop`    |
| 项目和帮助链接                     | 自有项目入口指向 HiveWork；保留明确标注的上游归属链接     |
| 更新入口与升级说明                 | 不再把官方 Octop wheel 当作 HiveWork 的升级制品           |
| 构建与发行                         | 源码、wheel、Docker 产物均包含同一品牌资料                |

### 2.2 首期保留的技术标识

| 标识                    | 保留内容                                              | 原因                                   |
| ----------------------- | ----------------------------------------------------- | -------------------------------------- |
| Python distribution／包 | `octop`、`src/octop/`、现有 import                    | 避免依赖、安装元数据和大量 import 变化 |
| 外部依赖                | `octop-harness`、`octop-gateway`、`octop-memory` 等   | 它们是实际依赖名称                     |
| CLI                     | `octop` 和现有子命令                                  | 保持脚本与运维入口兼容                 |
| 环境变量                | `OCTOP_*`、`OCTOP_HOME`                               | 保持部署配置兼容                       |
| 数据                    | `~/.octop`、`octop.db`、现有表、public ID             | 不做数据库或用户数据迁移               |
| HTTP／WebSocket         | `/api`、`X-Octop-Access-Token`、`X-Octop-Agent-Id` 等 | 保持客户端与跨实例通信兼容             |
| 浏览器存储和事件        | `octop:*`、现有 `theme` 存储格式                      | 保留登录、活动专家和外观偏好           |
| 服务和数据卷            | 已有 service、unit、容器内路径、卷名                  | 避免升级后找不到原实例数据             |
| 默认专家与渠道          | `general-assistant`、`main`、`octopbot` 等 ID         | 展示名可变，业务标识不随品牌变化       |

Docker 镜像发布地址可以属于 HiveWork 自己的仓库，这与容器内服务名、数据卷名是否变化是不同问题。首期保留现有持久化位置，使用自己的镜像制品。

`OctopBot` 是外部平台名称；外部平台、依赖名称、真实命令、文件路径和示例协议不作无差别替换。原有许可证、版权声明、贡献者和上游归属信息保留。

### 2.3 本轮不做

- 包名、数据库 schema、环境变量和用户数据目录迁移。
- 全仓替换 `Octop/octop/OCTOP`。
- 重写专家库、第三方平台文档和所有历史说明。
- 重置用户已有主题偏好、专家名称、记忆、工作区或 `SOUL.md`。
- 直接编辑 `src/octop/dashboard/` 构建产物。
- 直接发布、推送或修改生产环境。

## 3. 当前代码依据

以下是分析基线中的入口；实施前应按目标分支重新核对，行号可能随上游变化。

| 文件／位置                                                 | 当前行为                                              | 改造用途                                 |
| ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `dashboard/src/App.tsx:63`                                 | `document.title` 来自 `app.pageTitle`                 | 页面标题可以经翻译覆盖                   |
| `dashboard/src/i18n.ts:13`                                 | 统一异步加载 zh／en bundle                            | 前端文案覆盖的主要入口                   |
| `dashboard/src/i18n.ts:43,59`                              | 登录后等场景回填 tools／skills 标签                   | 防止后续回填恢复旧品牌                   |
| `dashboard/src/locales/{en,zh}.json`                       | 产品名散布于多个 namespace                            | 保留原文件，新增品牌键覆盖               |
| `dashboard/src/layouts/Sidebar.tsx:431`                    | 同名浅／深色 Logo 静态路径                            | 同名素材覆盖可以减少组件改动             |
| `dashboard/index.html:29,32,282`                           | Apple 标题、HTML 标题、启动 Logo                      | 需要覆盖 React 启动前的显示              |
| `dashboard/public/manifest.json:1`                         | PWA `id/name/short_name/start_url/scope`              | 区分显示品牌与安装身份                   |
| `dashboard/public/offline.html:71`                         | Logo、alt 和正文含品牌                                | 离线品牌和模板维护入口                   |
| `dashboard/vite.config.ts:92,174`                          | 输出 SPA，并生成 PWA 缓存                             | 默认构建接入与资源时序入口               |
| `dashboard/src/styles/themePalettes.ts:30`                 | 已有默认 palette 和 amber 等主题                      | 复用现有主题机制                         |
| `src/octop/i18n/loader.py:25`                              | 读取包内 locale JSON 并缓存                           | 后端文案覆盖的主要入口                   |
| `src/octop/api/app.py:110,307`                             | FastAPI 与 Scalar 标题写死                            | API 文档产品名接入                       |
| `src/octop/api/openapi_meta.py`                            | API 介绍与标签说明                                    | 修改产品文案，保留真实协议说明           |
| `src/octop/cli/registry.py`、`cli/repl/render.py`          | help／欢迎语直接包含产品名                            | CLI 显示层接入                           |
| `src/octop/infra/setup/self_update.py:25,413,846`          | 查找并安装 PyPI `octop`                               | 品牌发行的升级保护入口                   |
| `docker/Dockerfile:53,58,115`                              | 前端阶段仅复制 dashboard，后续才复制 src              | 需要显式提供共用品牌资料                 |
| `pyproject.toml:100`                                       | wheel 打包 `src/octop` 及 JSON 等资源                 | 包内品牌资料可以复用现有打包规则         |
| `desktop/src/build/config.yml`、`desktop/src/main.go`      | 安装元数据、窗口和托盘使用 Octop                      | 桌面阶段的展示入口                       |
| `desktop/src/build/windows/nsis/project.nsi:55`            | 安装目录由产品名派生                                  | 桌面改名会涉及升级和安装行为             |
| `fnos/{docker,native}/manifest`                            | 显示名与内部 appname 同时存在                         | FnOS 展示名与运行身份分别处理            |
| `scripts/install.sh`、`scripts/install.ps1`                | 本地源码以普通包方式安装，已有 SPA 时可能跳过构建     | 区分源码目录与实际运行包，检查旧产物复用 |
| `.github/workflows/auto-tag-on-release.yml`、`release.yml` | main 合并后自动打标并级联发布，Release 依赖 PyPI 发布 | 在 fork 中隔离继承的官方外发链           |

默认通用专家当前展示名是“小通 · 通用助手／Main · General Assistant”，不是所有助手文本都叫 Octop。品牌扫描应按真实用户可见内容判断，不能机械替换全部专家名称。

## 4. 建议目录与模块设计

以下是拟新增结构，不是已经存在的实现：

```text
src/octop/branding/
  __init__.py              品牌资料读取与极小的显示名 helper
  profile.json             中英文名称、项目链接、上游链接、升级策略
  frontend.en.json         前端已有翻译键的英文覆盖
  frontend.zh.json         前端已有翻译键的中文覆盖
  backend.en.json          后端已有翻译键的英文覆盖
  backend.zh.json          后端已有翻译键的中文覆盖

dashboard/branding/
  plugin.ts                默认 Vite 构建接入与 public 目录合成
  assets/                  HiveWork 原始 Logo、图标、吉祥物等素材

dashboard/src/branding.ts  前端显示名与覆盖 bundle 的薄适配
scripts/check_branding.py 品牌资料、覆盖键及构建产物检查
docs/hivework-branding-plan.md
```

### 4.1 资料的单一来源

将名称、链接和翻译覆盖放在 `src/octop/branding/`，原因是它既是仓库源码，也能随 Python wheel 进入安装环境。前端构建读取同一目录，不再维护一份独立产品名常量。

- Python 使用包内资源读取，兼容源码／editable 和安装后的 wheel。
- Vite 在配置阶段读取资料，向前端提供有类型的品牌数据；不新增必须先请求成功的品牌 HTTP API。
- 如采用 Vite `define` 注入数据，Vitest 也必须使用同一资料注入；当前 `vitest.config.ts` 独立于正式构建配置，不能假定会继承品牌插件。
- 原始视觉素材放在 dashboard 的品牌目录；最终 SPA 素材随已有 dashboard 打包规则进入 wheel。
- 不要求 Python wheel 再打包一份未使用的 SVG／WebP 原始素材；如实际需要，明确增加对应打包规则，不依赖隐含包含。
- `branding` 模块只读取不可变资料，不访问数据库、agent workspace、HTTP 或 CLI，不引入领域编排。

`profile.json` 的最小资料示意：

```json
{
  "id": "hivework",
  "name": { "en": "HiveWork", "zh": "蜂巢智工" },
  "repository_url": "https://github.com/coder-lulu/hivework",
  "upstream_repository_url": "https://github.com/TencentCloud/Octop",
  "support_url": null,
  "allow_official_self_update": false
}
```

该文件是构建和发行资料，不是新增用户配置接口。名称和项目链接已知；独立帮助地址尚未提供，不虚构域名，可以先使用项目 Issues。品牌色和 Logo 设计在视觉阶段确定，amber 可作为候选，不视为已经批准的设计。

### 4.2 覆盖文件原则

- 只覆盖与产品品牌直接相关的现有键，保持原始 locale JSON。
- 同一类内容由其现有所有者管理：后端错误、tools、skills 继续由后端拥有；前端 chrome 继续由前端拥有。
- 全局品牌名称来自 profile；整句覆盖文案仍按 zh／en 分别审阅，避免用简单字符串替换生成不自然的句子。
- 后端 `{name}` 与前端 `{{name}}` 的插值语法分别保持，不能混用。
- 仅当新增了明确的产品文案，才增加新的翻译键；保持两种语言的键树一致。

## 5. 前后端文案接入

### 5.1 前端加载顺序

统一通过 `loadLocaleBundle(locale)` 完成：

1. 加载上游原始 bundle。
2. 按键合并对应语言的 HiveWork 覆盖。
3. 把合并后的 bundle 交给首次 `init()` 或 `ensureLocaleBundle()`。
4. 服务端标签回填继续正常执行；服务端负责返回自己的品牌文案。

不要只在初始化完成后执行一次资源覆盖。该做法会漏掉尚未加载的语言、fallback 和后续服务端回填。

如品牌影响 tools／skills，必须在后端实际标签生成／返回路径上验证，再同步前端 fallback。`tests/unit/i18n/test_tools.py` 当前要求前后端 tools 对象值一致；errors 测试要求键和插值兼容。新增测试应检查实际合并后的结果，不能只检查未覆盖的原始 JSON。

### 5.2 后端加载顺序

在 `src/octop/i18n/loader.py` 的包内读取入口合并 backend 覆盖，再沿用现有 lookup、fallback 和缓存机制。

- 不在每个业务函数中重新扫描或替换文本。
- 品牌资源读取复用现有一次加载和缓存方式，不在热路径增加阻塞文件 I/O。
- API 错误、IM 回复和 CLI 文案使用已有 locale 解析规则，不新增 `config.json` 语言字段。
- 对 tools／skills 等非单纯经过 `tr()` 的路径，按调用链补齐真实返回值检查。

### 5.3 硬编码文案与品牌名字

有限修改以下显示入口，使用已有翻译机制或品牌显示 helper：

- `Sidebar.tsx`、登录、设置向导的 Logo `alt`。
- `PwaInstallPrompt/index.tsx` 的安装指南与浏览器菜单提示。
- `WelcomeScreen.tsx` 的吉祥物无障碍名称。
- `CandidatesReview.tsx` 等未经过翻译的品牌文案。
- API app／Scalar 标题、OpenAPI 介绍、CLI help／欢迎语／版本展示。
- `AvatarDropdown.tsx` 的项目与帮助链接。

已经写成 `t(key, fallback)` 的页面，优先覆盖对应键；不为替换未生效的 fallback 而扩大源码改动。仍需检查新增／缺失 key 导致 fallback 实际生效的情况。

版本展示采用“产品品牌 + 当前底层版本”。首期保留上游 Python 版本来源，不人为制造第二套运行时版本解析；发行记录额外记录 HiveWork commit、构建标记和所基于的上游 commit，便于支持与回滚。

### 5.4 默认专家与已有用户

- `general-assistant`、setup 的 `main` 等业务 ID 保留。
- 需要品牌欢迎语时，在默认展示／新建 seed 边界接入，保持其他专家模板行为。
- 不重写所有专家 manifest，不扫描修改已有 workspace 内容。
- 既有用户自行设定的专家名称、人格和 `SOUL.md` 保留。
- 如将来需要迁移已有默认名称，另写条件明确、可回滚的迁移方案；不包含在本计划首期。

## 6. 视觉资源与默认构建接入

### 6.1 素材清单

| 资源               | 现有消费路径                                                                    | 交付要求                                                    |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 横向 Logo          | `logo_horizontal_dark.png`、`logo_horizontal_white.png`                         | 浅／深色清晰，保留消费路径                                  |
| 纵向／启动 Logo    | `logo_vertical_dark.svg`、`logo_vertical_white.svg`                             | 启动和离线状态一致                                          |
| favicon            | `favico.svg`                                                                    | 注意现有名称是 `favico`，不要误建成无人引用的 `favicon.svg` |
| PWA 图标           | `pwa-192.png`、`pwa-512.png`                                                    | 分辨率、透明度和 maskable 安全区验证                        |
| Apple 图标         | `apple-touch-icon.png`                                                          | 安装到主屏后的清晰度验证                                    |
| 空状态／欢迎／等待 | `octop-mascot-empty.png`、`octop-mascot-peek.webp`、`octop-mascot-type.webp` 等 | 按实际引用替换或移除，不能仅改文件名                        |
| 其他动画与素材     | `.webm`、tasks 图片及其他实际引用                                               | 建立引用清单后处理，避免遗漏与错误删除                      |

同名消费路径是首期减少组件修改的兼容策略，用户不需要看到资源文件名变为 HiveWork。新增素材的源文件独立保存，不直接覆盖上游 `dashboard/public/` 中的原图。

### 6.2 构建时序

默认 Vite 配置接入品牌插件，插件在配置阶段准备完整 public 目录，顺序如下：

1. 从当前仓库的 `dashboard/public/` 合成基础资源。
2. 应用 HiveWork 同名素材覆盖。
3. 对 manifest 做字段级修改；对 offline HTML 做明确目标的文案／样式覆盖。
4. 将合成目录作为 Vite 的 `publicDir`，再开始 dev／build。
5. 对入口 `index.html` 应用品牌 HTML 转换。
6. 由原有 Vite／PWA 构建生成 SPA、缓存 revision 和 Service Worker。

构建暂存目录使用项目 `logs/hivework-branding/public/`；开发和并发 CI 构建使用各自任务子目录，避免相互覆盖。目录已被现有 `logs/` 忽略规则覆盖。只清理本次生成、路径已确认的暂存目录。

`manifest.json` 与 `offline.html` 是 public 资源，不会自动经过 `transformIndexHtml`。它们必须在合成 public 时处理；HTML 入口 hook 只负责 `index.html`。

不得在 Workbox 生成后替换 Logo／PWA 图标，也不得直接修改压缩后的 JS。每次配置启动都从最新上游 public 模板合成，避免复制整份模板形成长期分叉。

### 6.3 HTML 与 manifest 覆盖契约

- `index.html`：覆盖 `<title>`、Apple 应用标题和必要的启动展示字段，保留启动主题、旧 chunk 恢复等原逻辑。
- `offline.html`：覆盖页面标题、Logo alt、正文中的产品名和经确认的品牌色。
- HTML 覆盖目标要求唯一且可验证；若上游结构变化或目标消失，构建失败并提示具体文件和目标，不静默跳过。
- manifest：覆盖 `name`、`short_name`、description 和经确认的视觉字段；继承其他上游字段。
- 同一 origin 的原地升级保留 `id: "/"`、`start_url: "/"`、`scope: "/"`。
- 静态 manifest 初期使用“蜂巢智工（HiveWork）”作为完整安装名，短名称使用“蜂巢智工”；Web 内部文案仍按 zh／en 切换。动态 manifest 本地化不包含在首期。
- 若未来变更域名、部署子路径或让两个 PWA 并存，重新设计安装身份，不把本规则直接外推。

### 6.4 默认色与既有偏好

复用现有 palette／custom color 机制。品牌默认色只影响没有保存偏好的新安装，不覆盖现有 `theme`／palette。

启动页、离线页和主题默认色要一并检查，避免 React 加载前后颜色突变。视觉设计确定后再选用现有 palette 或 custom color；不遍历重写所有 Less 文件中的颜色。

### 6.5 PWA 更新验收

当前 Service Worker 采用等待用户接受更新的流程。不能承诺已有安装在发布后立刻换名或换图。

至少验证新安装、已有安装接受更新、离线启动、浅／深色和移动端。若固定路径素材仍受旧缓存影响，优先按资源类别修正 revision／缓存策略；必要时引入有限的素材版本标记，不借品牌改造重写整个 PWA。

## 7. 发行与更新保护

### 7.1 当前风险

`self_update.py` 固定查询 PyPI `octop`，`package_requirement()` 返回 `octop`／`octop==版本`，随后通过 uv／pip 安装官方 wheel。

保留内部包名不会保护品牌代码。定制 Python 代码、locale 覆盖和内置 SPA 都随 wheel 发布时，官方 wheel 可能将它们整体替换回上游版本。

editable 安装在 API／CLI 已有提示或阻止分支，但 wheel、桌面便携包和 FPK 仍需明确的品牌发行策略。

### 7.2 首期策略

- editable 源码部署：更新 HiveWork 仓库的已验证发布版本，重新构建 SPA，按需要同步依赖，再重启实际运行进程。
- 普通源码安装：现有 source installer 使用 `uv pip install` 安装本地路径，没有 `-e`。更新工作区和重建 SPA 后，还必须把目标版本重新安装到实际运行的 venv／包目录，确认加载路径和版本，再重启；仅 `git pull` 和重启不会更新已安装的 Python 包。
- Docker：使用 HiveWork 自己构建的镜像，不指向官方 Octop 镜像作为品牌升级目标；保留数据卷和配置。
- wheel：由 HiveWork 发布自己的构建制品，使用明确的下载／部署说明；首期不让官方 PyPI `octop` 安装充当品牌升级。
- 在共享 `run_upgrade()` 开始处检查品牌发行策略，覆盖普通 venv、Windows、FPK 等分支；检查发生在网络安装、console script 暂存／重命名或其他升级副作用之前。
- 拒绝原因使用现有本地化文案体系，API 和 CLI 对用户给出一致的 HiveWork 升级指引。
- 更新 UI 显示真实渠道和状态；官方 Octop 最新版本只能作为上游参考，不显示成可安装的 HiveWork 最新版本。
- 同步修订手动升级指南中的官方 installer、`pip install -U octop` 和官方镜像说明，避免用户按产品指引覆盖定制版本。

阻止范围是产品自身的 API／CLI 升级动作，不能阻止用户在外部终端自行执行 pip 命令。发行说明必须说明内部包名和实际制品来源。

### 7.3 安装入口

尽量复用现有源码安装支持，不先重写长安装脚本。现有 `scripts/install.sh` 和 `install.ps1` 支持 `OCTOP_REPO`，可以指向 HiveWork fork。

注意 shell 安装器会默认从 `OCTOP_REPO` 的组织路径派生 harness／gateway／browser 仓库地址。指向 `coder-lulu/hivework` 时，不得假定该账号已有全部依赖仓库；需核对并显式使用实际依赖源或现有 PyPI 安装路径。采用哪个安装模式必须有实际验证。

新增 HiveWork 安装说明优先于复制整套上游安装器。必要的薄入口只能负责已验证的仓库／制品选择和显示文案，不复制依赖安装和系统服务逻辑。

两个现有 source installer 在 `src/octop/dashboard/index.html` 存在时可能直接跳过前端构建。文件存在不代表它是 HiveWork，也不代表匹配当前源码。首期自有安装流程应先显式执行默认品牌构建并检查产物，再把已验证的源码目录交给现有安装器；已有 source dir、首次克隆和更新都纳入验证。不能只设置 `OCTOP_REPO` 就认定安装完成。

安装验收必须检查实际运行环境中的包和 SPA，区分“工作区源码已更新”和“服务加载的包已更新”。

### 7.4 继承发布工作流隔离

当前 fork 继承的发布链不是新增一个 HiveWork workflow 就会消失：

- `auto-tag-on-release.yml` 在 release／hotfix PR 合入 main 后自动打 tag，并显式 dispatch Release、Docker、Desktop 工作流。
- `release.yml` 把发布 PyPI `octop` 作为创建 GitHub Release 的前置条件；首期保留内部 distribution 名，不代表可以向上游 PyPI 项目发布。
- `docker-publish.yml` 仍生成 Docker Hub `${DOCKERHUB_USERNAME}/octop`，并不自动对应 HiveWork 的自有发行位置。
- 桌面和 FnOS 的发布入口需单独核对，首期 Web 发行不能意外触发尚未验收的平台制品。

P3 在第一次 fork 发版之前完成以下工作：

1. 在继承的官方外发工作流入口增加明确的仓库／发行条件，使上游官方渠道只在其原仓库运行；保留普通测试和代码检查。
2. 同时检查 tag push、`workflow_dispatch`、PR 合并后的显式 dispatch 等入口，不能只修改某一个触发器。
3. 保留上游流水线的主体实现，fork 的入口限制尽量小；不依赖缺少 secrets 或权限让旧链失败。
4. 建立独立 HiveWork 发布入口，使用实际归属的 GitHub 制品／镜像位置，仅发布已通过验收的发行方式。
5. 核验新的触发图、制品目标和版本标识，再允许发布 tag；本计划本身不执行打标或发布。

保留 `release/*` → `main` 分支约定，但调整其 fork 中的外发行为。自动打标、创建 GitHub Release 和上传到 PyPI／镜像仓库是不同动作，应分别明确允许的目标与条件。

### 7.5 后续自有自动更新

自有更新服务不属于首期强制范围。启用前应明确版本查询来源、下载来源、可安装制品、错误处理和回滚策略，并分别验证 wheel、Docker、桌面和 FPK。不得仅替换一个 URL 就宣称各发行方式支持自动升级。

## 8. 打包、Docker、桌面与 FnOS

### 8.1 源码与 wheel

- 源码运行和安装后的 wheel 都从包内加载品牌资料，不能依赖安装机存在仓库根目录。
- 使用现有 build 流程生成 `src/octop/dashboard/`；此目录是产物，不直接手写修改。
- 检查 wheel 中存在 profile、覆盖 JSON、最终 HTML／manifest／图标。
- 打包后的安装验证在项目 `logs/hivework-branding/` 下的隔离环境执行，运行数据使用测试目录的 `OCTOP_HOME`。
- 验证普通 `--from-source`／`-FromSource` 安装后的实际包，再验证更新时重新构建和重新安装；不能用 editable 环境替代全部源码安装验收。
- 不修改 distribution 名与依赖 lockfile 来实现显示品牌；如打包规则确实漏资源，做最小范围修正。

### 8.2 Docker

当前前端阶段先 `COPY dashboard/`，品牌资料拟放在 `src/octop/branding/`，所以在前端构建前增加精确的目录复制，保持与本地构建的相对路径一致。

- `npm run build:docker` 仍经默认 Vite 配置接入品牌。
- 默认构建跳过完整 tsc，不能把 Docker 构建成功当作前端类型检查通过。
- 运行时保留 `OCTOP_*`、`HOME=/data`、现有挂载位置和服务入口。
- OCI title／description／source 可以标注 HiveWork 和其仓库；保留许可证与上游归属。
- 镜像仓库属于 HiveWork；品牌发行 workflow 单独维护，复用现有构建方式，避免大范围改写上游发布流水线。
- 独立 workflow 启用前先完成 §7.4 的继承发布链隔离，核对 GHCR／Docker Hub 实际目标，避免仍向旧的 `octop` 仓库上传。
- smoke test 检查页面、API、品牌资料和一个已有数据实例升级后的可用性。

### 8.3 桌面

桌面是独立验收阶段，修改入口包括 `desktop/src/build/config.yml`、`main.go`、平台图标和实际生成的安装元数据。

先分别确定两个场景：

| 场景                             | 身份策略                           | 必须验证                                   |
| -------------------------------- | ---------------------------------- | ------------------------------------------ |
| 同一安装原地品牌升级             | 评估保留现有身份和数据位置         | 旧安装被正确升级，卸载信息和快捷方式不重复 |
| HiveWork 独立安装／与 Octop 并存 | 使用归属于 HiveWork 的独立应用身份 | 两个应用不覆盖彼此，数据隔离策略明确       |

`com.tencent.octop` 不是可以永远保留或随意替换的通用规则，选择取决于发行场景。安装身份、签名、可执行文件名、数据目录和更新渠道应一起检查。

Windows NSIS 的安装目录／快捷方式由产品名派生，macOS 的 executable 必须与实际二进制匹配。不能仅修改一个显示字段就认定桌面升级兼容。

### 8.4 FnOS

- 展示名和应用中心标题可改为“蜂巢智工”，保留首期 `appname`、Application 入口和现有数据目录。
- `FPK_NAME_PREFIX` 可用于品牌产物前缀，复用现有机制。
- Docker 版 FPK 需引用 HiveWork 自有镜像制品；native 版需包含品牌 wheel／SPA。
- FPK 安装、原地升级和数据保留分别验收；独立并存发行另做身份方案。

## 9. 预期文件改动清单

文件清单是实施边界，不是承诺所有文件必须修改。能够通过已有入口完成的内容不再改动消费页面。

| 文件／目录                                                                                  | 预期改动                                | 合并注意事项                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `src/octop/branding/`                                                                       | 新增 profile、覆盖文案、极小读取 helper | 新文件为主，低直接冲突                   |
| `dashboard/branding/`                                                                       | 新增构建插件和品牌素材                  | 不覆盖上游原始素材文件                   |
| `dashboard/src/branding.ts`                                                                 | 新增前端适配                            | 保持小型静态接口                         |
| `dashboard/vite.config.ts`                                                                  | 少量品牌插件接入                        | 保留 PWA、proxy、chunk 和原有环境解析    |
| `dashboard/vitest.config.ts`                                                                | 如使用构建注入，补同源品牌测试配置      | 正式构建与测试配置分别验证               |
| `dashboard/src/i18n.ts`                                                                     | bundle 返回前合并                       | 保留语言解析与 hydration 行为            |
| `src/octop/i18n/loader.py`                                                                  | 包内 JSON 加载时合并                    | 保留缓存、fallback 和 lookup 语义        |
| `dashboard/src/layouts/Sidebar.tsx`、Login／Setup 等                                        | 少量 alt／硬编码显示名接入              | 不重写布局或业务逻辑                     |
| `PwaInstallPrompt`、`WelcomeScreen` 等                                                      | 安装提示和无障碍品牌                    | 只修改实际品牌显示                       |
| `dashboard/src/components/AvatarDropdown.tsx`                                               | 自有项目与帮助链接                      | 外部平台入口保持真实来源                 |
| `dashboard/src/styles/themePalettes.ts` 或现有外观入口                                      | 如已确定视觉，调整新安装默认色          | 保留已保存用户偏好                       |
| `src/octop/api/app.py`、`openapi_meta.py`                                                   | API／Scalar 展示品牌                    | 保留协议字段和可读 schemas               |
| `src/octop/cli/main.py`、`registry.py`、`repl/render.py`                                    | 产品展示名                              | 命令名、脚本入口和路径不变               |
| `self_update.py` 与 update API／CLI／UI                                                     | 共享升级保护和渠道说明                  | 升级保护是发布前必需工作                 |
| `docker/Dockerfile`                                                                         | 品牌资料 COPY 和显示 metadata           | 不改数据挂载与运行入口                   |
| `.github/workflows/auto-tag-on-release.yml`、`release.yml`、`docker-publish.yml` 等外发入口 | fork 发布条件和平台级联隔离             | 保留上游主体，只限制错误渠道和未验收平台 |
| 独立 HiveWork 发布 workflow                                                                 | 发布自己的已验证制品                    | 不默认依赖 PyPI `octop` 发布             |
| `scripts/check_branding.py`                                                                 | 覆盖与产物检查                          | 工具输出到 logs，不扫描用户文件          |
| i18n、update、API 和前端相关测试                                                            | 锁定实际行为与兼容边界                  | 测试环境不得写入真实 OCTOP_HOME          |
| 桌面／FnOS 显示与打包文件                                                                   | 后续阶段按平台处理                      | 不混入第一批 Web 改造                    |
| HiveWork 安装／发行说明                                                                     | 新增自有部署和升级说明                  | 尽量保留上游参考文档                     |

原始 `dashboard/src/locales/*.json`、`src/octop/i18n/*.json` 默认不修改。新增错误键／文案确实需要改原文件时，按 i18n 约定同步两端及语言，不为了“零原文件 diff”破坏现有所有权规则。

## 10. 实施阶段与交付物

| 阶段              | 工作                                                                     | 交付物                             | 完成条件                                                              |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| P0：基线          | 从目标分支复核入口、记录 commit、运行适当现有回归                        | 品牌清单、兼容清单、基线检查结果   | 基线问题与本次问题可区分，实施不依赖本机偶然状态                      |
| P1：资料与加载    | profile、前后端覆盖、名称 helper、实际加载测试                           | 中英文品牌资料和稳定加载入口       | 首次加载、切换、fallback、hydration 均有验证                          |
| P2：完整 Web 展示 | Logo／图标／吉祥物、默认插件、HTML／manifest／offline、硬编码显示入口    | 本地开发和正式 build 的品牌 Web    | 主要可见界面和无障碍名称一致，技术标识保持                            |
| P3：发行保护      | 共享更新限制、普通源码重装、继承发布链隔离、API／CLI、wheel／Docker 接入 | 具有明确安装、升级与发行来源的制品 | API／CLI 升级副作用被阻止，实际安装包品牌可用，外发渠道和平台范围正确 |
| P4：发布验收      | 综合检查、已有数据升级、PWA 更新与回滚                                   | Web／源码／wheel／Docker 验收记录  | 全部首期验收通过或明确缩小发行范围                                    |
| P5：平台发行      | 桌面和 FnOS 展示、身份选择、打包升级                                     | 对应平台品牌制品及验收记录         | 逐个平台验证安装、升级、卸载和数据行为                                |

建议按阶段形成小型独立提交。名称／文案、素材／构建、升级保护、平台打包分别可审阅；不能以 P1 页面改名作为全部品牌改造完成。

只有源码部署经验证时，应标注“源码版已完成”，不能将未验证的 wheel、Docker、桌面或 FnOS 同时标记完成。

## 11. 验证与验收标准

以下命令属于未来实施的验证要求，本方案编写时没有执行这些产品测试。

### 11.1 自动化验证

| 检查             | 命令／方式                                                                                                                                                                | 证明内容                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 现有 i18n 回归   | `uv run pytest tests/unit/i18n -q`                                                                                                                                        | 两种语言、错误键、tools 所有权规则未破坏                    |
| 品牌行为测试     | 拟新增 `tests/unit/branding/` 与 `dashboard/src/branding.test.ts`                                                                                                         | profile、实际合并、语言切换和模板覆盖                       |
| 升级保护回归     | `uv run pytest tests/unit/infra/setup/test_self_update.py tests/unit/cli/test_update_cmd.py tests/unit/api/test_update_router.py tests/integration/test_update_api.py -q` | CLI／API 不能绕过策略，安装／脚本重命名无副作用             |
| API 文档回归     | `uv run pytest tests/unit/api/test_openapi_meta.py -q` 并检查 `/api/docs`                                                                                                 | 标题、介绍、schemas 和协议说明正确                          |
| 后端 ship bar    | `make all`                                                                                                                                                                | 格式、lint、类型检查与非 live 测试                          |
| 前端类型         | 在 `dashboard/` 执行 `npx tsc -b`                                                                                                                                         | 前端和构建接入类型正确                                      |
| 前端检查         | 在 `dashboard/` 执行 `npm run lint`、`npm run format:check`、相关 `npm run test -- ...`                                                                                   | 改动质量与品牌加载行为                                      |
| 正式前端         | `make build-frontend`                                                                                                                                                     | 默认入口生成品牌 SPA；不会只在特殊命令生效                  |
| Docker 前端路径  | `npm run build:docker`／镜像实际构建                                                                                                                                      | 当前跳过 tsc 的发行路径也加载品牌                           |
| 包内资源         | 构建 wheel、检查归档并隔离安装                                                                                                                                            | profile、locale、SPA、图标随发行物存在                      |
| source installer | 分别测试新目录安装、已有目录带旧 SPA 安装、更新后重装                                                                                                                     | 不复用错误品牌产物，实际运行 venv 已加载目标版本            |
| 发布链检查       | 检查所有触发／dispatch 入口与制品目标，测试环境核验构建与归档                                                                                                             | fork 不发布上游 PyPI 包，不上传旧镜像目标，不级联未验收平台 |
| 品牌扫描         | 拟新增 `uv run python scripts/check_branding.py`                                                                                                                          | 覆盖键、占位符、素材、HTML 和产物一致                       |

Vitest 当前只发现 `src/**/*.test.ts(x)`。插件测试应由该范围内的测试导入插件 helper；如确有必要扩大范围，最小修改测试配置。不要把测试放在 `dashboard/branding/` 后误以为默认 test 命令会执行。

品牌扫描必须区分显示内容与技术标识：

- 覆盖键存在，两个语言的对应键与占位符兼容。
- profile、前端实际 bundle、后端实际结果名称一致。
- 标题、安装名、Logo／图标和必需素材可用。
- 已知用户可见品牌入口不存在非预期 Octop 显示。
- 允许真实包名、CLI、API 头、路径、平台名和归属信息出现 Octop。
- 不以“整个 JS bundle 搜不到 octop”作为验收标准。

### 11.2 手工／浏览器验收

| 场景                       | 要检查的结果                                                  |
| -------------------------- | ------------------------------------------------------------- |
| 未登录首次打开             | HTML 标题、首屏 Logo、登录页、设置向导正确                    |
| zh／en 切换                | 产品名随界面语言变化，无异步回填恢复旧文案                    |
| 浅／深色、窄屏、侧栏折叠   | Logo 清晰、不变形、不因文字长度溢出                           |
| 欢迎、空列表、远程连接等待 | 品牌形象一致，alt／aria-label 不遗漏                          |
| 首次 PWA 安装              | 名称、图标、启动和导航范围正确                                |
| 已有 PWA 接受更新          | 新品牌可见，登录与数据正常，不强制假定所有浏览器立即更新      |
| 离线启动／断网             | 离线正文、Logo、重连入口正确                                  |
| API 文档                   | FastAPI 和 Scalar 标题一致，路由 schemas 可读                 |
| CLI                        | welcome／help／version 使用新品牌，原命令和参数正常           |
| 原配置与数据启动           | 数据库、专家、会话、凭证、workspace 路径保持可用              |
| wheel 与 Docker            | 干净环境运行，品牌资料不依赖开发机源码目录                    |
| 普通源码安装与更新         | 已验证的品牌 SPA 被安装到真实运行包；更新后加载路径与版本正确 |
| API／CLI 升级              | 不能按官方 Octop wheel 执行品牌升级，提示与文档一致           |

浏览器范围以项目实际支持的平台为准；包含已有 Chromium PWA 和 Safari／iOS 的相关安装场景。无法验证的平台应在发行记录中列明，不视为自动通过。

日志、截图、构建报告和临时验证环境统一放入 `logs/hivework-branding/`；产品必需的 build 输出仍放在其原有目录。

## 12. 上游同步策略

### 12.1 分支与提交

- 按仓库约定从 `develop` 建立 `feature/hivework-branding`；本计划不立即切换或修改分支。
- `upstream` 继续指向 TencentCloud/Octop，`origin` 指向 HiveWork fork。
- 日常 feature 合入 `develop`，生产发行遵循 `release/*` → `main`；不绕过现有分支约定。
- 独立保存品牌资料和素材；原有文件只保留必要的接入代码。
- 不大规模 rename，不顺便清理业务代码，不重格式化无关文件，不改依赖来完成品牌显示。
- 品牌构建和平台发行提交分别维护，保留可回滚边界。

### 12.2 每次同步上游的检查顺序

1. 记录同步前 HiveWork commit、目标上游 commit 和当前发行方式。
2. 获取上游引用，按对应集成分支合并，遵守生产分支工作流。
3. 检查接入文件：前后端 i18n、Vite、API 文档、update、Docker COPY、source installer 和发布入口限制。
4. 检查被覆盖翻译键的上游原文是否变化，即使合并没有文本冲突也要判断语义是否过时。
5. 检查新增产品文案、品牌硬编码、新 Logo／吉祥物和新安装入口。
6. 运行品牌检查、相关回归和 ship bar，重新构建实际发行制品。
7. 记录品牌适配结果、上游版本、已验证的平台和剩余差异。

处理冲突时保持上游功能变化，再重新接入小型品牌调用；不对整个文件统一使用 ours／theirs。检查工具应报告覆盖目标变化，不能用静默 fallback 掩盖丢失的品牌接入。

### 12.3 易变化的位置

| 位置                   | 维护重点                                                            |
| ---------------------- | ------------------------------------------------------------------- |
| locale JSON 与 UI 页面 | 新增文案、覆盖键改名、语义变化                                      |
| Vite／PWA／HTML        | public 合成时序、模板结构、缓存 revision                            |
| 更新器与安装脚本       | 新升级分支是否绕过品牌策略，旧 SPA 跳过构建和普通源码重装是否仍正确 |
| Docker／wheel 构建     | 资料 COPY、包含规则、默认构建入口                                   |
| 桌面／FnOS 发布        | 应用身份、产物命名、上游升级流程                                    |
| GitHub 发布链          | 新触发／dispatch 是否绕过 fork 隔离，实际外发目标与平台范围         |

## 13. 回滚与主要风险

### 13.1 回滚规则

- 首期没有数据库迁移或数据目录改名，回滚使用上一份已验证 HiveWork 源码／wheel／镜像。
- 回滚产品版本时保留用户数据，不执行卸载清理、删除 workspace 或重置配置。
- 保存每次发布对应的源码 commit、上游 commit 和制品标识，避免只记录可变的 `latest`。
- PWA 回滚也需重新构建与更新 Service Worker，不通过直接覆写旧 dist 文件解决。
- 撤销品牌构建接入时同步撤销其调用和资源依赖，避免代码仍引用不存在的资料。
- 桌面／FnOS 的身份或数据策略变化不适用上述简单回滚，按平台验收记录单独处理。

### 13.2 风险与处理

| 风险                                       | 处理                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| 只改首页，启动／离线／安装状态仍显示 Octop | 按场景清单验收，分别处理入口 HTML 和 public 模板       |
| 英文／fallback 或服务端回填恢复原文案      | 覆盖在统一 loader，后端拥有的标签由后端负责            |
| 上游文案语义变化但品牌覆盖没有冲突         | 同步时审阅被覆盖键的上游差异                           |
| 只有特殊构建生成 HiveWork                  | 接入默认配置，验证 Makefile、Docker、wheel 和平台打包  |
| 包内品牌资料遗漏                           | 归档检查和隔离安装验证                                 |
| 官方自更新替换品牌代码                     | 共享升级服务在副作用前限制，提供自有发行说明           |
| 缓存导致旧 Logo／名称残留                  | 接受 SW 更新和已有安装验收，必要时有限修正素材缓存     |
| 修改应用名导致桌面重复安装或身份冲突       | 原地升级与独立并存分别设计、分别验证                   |
| 更改源码安装仓库后依赖地址派生错误         | 核对现有 installer 模式和实际依赖源                    |
| source installer 复用旧 SPA 或只更新工作区 | 安装前构建并检查品牌，普通安装更新后重装到实际运行环境 |
| 上游发布链仍向原包／镜像渠道外发           | fork 入口条件与独立发布链同时验证，不依赖 secrets 缺失 |

## 14. 完成定义与待落定事项

首期完成需要同时满足：

- 中英文 Web、启动、离线、安装提示和发布范围内的形象使用正确品牌。
- 前后端和安装后的制品从同一品牌资料得到一致输出。
- 原有包、命令、协议、配置、数据与用户偏好兼容。
- API／CLI 的官方 wheel 升级路径不会覆盖品牌版本。
- 普通源码安装的真实运行包已更新，继承发布链不会外发到错误渠道或未验收平台。
- 相应自动化检查与实际发行方式验证通过；未覆盖的平台明确列出。
- 已有安装升级与回滚方式有验证证据。
- 改动限于品牌需求，生成产物和诊断文件放在约定目录。

以下事项的实施结果与剩余发行边界详见[实施记录](hivework-branding-implementation.md)：

| 事项                           | 当前实施结果／后续验收                                           | 所属阶段                    |
| ------------------------------ | ---------------------------------------------------------------- | --------------------------- |
| Logo、吉祥物、品牌色、产品介绍 | 已提供蜂巢 Logo、小蜜蜂和科技蓝默认主题；保留用户既有偏好        | P2 已接入                   |
| 帮助／反馈地址                 | 使用 HiveWork 项目 Issues，无自定义域名                          | P2 已接入                   |
| 自有 wheel／镜像发布位置       | 已构建本地审阅制品；手动 Actions 归档，不上传 PyPI／镜像仓库     | P3 已接入，正式渠道待发行   |
| GitHub Release、打标与平台级联 | 已限制继承外发链；自有流程不创建 tag／Release 或级联平台         | P3 已隔离，正式发布单独验收 |
| 桌面原地升级或独立并存         | 当前保留身份，源码显示已接入；真实安装与升级未验收，不声明可并存 | P5 平台发行待验收           |
| 是否独立发行 FnOS appname      | 保留内部名称和数据位置，已接入显示与 staging；NAS 安装升级待验收 | P5 平台发行待验收           |
| 已有用户的专家名称／人格迁移   | 首期不自动修改                                                   | 仅在后续明确迁移需求时      |

## 15. 官方依据与仓库参考

- [Vite 6 配置](https://v6.vite.dev/config/)：默认配置、函数式配置和独立配置文件入口。
- [Vite 6 publicDir](https://v6.vite.dev/config/shared-options)：单一 public 目录以及资源原样复制行为。
- [Vite 插件 API](https://vite.dev/guide/api-plugin)：配置 hook 和 `transformIndexHtml` 的职责。
- [vite-plugin-pwa 最小要求](https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements)：自定义 manifest 和 PWA 所需元数据。
- [i18next API](https://www.i18next.com/overview/api)：资源 bundle 深合并和同键覆盖。
- [Web App Manifest 标准](https://www.w3.org/TR/appmanifest/)：应用身份、启动地址和导航范围；不保证各浏览器安装升级行为完全相同。
- [仓库 AGENTS.md](../AGENTS.md)：模块边界、i18n、验证、分支和产物约定。
- [前端 locale 加载](../dashboard/src/i18n.ts)、[Vite 配置](../dashboard/vite.config.ts)、[Vitest 配置](../dashboard/vitest.config.ts)。
- [后端 locale 加载](../src/octop/i18n/loader.py)、[自更新](../src/octop/infra/setup/self_update.py)、[Dockerfile](../docker/Dockerfile)、[打包配置](../pyproject.toml)。

本方案的外部行为依据核验于 2026-10-11。实施或升级相关工具版本时，重新核对必要的版本差异；仓库代码入口与实际构建结果始终作为验收依据。
