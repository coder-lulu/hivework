# HiveWork：Ubuntu 24.04 / 1Panel 部署

2026-10-12 已部署到 `118.25.50.30`，公网入口为
[https://work.hivekernel.com](https://work.hivekernel.com)。Docker、PostgreSQL、
DNS、可信 HTTPS 和应用升级已验收；当前已有 2 个用户和 1 个运行中的智能体。

## 实际部署记录

| 项目       | 实际配置 / 验收结果                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 应用       | `hivework` 容器，健康状态 `healthy`，重启计数 0                                                       |
| Compose    | `/data/hivework/compose.1panel.yml`，仅管理 HiveWork 应用                                             |
| 持久化目录 | 宿主 `/data/hivework/data` → 容器 `/data/.octop`                                                      |
| 环境配置   | `/data/hivework/app.env`，root 所有，权限 `600`                                                       |
| 数据库     | 1Panel 管理的 `hive-postgresql`，PostgreSQL 17.11-alpine；专用库和角色均为 `hivework`，schema 版本 20 |
| 网络       | `1panel-network`；应用 `127.0.0.1:18500`、数据库 `127.0.0.1:5432` 均未绑定公网                        |
| 域名       | DNSPod A 记录 `work` → `118.25.50.30`，TTL 600                                                        |
| 站点       | 1Panel 站点 ID `9`，反向代理到 `http://127.0.0.1:18500`                                               |
| 证书       | 1Panel 证书 ID `5`，独立 Let’s Encrypt EC 256 证书，HTTP 验证，自动续签开启                           |
| 到期时间   | `2027-01-09 23:08:09`（Asia/Shanghai）                                                                |
| 公网检查   | `/api/health` HTTPS 200，`ok=true`、`db=true`；HTTP 301 跳转 HTTPS；TLS 1.3，证书链及域名验证通过     |
| 前端检查   | HTTPS 登录资源包含新版桌面服务器设置入口；普通浏览器隐藏原生入口                                      |
| 代理       | HTTP/1.1、WebSocket Upgrade 与转发头已配置；关闭响应缓冲及代理缓存，读写超时 3600 秒                  |

镜像归档 `hivework-20261012-163f3c00.tar.gz` 的 SHA-256 为
`8623041483683576bb2b1d12371501e343b21e98f8b8ac591d5e678494c74852`，
上传与装载前已核对一致。这是首次部署归档；当前运行镜像及后续重建镜像见下文和第 12 节。
服务器保留归档 `/data/hivework/images/hivework-20261012-163f3c00.tar.gz`，
用于后续重新装载或回滚；数据库、容器、代理和 HTTPS 验收记录保存在
`/data/hivework/logs/`，本地副本位于 `logs/server-deployment/`。

现有 OpenResty、PostgreSQL 和业务容器没有重启；修改新站点代理后执行
`nginx -t` 和平滑加载，其他 9 个 vhost 配置文件的哈希保持一致。
此次升级后仍保留 1 个用户、1 个智能体和 schema 版本 20，智能体恢复运行。
实际用户登录、LLM 聊天流式输出、认证 WebSocket 和备份恢复未在此次验收中执行。

## 部署边界

- 复用 1Panel v2.2.5 管理的 PostgreSQL 17.11-alpine 容器
  `hive-postgresql` 和外部 Docker 网络 `1panel-network`。
- 复用采用 host 网络、已监听 80/443 的 `hive-openresty`；新增独立站点，
  保留服务器其他 8 个站点。不启动额外 PostgreSQL、Redis 或反向代理。
- 应用仅发布 `127.0.0.1:18500`，由 OpenResty 转发到容器 8088。
  PostgreSQL 使用同一 Docker 网络内的 `hive-postgresql:5432`，无需公网开放数据库端口。
- [Compose 文件](../docker/compose.1panel.yml) 使用本地镜像
  `hivework:20261012-wallpaper-7ca3d5da`，预期镜像 ID 为
  `sha256:bb6832379e8b3e5cf0128efa6ab725c26b6ec9af60c4ef49347b6bee0b3ce682`。
  当前在线容器保留 `hivework:20261012-assistant-efcfe114` 的桌面会话，其三处壁纸已原子替换并刷新；
  后续 Compose 重建使用新镜像。基础镜像通过 SSH 传输后 `docker load`；
  后续在服务器上以已校验的基础镜像构建更新层，没有推送注册仓库。

## 1. 准备专用数据库及配置

本次通过现有 PostgreSQL 容器的 `psql` 创建专用数据库和角色 `hivework`，
角色拥有该库，可创建应用表和执行迁移；角色没有 superuser、createdb、createrole
或 replication 权限。随后在 1Panel PostgreSQL 页面执行「从服务器同步」，
专用库已进入面板的数据库列表，可以通过面板备份。后续新部署也可直接通过面板创建。
使用随机强密码，不复用数据库管理员角色。
确认 `hive-postgresql` 已加入 `1panel-network`，并允许来自该网络的密码认证连接。
参考 [1Panel PostgreSQL 管理文档](https://1panel.cn/docs/v2/user_manual/databases/postgresql/)。

服务器上用 root 创建 `/data/hivework/data`，将 Compose 文件保存为
`/data/hivework/compose.1panel.yml`。创建 root 所有、权限 `600` 的
`/data/hivework/app.env`，填入以下字段（密码占位符必须替换）：

```dotenv
OCTOP_DATABASE_DRIVER=postgresql
OCTOP_DATABASE_HOST=hive-postgresql
OCTOP_DATABASE_PORT=5432
OCTOP_DATABASE_NAME=hivework
OCTOP_DATABASE_USER=hivework
OCTOP_DATABASE_PASSWORD='<实际随机密码>'
OCTOP_REQUIRE_SETUP_PASSWORD=true
OCTOP_DEFAULT_TIMEZONE=Asia/Shanghai
```

不要同时设置 `OCTOP_DATABASE_URL`，避免 DSN 覆盖这些字段。密码包含 `$` 时，
保留 dotenv 单引号以避免插值；不要把真实凭据提交到仓库或打印到诊断日志。
保留镜像默认用户，保持现有数据目录权限与入口脚本兼容。

## 2. 传输并装载镜像

在本地项目根目录 `E:/projects/hivework` 导出已验证镜像；镜像归档、校验文件和诊断
输出统一放在 `logs/server-deployment/`。使用 `docker save --output`，对归档计算
SHA-256，再通过 SSH 上传归档、校验文件和 Compose 文件。不要用管道的文本重定向
处理二进制镜像归档。服务器校验归档 SHA-256 与本地一致后执行：

```bash
docker load --input <已校验的镜像归档绝对路径>
docker image inspect hivework:20261012-ui-5ba08b46 --format '{{.Id}}'
docker network inspect 1panel-network
docker compose -f /data/hivework/compose.1panel.yml config --quiet
docker compose -f /data/hivework/compose.1panel.yml up -d
docker compose -f /data/hivework/compose.1panel.yml ps
curl --fail http://127.0.0.1:18500/api/health
```

镜像 ID 必须与上面的预期值一致。网络不存在时先核实 1Panel 实际网络，不创建同名
空网络来绕过检查。Compose 只管理 HiveWork，已有数据库不属于其生命周期。
[Docker 官方网络文档](https://docs.docker.com/compose/how-tos/networking/)说明了外部网络和容器名解析。

应用继承镜像的 `/api/health` 健康检查（30 秒间隔、90 秒启动宽限），设置 1536 MiB
内存上限及最多 3 个、每个 10 MiB 的 Docker 日志文件。健康状态不等同于数据库、
登录和会话的完整验收；浏览器工具等高内存任务需结合实际资源占用评估。

## 3. DNS、反向代理与 HTTPS

1. 将 `work.hivekernel.com` 的 A 记录指向 `118.25.50.30`；若有 AAAA 记录，确认
   IPv6 也能到达本服务器，否则移除错误记录。
2. 在 1Panel 新建该域名的反向代理站点，上游使用 `http://127.0.0.1:18500`。
   这一地址依赖已有 OpenResty 的 host 网络模式。
3. 保留原始 Host，传递 `X-Forwarded-For` 和 `X-Forwarded-Proto`；支持 WebSocket
   Upgrade，并关闭聊天 SSE 的代理缓冲，设置足够的读取超时以支持长响应。
   只修改新站点配置，检查配置语法后平滑加载，不重启其他业务容器。
4. 通过 1Panel 申请并绑定该域名证书，启用自动续签；确认 HTTPS 可访问后启用
   HTTP 跳转 HTTPS。使用 HTTP 验证时，DNS 与公网 80 端口必须已可达；使用 DNS
   验证时，在 1Panel 内配置对应 DNS 授权。参见
   [1Panel 证书文档](https://1panel.cn/docs/v2/user_manual/websites/certificate_create/)。

不同时启用应用自身 TLS；HTTPS 在 1Panel/OpenResty 终止。不要根据其他版本文档
猜测 1Panel 的安装目录或站点配置路径，应从当前面板查看实际配置。

本次面板实际生成的站点代号为 `work.hivekernel.comwork.hivekernel.com`，
域名仍为 `work.hivekernel.com`。配置文件路径为：

```text
/data/1panel/www/conf.d/work.hivekernel.comwork.hivekernel.com.conf
/data/1panel/www/sites/work.hivekernel.comwork.hivekernel.com/proxy/root.conf
```

代理设置的补充指令已写入该站点的 `proxy/root.conf`，修改前备份位于
`/data/hivework/logs/proxy-root.before-streaming.conf`：

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
proxy_connect_timeout 60s;
```

在面板重新保存代理表单后，检查「源文」中这些指令仍存在，避免表单生成的配置
覆盖补充指令。每次修改均先执行 `docker exec hive-openresty nginx -t`，
通过后再执行 `docker exec hive-openresty nginx -s reload`。

## 4. 首次设置与验收

默认不在环境变量中配置管理员密码，首次设置向导的凭据文件位于宿主机
`/data/hivework/data/octop-login.txt`，权限 `600`，仅在受控管理会话中读取。
页面显示的 `/data/octop-login.txt` 是容器内符号链接，实际指向持久化数据卷中的该文件。
在 SSH 管理终端读取第一行，然后输入网页的「启动密码」：

```bash
sudo head -n 1 /data/hivework/data/octop-login.txt
```

PostgreSQL 已绑定。若验证启动密码后仍显示数据库步骤，点击「收起高级选项」，
滚动到页面底部并点击「保存并继续」。该按钮检测到已有绑定后直接进入管理员步骤，
不会重新提交 SQLite 或 PostgreSQL 配置。高级表单中的 `127.0.0.1`、`octop`
是更换数据库时的默认值，无需修改或测试。随后创建管理员；模型配置可先跳过，
登录后在系统设置中填写提供商和 API Key。不要用服务器登录密码作为
应用管理员密码，也不要把向导口令写入仓库或诊断日志。

当前入口脚本以 `octop.db` 是否存在判断首次启动，因此 PostgreSQL 部署重启时仍可能
输出初始化/向导提示；应根据数据库中的实际管理员和设置状态核验，不据此重建库或重置账号。

完成管理员和模型配置后，继续验证业务功能：

- 首次设置、登录和刷新有效；配置模型后验证聊天流式输出及 WebSocket 功能。
- 创建数据后重建应用容器，确认账号、会话及工作区文件保留。
- 验证专用 PostgreSQL 备份与对应数据目录可在隔离环境中成对恢复。

## 5. 备份、更新与回滚

数据库和 `/data/hivework/data` 必须成对备份：前者包含业务记录，后者包含配置、
工作区文件、附件和运行时数据；只备份 PostgreSQL 不足以恢复应用。
同时安全保管 `app.env`、Compose、镜像 ID 和 1Panel 新站点配置，备份限制访问权限。

更新前停止 HiveWork 应用写入，在 1Panel 备份专用 PostgreSQL 库，再归档数据目录，
记录同一备份时间点并验证可恢复。恢复时先在隔离环境验证数据库及文件恢复流程。
不要停止或覆盖共享 PostgreSQL 实例，也不要恢复整个实例来回滚单个应用。

更新镜像同样使用 save → SHA-256 校验 → load，保留旧镜像与 Compose，再修改应用
镜像引用并重建该服务。若新版本包含数据库迁移，不能假定旧镜像兼容新 schema：
停止应用后，恢复更新前的专用数据库和对应数据目录，再启动旧镜像并重新验收。
首次上线失败时可停止 HiveWork 并停用新站点；保留数据库和数据目录用于排障，
不要执行全局 Docker 清理或删除其他站点、卷及网络。

本地仅校验配置时可执行以下命令，无需创建服务器凭据路径：

```powershell
docker compose -f docker/compose.1panel.yml config --no-env-resolution --quiet
```

该检查验证 Compose 结构，不验证服务器实际凭据、网络或运行状态。

## 6. 桌面服务器设置升级记录（2026-10-12）

新版支持桌面登录页设置并保存多个服务器，使用方法见
[桌面服务器连接说明](desktop-server-connections.md)。此功能需要新版桌面程序；
地址列表保存在客户端，云端数据库无需增加表或配置。

新旧镜像中 1801 个后端文件的合并 SHA-256 一致，本次仅更新服务端前端。
装载前核对归档 SHA-256，重建应用前暂停 HiveWork 写入并保存成对备份：

```text
/data/hivework/logs/desktop-servers-20261012/hivework.before.pgdump
/data/hivework/logs/desktop-servers-20261012/data.before.tar.gz
/data/hivework/logs/desktop-servers-20261012/compose.before.yml
```

PostgreSQL 备份已通过 `pg_restore --list` 检查，数据归档已验证可读取，权限均为 `600`。
旧镜像 `hivework:20261011-37f62353` 及原镜像归档保留用于回滚。
备份已创建并检查结构，尚未执行完整恢复演练。

重建后 `/api/health` 经可信 HTTPS 返回 200，`ok=true`、`db=true`，
`users_loaded=1`、`agents_running=1`；数据库用户、智能体、线程数量与暂停时一致。
其余 11 个容器的镜像、启动时间、重启次数及健康状态保持一致。
`app.env`、站点配置和代理配置哈希保持一致，SSL 继续由 1Panel 管理。

验收记录位于服务器
`/data/hivework/logs/desktop-servers-20261012/verification.json`，
本地副本为 `logs/desktop-servers/server-verification.json`。

## 7. 运行模式与界面统一（2026-10-12）

登录页的服务器入口改用与现有表单一致的 AntD 文本按钮、字号及间距。新版桌面程序的模式和地址设置页面内置在客户端，服务器只需要同步登录入口与品牌素材。

本轮将最新前端归档传到服务器，核对 SHA-256 后，以原来的 `hivework:20261012-163f3c00` 构建前端更新层 `hivework:20261012-ui-5ba08b46`。前后镜像 1801 个后端文件哈希一致；新前端的 384 个文件来自此次构建。未修改数据库结构、数据库凭据或 SSL 配置。

重建前暂停应用写入，保存并校验专用 PostgreSQL 与数据目录的成对备份，以及原 Compose，存放于 `/data/hivework/logs/desktop-mode-ui-20261012/`。旧镜像保留，失败时可恢复原 Compose 回滚前端。

上线后 HTTPS `/api/health` 正常，Docker 健康状态为 `healthy`；用户、智能体、线程分别为 `1 / 1 / 1`，schema 为 `20`，与本轮更新前一致。其余 11 个容器的镜像、启动时间、重启次数及健康状态一致，`app.env` 哈希一致。浏览器已验收新版品牌登录页面，桌面入口布局通过本地 RPC 预览验证。

服务器验收记录为 `/data/hivework/logs/desktop-mode-ui-20261012/deployment-verification.json`；本地记录、构建日志和页面截图位于 `logs/desktop-mode-ui/`。实际桌面原生 GUI 与安装升级没有在本轮运行。

## 8. 登录线路简略展示（2026-10-12）

登录服务器入口改为「线路名称 - 地址」单行，以及带齿轮图标的小号描边设置按钮。
本轮云端前端镜像为 `hivework:20261012-ui-6187f89d`，由上一节镜像构建，镜像 ID 为
`sha256:d0cc29d51d245620c1ac6d6d07aef180f2e6bbb5db48cf3c46e48fcc42540d1e`。
新旧镜像的 1801 个后端文件哈希一致，仅替换 384 个前端文件，无数据库结构变更。

更新前保存并校验 PostgreSQL 与数据目录备份，位于 `/data/hivework/logs/desktop-launch-fix-20261012/`。
上线后可信 HTTPS 健康检查及 Docker 健康状态正常；用户、智能体、线程数量分别为 `1 / 1 / 1`，schema 为 `20`。
其余 11 个容器的镜像、启动时间、重启次数和健康状态一致，`app.env` 保持原哈希。
验收记录为该目录的 `deployment-verification.json`，本地副本位于 `logs/desktop-launch-fix/`。

## 9. 科技蓝默认主题与桌面设置菜单（2026-10-12）

默认主题从 `amber` 调整为已有科技蓝 `tech`，启动及离线页一并同步。
云端镜像更新为 `hivework:20261012-ui-0fb87ea3`，镜像 ID 为
`sha256:ece70b2136285059dbe33a6b17a9e6ec8da2e4675fc02d667d1a19ae9117feb6`。
本轮更新前端及品牌资料中的 `default_palette` 单个字段；其余 1800 个后端文件合并哈希一致。
没有 API 或数据库迁移，已保存的用户主题继续遵循原有优先级。

更新前保存并校验 PostgreSQL、数据目录和 Compose 备份，记录在 `/data/hivework/logs/desktop-settings-menu-20261012/`。
上线后 HTTPS 健康检查正常；用户、智能体、线程数量仍为 `1 / 1 / 1`，schema 为 `20`。
其余 11 个容器及 `app.env` 保持原校验值；验收记录为该目录的 `deployment-verification.json`。
桌面菜单位于客户端内置 HTML 中，需要使用本轮重新编译的安装包。

## 10. Docker 工具链、插件安装与虚拟桌面（2026-10-12）

已修复并上线 `hivework:20261012-runtime-28e7eab4`。问题定位及修复如下：

| 问题                         | 原因                                                                                         | 修复                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 插件 Python 依赖安装失败     | 插件加载器调用 `/app/.venv/bin/python -m pip`，该 venv 原先没有 pip；系统 pip 属于另一解释器 | 在应用 venv 通过 `ensurepip` 安装 pip，保留编译工具供扩展依赖使用         |
| npm/npx 无法调用             | Node 只在前端构建阶段存在，未进入最终镜像                                                    | 运行时加入 Node.js 22.23.3、npm/npx 10.9.9 及所需共享库                   |
| 登录 shell 使用了系统 Python | Debian `/etc/profile` 重置 PATH                                                              | 加入 `docker/hivework-tools.sh`，让 `bash -lc` 使用应用 venv 和已保存工具 |
| 虚拟桌面安装退出码 2         | 打包的 5 个桌面脚本均为 CRLF，`bash -n` 已复现语法错误                                       | 镜像构建统一 Shell 文件为 LF，检查桌面脚本语法，Git 固定 `.sh` 为 LF      |
| 新构建镜像技能无法发现       | `.dockerignore` 的 `*.md` 排除了 `SKILL.md`、`SOUL.md` 等运行资源                            | 保留 `src/**/*.md`，继续排除仓库普通文档                                  |

工具目录沿用当前 `/data/.octop` 数据卷：首次启动且目录不存在时，
`/data/.local` 链接到 `/data/.octop/tools/local`，`/data/.skillhub` 链接到
`/data/.octop/tools/skillhub`。npm 全局安装前缀为 `/data/.local`，对应 CLI 和
SkillHub 工具可跨容器重建保留。已有真实目录不会自动迁移；本服务器升级前这两个目录均不存在。
普通 `pip install` 修改应用 venv，不作为持久数据保存；插件声明的依赖由现有加载器在启动时重新安装。

默认 Docker 构建仍使用 `runtime`，包含 Python/pip、Node/npm 和工具 PATH。
需要虚拟桌面时显式构建 `desktop`，将桌面 Python extra、系统包和运行脚本放进镜像：

```bash
bash docker/docker_build.sh hivework:desktop --target desktop
```

该变体默认启动服务时会启动已打包的虚拟桌面；容器重建后无需重新下载系统包。
本服务器使用该变体，`DISPLAY=:99`，VNC 只监听容器内 `127.0.0.1/::1:5900`，不发布该端口。
本次上线基于原部署镜像追加工具层，保持原初始化文件名及数据库绑定。
1775 个非 Shell 后端文件、384 个前端文件哈希一致，26 个 Shell 文件仅规范化换行。
没有数据库迁移或 HTTP API 改动。

当前 Agent 后端为 `local_shell`，在服务容器内执行，因此本轮修复直接生效。
显式 `type=docker` 使用独立沙箱镜像，其依赖、网络与 Docker Engine 接入需另行配置，
见 [Docker 沙箱说明](agent-backend-file-io.md#13-docker-sandbox-backend)。本轮没有修改 harness 依赖源码或启用 Docker socket。

验收记录：

- 4 项真实镜像测试通过，覆盖 Harness 执行 Python/npm、登录 shell、插件 ZIP 的
  `requires` / `requirements.txt` 依赖安装，以及 npm/SkillHub CLI 跨新容器保留。
  测试使用自建包、禁用网络和专属数据卷。
- 虚拟桌面使用不复制镜像数据的专属卷，连续两次默认启动和重建后均为 `ready`，
  实际截图均为 1920×1080，数据标记保留，VNC 仅监听回环地址。该隔离测试约占 349 MiB。
- Docker 构建上下文已验证保留真实内置技能和专家技能的 Markdown 入口。
- 上线后可信 HTTPS `/api/health` 正常，Docker 状态 `healthy`；用户、智能体、线程数量
  仍为 `1 / 1 / 1`，schema 为 `20`，智能体恢复运行，虚拟桌面状态 `ready`。
- `app.env`、站点与代理配置哈希一致，其余 11 个容器的镜像、启动时间、重启次数和健康状态一致。
- 本地 Ruff 检查、570 个源码文件的 mypy 检查通过，相关单元测试 71 项通过，
  Windows 上跳过 53 项 POSIX 测试；新增的 2 项工具目录测试已在 Linux 容器通过，
  覆盖重复初始化和保留已有目录。i18n 测试 93 项通过。Windows 缺少 GNU make，未运行 `make all`。
  尚未验证用户未指明的失败插件本身；已验证通用插件依赖安装链路。

更新前暂停应用写入并保存成对备份，均为 root 所有、权限 `600`：

```text
/data/hivework/logs/docker-runtime-fix-20261012/hivework.before.pgdump
/data/hivework/logs/docker-runtime-fix-20261012/data.before.tar.gz
/data/hivework/logs/docker-runtime-fix-20261012/compose.before.yml
```

PostgreSQL 备份已通过 `pg_restore --list`，数据归档已检查可读取；未执行完整恢复演练。
旧镜像 `hivework:20261012-ui-0fb87ea3` 保留用于回滚。
服务器证据位于 `/data/hivework/logs/docker-runtime-fix-20261012/`，本地诊断、测试和上线记录位于
`logs/docker-runtime-fix/`。

## 11. 默认助手技能品牌同步（2026-10-12）

默认技能的中文名称改为「HiveWork 助手」，英文名称为「HiveWork Assistant」，
使用 🐝 图标；简介、自我介绍、项目与反馈链接、安装及升级说明同步采用 HiveWork。
保留技术标识 `octop-assistant`、`metadata.octop` 和 `octop` CLI，兼容原有技能启用状态与命令。

技能卡片优先使用工作区 `SKILL.md` 中的 metadata，单独修改界面翻译不能更新已复制的技能。
因此更新 general-assistant 的打包模板，并在非团队智能体启动时调用
`infra/agents/experts/brand_sync.py`，通过 `BackendWorkspace` 同步旧默认技能。
`branding/skill-revisions.json` 只列入已确认的原版全文 SHA-256；比较前统一 CRLF/LF。
与该原版完全一致的副本自动替换，用户修改、已更新或缺失的技能保持原样，
重复启动不重复写入。后续上游模板变动需核对原版内容，再明确维护允许升级的摘要。
本轮没有重新播种整个专家模板或修改用户的 `SOUL.md`。

已上线镜像 `hivework:20261012-assistant-efcfe114`，继承第 10 节完整运行环境。
只修改默认技能和智能体启动接入，并新增同步模块及版本摘要；其余后端文件与
384 个前端文件逐字节一致，无数据库迁移或 HTTP API 变更。

验收记录：

- 相关 pytest 测试 293 项通过、1 项平台跳过；Ruff 检查通过，1182 个文件的格式检查通过，
  `mypy --strict src/octop` 检查 571 个源码文件通过。
- 真实镜像验证新智能体播种、中英文显示、完整旧模板的两种目录布局与两种换行方式、
  重复启动无改写，以及用户修改和缺失技能的保留；Python/pip/Node/npm/npx 继续可用。
- 当前 `main` 智能体在容器启动时已自动更新为「HiveWork 助手」；技能内部标识、
  智能体配置和 `SOUL.md` 哈希保持一致。
- 可信 HTTPS 健康检查和 Docker 健康状态通过，智能体恢复运行，虚拟桌面 `ready`。
  用户、智能体、线程仍为 `1 / 1 / 1`，schema 为 `20`；其他 11 个容器、
  `app.env`、站点和代理配置保持原校验值。

更新前暂停应用写入，保存并检查专用 PostgreSQL、数据目录和 Compose 备份，
位于 `/data/hivework/logs/assistant-branding-20261012/`，备份权限 `600`。
备份已检查结构，未执行完整恢复演练；旧镜像 `hivework:20261012-runtime-28e7eab4` 保留。
该目录包含 `image-verification.json` 和 `deployment-verification.json`；
本地测试及上线记录位于 `logs/assistant-branding/`。
Windows 缺少 GNU make，未运行 `make all` 全量门禁；未进行登录后的 LLM 对话测试。

## 12. HiveWork 远程桌面壁纸（2026-10-13）

桌面背景替换为科技蓝蜂巢图案，右下角显示「HiveWork / 蜂巢智工」，左侧留出图标空间。
原图及内置 imagegen 的最终提示词保存在 `hivework-logo-assets/wallpapers/`；
生成脚本将其复制到已有安装资源
`src/octop/infra/desktop/scripts/linux/v1.0/wallpaper.png`。
不改原安装路径，减少与上游安装脚本的差异；当前 wheel 的壁纸内容已与源码逐字节核对。

服务器镜像 `hivework:20261012-wallpaper-7ca3d5da` 继承上一节镜像，更新三处 PNG：

```text
/app/src/octop/infra/desktop/scripts/linux/v1.0/wallpaper.png
/opt/octop-desktop/wallpaper.png
/usr/share/backgrounds/octop-desktop-wallpaper.png
```

三处均为同一张 HiveWork 图片，SHA-256 为
`7ca3d5da0d7f8b212cfbba985c9436a10198e6404382c1f787f08a085fb46a49`。
该镜像的唯一源码差异是壁纸 PNG，384 个前端文件及其他后端文件保持原哈希。
未来从项目源码构建 `desktop` 镜像时，现有 `install.sh` 会安装同一壁纸。

在线更新采用原子替换这三处文件，保留当前容器和桌面进程，未重装桌面。
XFCE 对相同路径的图片有缓存；普通 `apply-wallpaper.sh` 刷新后仍显示旧图，
因此从运行中的 `xfdesktop` 读取实际会话环境，在该会话总线上将四个工作区的
`last-image` 临时切换到 `/opt` 副本，再切回系统 PNG，触发背景重新加载。
最终配置继续指向原系统路径；不修改图标、面板或窗口布局配置。
镜像标签已写入服务器和仓库 Compose，后续容器重建使用新镜像；
当前在线容器的基础镜像 ID 仍为上一节的 `22947923…`，其壁纸已更新。

验证结果：

- 64 项远程桌面与 i18n 测试通过；生成脚本 Ruff 和格式检查通过，wheel 构建与 CRC 检查通过。
- 新镜像使用专属数据卷连续两次默认启动和重建，均为 `ready`，数据标记保留。
  1920×1080 截图中的品牌橙色与白色像素分别匹配 `40/41` 与 `28/29` 个采样点。
- 在线桌面截图有相同匹配结果，VNC 继续只监听 `127.0.0.1/::1:5900`。
  当前容器、桌面进程和其他 11 个容器的镜像、启动时间、重启次数与健康状态一致。
- HTTPS `/api/health` 正常；本轮更新前后用户、智能体、线程均为 `2 / 1 / 1`，schema 为 `20`。
  `app.env`、站点和代理配置哈希保持一致。

旧壁纸三份与 Compose 已备份到
`/data/hivework/logs/remote-wallpaper-20261012/backup/`，文件权限 `600`。
应用数据和数据库没有写入操作，本轮无需数据库恢复或停机重建。
服务器验收文件为该任务目录中的 `image-verification.json` 与 `deployment-verification.json`；
实际桌面截图和本地检查记录位于 `logs/remote-wallpaper/`。
Windows 缺少 GNU make，未运行 `make all` 全量门禁；本轮未修改桌面客户端或重打 Windows 安装器。
