# HiveWork（蜂巢智工）安装与升级

HiveWork 保留 `octop` 包名、CLI、`OCTOP_*` 环境变量和 `.octop` 数据目录。请从 [HiveWork 仓库](https://github.com/coder-lulu/hivework) 构建或获取经过验证的 HiveWork 制品。`pip install octop`、`octop update` 和上游安装脚本的默认 PyPI 模式不是 HiveWork 的安装／升级来源。

## 1. 从源码安装

需要 Git、Python 3.12+、uv、Node.js 和 npm。以下命令在 HiveWork 仓库根目录执行；已有部署先记录代码 commit，并备份配置、数据库及工作区。升级期间停止实际运行的实例，重装后使用原启动方式恢复运行。

必须先构建并验证品牌 SPA，不能凭 `src/octop/dashboard/index.html` 已存在就认为构建有效：旧 checkout 中可能残留上游或前一版本的产物。

```sh
git clone https://github.com/coder-lulu/hivework.git
cd hivework
# 切换到已验收的 HiveWork commit/tag，再构建。
npm --prefix dashboard ci
npm --prefix dashboard run build
uv run --no-project python scripts/check_branding.py --built
```

安装器的源码入口在发现包内品牌 profile 后也会强制重新构建并检查；构建、依赖安装或品牌检查失败会停止源码安装。上游未携带品牌 profile 的源码仍沿用原有行为。

Linux／macOS：

```sh
bash scripts/install.sh --from-source "$PWD"
```

Windows PowerShell：

```powershell
.\scripts\install.ps1 -FromSource -SourceDir (Get-Location).Path
```

这里显式传入本地源码目录。Shell 安装器的无目录 clone 模式会根据 `OCTOP_REPO` 派生 `octop-harness`、`octop-gateway`、`octop-browser` 仓库地址；只把它设成 HiveWork fork，不能保证这些依赖仓库存在。若使用该模式，应显式将 `HARNESS_AGENT_REPO`、`HARNESS_GATEWAY_REPO`、`HARNESS_BROWSER_REPO` 指向真实的 TencentCloud 对应仓库。推荐上述本地源码方式，由原有依赖声明从包索引解析依赖，不假设 HiveWork 账号拥有这些依赖仓库。

## 2. 升级已经安装的源码版本

安装器使用普通 `uv pip install <源码目录>`，并非 editable 安装。品牌源码安装会附加 `--reinstall-package octop`，显式重装目标包；该选项同时刷新目标包缓存，不会强制重装所有依赖（[uv CLI 文档](https://docs.astral.sh/uv/reference/cli/#uv-pip-install--reinstall-package)）。仅在工作区执行 `git pull` 不会更新已运行虚拟环境中的 Python 包或内置 SPA。

更新到经过验收的 HiveWork commit 后，重新执行第 1 节的构建与品牌检查。然后重新运行对应源码安装器；也可直接重装到**实际运行的虚拟环境**。默认安装目录示例如下，自定义 `OCTOP_HOME` 时必须使用该目录：

```sh
octop_install_home="${OCTOP_HOME:-$HOME/.octop}"
uv pip install --reinstall-package octop --python "$octop_install_home/venv/bin/python" '.[browser]'
"$octop_install_home/venv/bin/python" -I -c "import json; from importlib.resources import files; p=files('octop'); b=json.loads((p/'branding'/'profile.json').read_text()); assert b['id']=='hivework'; assert 'HiveWork' in (p/'dashboard'/'index.html').read_text(); print(p)"
```

```powershell
$hiveworkInstallHome = if ($env:OCTOP_HOME) { $env:OCTOP_HOME } else { Join-Path $HOME '.octop' }
$hiveworkPython = Join-Path $hiveworkInstallHome 'venv\Scripts\python.exe'
uv pip install --reinstall-package octop --python $hiveworkPython '.[browser]'
if ($LASTEXITCODE -ne 0) { throw 'HiveWork installation failed' }
& $hiveworkPython -I -c "import json; from importlib.resources import files; p=files('octop'); b=json.loads((p/'branding'/'profile.json').read_text()); assert b['id']=='hivework'; assert 'HiveWork' in (p/'dashboard'/'index.html').read_text(); print(p)"
if ($LASTEXITCODE -ne 0) { throw 'Installed HiveWork verification failed' }
```

如原安装启用了其他 extras，重装时保留它们。上述 `-I` 检查避免工作区或 `PYTHONPATH` 遮蔽实际安装包，输出应指向目标 venv 的 `site-packages/octop`。检查成功后重启实际服务，确认版本、登录、会话和数据正常。PWA 用户还需接受 Service Worker 更新；已有安装名称和图标的更新行为受浏览器影响。

## 3. wheel 与 Docker

构建 wheel 前同样必须完成第 1 节的前端构建与品牌检查：

```sh
uv build --wheel --out-dir dist
```

从已审核制品安装时，给 `uv pip install --reinstall-package octop --python <实际运行的Python> <HiveWork wheel路径>` 传入确切本地 wheel 文件，随后执行第 2 节的安装包检查。wheel 文件名仍包含 `octop`；以制品来源、commit 和 SHA256 确认身份，不能仅依据包名。

Docker 从当前 HiveWork 源码重新构建，前端阶段会显式复制共享品牌资料：

```sh
docker build -f docker/Dockerfile -t hivework:local .
docker run --rm --entrypoint python hivework:local -c "import json; from importlib.resources import files; p=files('octop'); assert json.loads((p/'branding'/'profile.json').read_text())['id']=='hivework'; assert 'HiveWork' in (p/'dashboard'/'index.html').read_text()"
```

部署升级时把原服务的镜像引用改成经过验收的 HiveWork 制品，保留现有端口、环境变量、挂载和数据卷。不要使用新空数据卷替代原卷。保留上一份镜像 digest／wheel 和 commit 供回滚；本品牌改造不迁移数据库或数据路径。

## 4. 制品流水线与发行边界

[HiveWork Build Artifacts](../.github/workflows/hivework-artifacts.yml) 只接受手动启动，限定 `coder-lulu/hivework`。它构建并归档 wheel 与 Linux amd64 Docker 镜像，检查包内品牌、记录 commit／SHA256。镜像本地标记为 `ghcr.io/coder-lulu/hivework:<commit>`，以 tar.gz 归档；**此流程不推送镜像、不上传 PyPI、不创建 tag／Release，也不级联桌面或 FnOS**。Actions artifact 只用于审阅，不能据此宣称所有平台已正式发布。

继承的自动打标、PyPI、Docker 发布、桌面 Release 和 FnOS 流程限于 `TencentCloud/Octop` 运行；普通 PR CI 与桌面 PR 构建检查保留。`make publish`／`make publish-test` 对当前 HiveWork 品牌配置拒绝上传原 `octop` 包，`make build` 仍可正常构建。

正式分发前需要在 HiveWork 仓库单独验收与授权对应的 GitHub Release／自有镜像渠道。不要将官方 `ghcr.io/tencentcloud/octop` 或 PyPI `octop` 当作 HiveWork 的回退更新源。`origin`／`upstream` 的归属与底层包名是不同事项。

桌面和 FnOS 的独立安装身份、安装升级卸载、签名及平台制品尚需 P5 验收。本轮不改变桌面 productName／应用 ID、FnOS appname，也不以旧平台制品冒充已验收 HiveWork 发行版。


## 5. 桌面与 FnOS：已接入源码展示，平台发行待验收

桌面窗口、设置页、托盘提示、启动图和实际嵌入的托盘图已经使用 HiveWork／蜂巢智工。新增品牌图与原上游图并存，不修改 `productName`、应用 ID、可执行文件名、安装路径、存储键或版权。安装器 ICO／macOS ICNS、签名、原地升级与卸载行为仍需平台验收；源码显示改造不等于完整平台发行已通过。

FnOS 保留 `octop`／`octop-native` appname 和数据目录，更新显示名、应用入口标题和说明。在打包暂存目录覆盖图标，不覆写原上游二进制。品牌图派生来源为 `dashboard/branding/assets/`，派生文件随源码保存；品牌主图变化时在已有项目依赖环境执行 `uv run python scripts/prepare_platform_branding.py --generate-assets` 重新生成。普通 FPK staging 使用 Python 标准库，不依赖 Pillow；仅重新派生图片时使用项目已具备的 Pillow。

Docker FPK 必须显式提供 `FPK_IMAGE_TAG`，仅指向 `ghcr.io/coder-lulu/hivework:<该标签>`；无标签立即拒绝，不能隐式使用上游镜像。当前模板的 `unreleased` 仅为未发行标记，不能直接部署。只有已审核并已发布的 HiveWork 镜像，或已通过 `docker load` 放入目标 NAS 且标记为该完整名称的审核本地镜像，才可作为安装前提。构建命令模板如下（不要使用未经验证的标签）：

```sh
FPK_NAME_PREFIX=HiveWork-fnos FPK_IMAGE_TAG="$HIVEWORK_REVIEWED_TAG" bash scripts/build-fpk.sh docker
```

原生 FPK 要求预先准备 `fnos/native/app/site-packages/octop/` 下的 HiveWork profile 与实际品牌 SPA，缺失或仍为上游内容时拒绝打包，不能复用官方 Octop wheel 冒充 HiveWork。`FPK_NAME_PREFIX=HiveWork-fnos` 只调整制品名称，不改应用身份。本文不宣布任何 FnOS 镜像已经发布或 FPK 已经通过 NAS 安装／升级验证。
