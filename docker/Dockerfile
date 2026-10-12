# syntax=docker/dockerfile:1
# =============================================================================
# HiveWork — 多阶段 Docker 构建
#
# 阶段 1: 构建 React/TypeScript 前端
# 阶段 2: Python 运行时 + 预构建前端
#
# 用法（在仓库根目录执行，构建上下文为根目录）:
#   docker build -f docker/Dockerfile -t hivework:local .
#   docker run -d -p 8088:8088 -v octop-data:/data/.octop -e HOME=/data hivework:local
#
# 国内加速（可选，需 BuildKit，docker/docker_build.sh 默认已开启）:
#   PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple \
#   PIP_TRUSTED_HOST=mirrors.cloud.tencent.com \
#   NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/ \
#   APT_MIRROR=mirrors.cloud.tencent.com \
#   bash docker/docker_build.sh
#
# 或直接传 build-arg:
#   docker build \
#     -f docker/Dockerfile \
#     --build-arg PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple \
#     --build-arg PIP_TRUSTED_HOST=mirrors.cloud.tencent.com \
#     --build-arg NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/ \
#     --build-arg APT_MIRROR=mirrors.cloud.tencent.com \
#     --build-arg NODE_MAX_OLD_SPACE_SIZE=1024 \
#     -t hivework:local .
#
# 或使用 Compose:
#   docker compose -f docker/docker-compose.yml up -d
# =============================================================================

# ---------------------------------------------------------------------------
# 阶段 1 — 前端构建
# ---------------------------------------------------------------------------
FROM node:22-trixie-slim AS node-runtime

FROM node-runtime AS frontend-builder

ARG NPM_REGISTRY=
# Node heap ceiling for the vite build. Lower this (e.g. 1024) on low-memory
# build hosts (< 4G RAM) to avoid OOM kills — the value only caps the max,
# it is not pre-allocated.
ARG NODE_MAX_OLD_SPACE_SIZE=2048
WORKDIR /build/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    set -eu; \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi; \
    npm ci --no-audit \
    || { echo "npm ci failed — retrying clean"; rm -rf node_modules; npm ci --no-audit; }; \
    test -x node_modules/.bin/vite

COPY dashboard/ ./
# Vite reads the shared brand profile relative to dashboard/.
COPY src/octop/branding/ ../src/octop/branding/

RUN mkdir -p ../src/octop/dashboard

# 镜像构建跳过完整 tsc；生产打包由 vite/esbuild 完成（使用 lockfile 中的 vite，不用 npx）
RUN NODE_ENV=production NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}" npm run build:docker


# ---------------------------------------------------------------------------
# 阶段 2 — Python 运行时
# ---------------------------------------------------------------------------
FROM python:3.12-slim-trixie AS runtime-base

LABEL maintainer="HiveWork"
LABEL org.opencontainers.image.title="HiveWork"
LABEL org.opencontainers.image.description="HiveWork (蜂巢智工) — self-hosted multi-user, multi-agent AI workspace."
LABEL org.opencontainers.image.source="https://github.com/coder-lulu/hivework"
LABEL org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/data \
    OCTOP_BIND_HOST=0.0.0.0 \
    OCTOP_PORT=8088 \
    OCTOP_LOG_LEVEL=info \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

ARG PIP_INDEX_URL=
ARG PIP_TRUSTED_HOST=
ARG APT_MIRROR=

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    if [ -n "$APT_MIRROR" ]; then \
        printf 'Types: deb\nURIs: https://%s/debian\nSuites: trixie trixie-updates\nComponents: main contrib non-free non-free-firmware\n\nTypes: deb\nURIs: https://%s/debian-security\nSuites: trixie-security\nComponents: main contrib non-free non-free-firmware\n' \
            "$APT_MIRROR" "$APT_MIRROR" > /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libstdc++6 \
        libatomic1 \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /uvx /bin/
# Skills and plugins need Node/npm at runtime as well as during the UI build.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node-runtime /usr/local/LICENSE /usr/local/share/doc/node/LICENSE
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

# 先安装锁定依赖，仅改源码时可复用此层缓存
COPY pyproject.toml uv.lock README.md LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -n "$PIP_INDEX_URL" ]; then \
        export UV_INDEX_URL="$PIP_INDEX_URL"; \
        if [ -n "$PIP_TRUSTED_HOST" ]; then export UV_INSECURE_HOST="$PIP_TRUSTED_HOST"; fi; \
    fi \
    && uv sync --frozen --no-install-project --no-dev --extra browser

ENV PATH="/app/.venv/bin:/data/.local/bin:/data/.skillhub/bin:$PATH" \
    NPM_CONFIG_PREFIX=/data/.local \
    PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

COPY src/ ./src/
COPY --from=frontend-builder /build/src/octop/dashboard/ ./src/octop/dashboard/

COPY .env.example ./
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker/hivework-tools.sh /etc/profile.d/hivework-tools.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && sed -i 's/\r$//' /etc/profile.d/hivework-tools.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && find /app/src -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
    && find /app/src/octop/infra/desktop/scripts -type f -name '*.sh' \
        -exec bash -c 'for script; do bash -n "$script" || exit 1; done' _ {} +

RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -n "$PIP_INDEX_URL" ]; then \
        export UV_INDEX_URL="$PIP_INDEX_URL"; \
        if [ -n "$PIP_TRUSTED_HOST" ]; then export UV_INSECURE_HOST="$PIP_TRUSTED_HOST"; fi; \
    fi \
    && uv sync --frozen --no-dev --extra browser \
    && /app/.venv/bin/python -m ensurepip --upgrade --default-pip \
    && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* /tmp/*

RUN mkdir -p /data/.octop

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD ["sh", "-c", "curl -f http://localhost:${OCTOP_PORT:-8088}/api/health || exit 1"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD []

# Optional virtual desktop: packages live in the image and survive recreation.
# docker build --target desktop -f docker/Dockerfile -t hivework:desktop .
FROM runtime-base AS desktop
ENV DISPLAY=:99
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -n "$PIP_INDEX_URL" ]; then \
        export UV_INDEX_URL="$PIP_INDEX_URL"; \
        if [ -n "$PIP_TRUSTED_HOST" ]; then export UV_INSECURE_HOST="$PIP_TRUSTED_HOST"; fi; \
    fi \
    && uv sync --frozen --no-dev --extra browser --extra desktop \
    && /app/.venv/bin/python -m ensurepip --upgrade --default-pip \
    && bash /app/src/octop/infra/desktop/scripts/linux/v1.0/install.sh \
    && bash /app/src/octop/infra/desktop/scripts/linux/v1.0/stop.sh \
    && rm -rf /var/lib/apt/lists/* /tmp/*

# Keep the default image free of the optional graphical desktop stack.
FROM runtime-base AS runtime
