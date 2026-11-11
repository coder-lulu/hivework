# HiveWork desktop (green portable + Electron shell)

All desktop-client code lives here. This is **not** `src/octop/infra/control/desktop`
(remote desktop streaming).

| Path | Role |
|------|------|
| [`src/`](src/) | Electron shell — owns the Python sidecar, not the business logic |
| [`portable/`](portable/) | Green zip packaging |
| [`docs/DESKTOP_ARCHITECTURE.zh.md`](docs/DESKTOP_ARCHITECTURE.zh.md) | Target architecture for the Electron shell |
| [`docs/LOCAL_ACCOUNT_CLAIM.zh.md`](docs/LOCAL_ACCOUNT_CLAIM.zh.md) | Claim an existing local account when `OCTOP_HOME` already has users (not implemented) |

The Electron shell owns the desktop lifecycle: restore the selected local or
remote server, own tray/window chrome, refuse official self-updates. Local mode
spawns Octop on a random loopback port; remote mode opens the selected HTTP(S)
origin with its normal account login. The green runtime
is expanded before the user launches: NSIS `tar.exe` on Windows, and the tree
`package.sh` assembled copied into the app on macOS and Linux. CI builds the
green zips and bundles each one with the Electron shell and Dashboard in a
matching native installer.

Inside the Electron package everything sits directly under `src/`: `main/`,
`preload/`, `renderer/`, `shared/`.

## HiveWork migration scope

This tree follows upstream's Electron shell. Window titles, tray text, early
pages, privacy prompts and icons use HiveWork / 蜂巢智工. The existing HiveWork
installation name is retained: `productName=HiveWork`, `HiveWork.exe`, and a
machine-wide Windows default of `Program Files\HiveWork`. App ID
`com.tencent.octop`, package `octop-desktop`, Linux executable/package `octop`,
`octop://`, and runtime/storage identifiers remain unchanged. External installers
use `HiveWork-desktop-*`; portable archives and their payload directories retain
`Octop-portable-*` and `Octop-<platform>/`. `OCTOP_HOME` defaults to `~/.octop`.
Native Electron installation, migration of the Wails uninstall registration,
upgrade and uninstall have not been verified; the old Windows build evidence
does not validate this new framework.

HiveWork's canonical `src/octop/branding/profile.json` disables official
self-updates. The build embeds that policy in the main process and rejects both
update checks and install requests before contacting the official download
service. The inherited desktop workflow keeps its `TencentCloud/Octop` release
gate; fork PR builds are checks, not an authorized HiveWork distribution channel.
See [the release policy](../docs/hivework-install.md).

HiveWork's multi-server manager has been ported from the former Wails page to
a trusted local Electron window. It retains add/edit/delete, save-and-connect,
default selection, retry and temporary local mode. The existing
`OCTOP_HOME/desktop-servers.json` is read before local runtime preparation:
`activeUrl=null` allows the `OCTOP_DESKTOP_URL` fallback, `activeUrl=""` explicitly
selects local, and a saved remote URL takes precedence over the environment.
With no selection the manager waits. Malformed or unreadable existing files
are preserved and block mutations until repaired and the app restarted.
Defaults are atomically saved only after health and page loading succeed;
the candidate window stays hidden until generation validation and that save
complete. Failed remote probes, page loads or saves retain the old dashboard
and its local sidecar; only a committed switch stops captured owned resources,
and the next local startup waits for that cleanup. Failure never falls back
to local. Temporary local mode preserves a remote
default, including after retry and restart. Superseded connections are canceled
and late health/page results cannot select or persist over their successor.

Remote mode probes only `/api/health`, without cookies or credentials, then
loads the remote root in a sandboxed window with a native frame. It does not
prepare a runtime, start Python, create a device credential or run a local
WebSocket relay. Only HTTP(S) roots are accepted; account fields, paths, queries,
fragments and health redirects are refused, and TLS validation remains enabled.
The remote page gets only
`window.hiveworkServerConnections.current/openManager/onChange`, never
`window.octopDesktop`. Thus older remote dashboards retain their ordinary web
behavior; an updated dashboard additionally shows the server-settings entry.
The local dashboard retains the full `octopDesktop` bridge, including its
`serverConnections` group. `current()` returns only the current name/address,
and change notifications carry no payload. Profile enumeration and mutations
require the exact trusted local manager window and main-frame file URL;
local session/settings/updater/picker/relay operations require the local
dashboard's window identity and origin. A switch stops only the sidecar this
shell created. Local mode follows upstream's owned random-port sidecar design;
it does not discover/reuse an independently running local server. Such a service
can still be selected explicitly as an HTTP(S) profile, including a loopback URL.

The [connection guide](../docs/desktop-server-connections.md) records the original
behavior and Wails validation history. The Electron port is covered by Node
state/permission/preload tests and main-entry wiring tests with Electron test
doubles, plus production compilation; real native-window interaction remains
unverified.

The former Wails preferences window, locale selector and keep-awake behavior
remain absent. `launchAtLogin` is stored in Electron client settings, but
upstream does not yet apply it to the OS. Legacy Wails preferences are not
imported into the new schema. Electron's macOS behavior uses the Dock instead
of a menu-bar tray. Old Go sources and Wails pages are removed from this package.

## Brand assets

| File | Purpose |
|------|---------|
| `src/resources/icon.png`, `icon.ico`, `icon.icns` | Existing HiveWork platform artwork |
| `src/renderer/src/assets/logo_horizontal_dark.png` | HiveWork bilingual logo on light backgrounds |
| `src/renderer/src/assets/logo_horizontal_white.png` | HiveWork bilingual reverse logo on dark backgrounds |
| `src/renderer/src/assets/hivework-mark.png` | HiveWork mark on the startup error page |

`scripts/prepare_platform_branding.py` generates these Electron paths from the
existing HiveWork source artwork. Its `generate_desktop_assets()` function
regenerates only the desktop assets; the full `--generate-assets` command also
updates FnOS and host-desktop resources. The DMG uses the standard plain
background rather than upstream's Octop-branded illustration.

## Electron shell (pnpm + Node 24)

`desktop/src` is an independent Node package managed by **pnpm 12.15.0**
(the version `corepack use pnpm` resolves under Node 24). The version is declared
in three places that must stay equal:

| Where | Read by |
|-------|---------|
| `src/package.json` → `packageManager` | corepack, and pnpm's own version check |
| `src/package.json` → `devEngines.packageManager` | pnpm 12 / npm native check (`onFail: error`) |
| `mise.toml` → `[tools] pnpm` | `mise install` / `mise exec`, so PATH has the same binary |

Measured behaviour: running an older pnpm in this directory silently re-execs
12.15.0 (`Done in 4ms using pnpm v12.15.0`), while corepack-invoked mismatches
fail with `ERR_PNPM_BAD_PM_VERSION`. Either way `pnpm-lock.yaml` cannot be
rewritten by a different major.

Config is split by pnpm's own rules — since pnpm 11, `.npmrc` is read **only**
for registry/auth, and the `package.json` `"pnpm"` field is ignored:

| File | Holds |
|------|-------|
| `src/pnpm-workspace.yaml` | `nodeLinker: hoisted`, `allowBuilds` (electron, esbuild, app-builder-bin, …) |
| `src/.npmrc` | `registry` only |

`nodeLinker: hoisted` is required because electron-builder and electron-vite
inspect a flat `node_modules` tree. `allowBuilds` is required because pnpm blocks
postinstall by default and pnpm 12 fails the install (`ERR_PNPM_IGNORED_BUILDS`)
when a blocked package needs one. `electron` is not on that list: since
Electron 45 the package has no postinstall, and `node_modules/electron/dist/` is
populated on first use — `pnpm dev` triggers it through `require("electron")`,
CI can do it explicitly with `npx install-electron`.

Node is pinned to **24** by `src/mise.toml`, overriding the repo-root pin of
20. That override is scoped to this directory and nowhere else: the Dashboard,
`docker/Dockerfile` (`node:20-slim`), `release.yml`, `fnos-build-fpk.yml`,
`octop-desktop.yml` and the server all stay on Node 20. The reason for the split
is `pnpm test`, which uses `node --test --experimental-strip-types` and needs
Node ≥22.6 (on Node 20 the runner dies with `bad option`), plus Node 20's April
2026 EOL. This only affects build/test tooling: the shipped app runs on
Electron's bundled Node (Electron **45.0.0** → Node 24.22.0, Chromium 156), so
raising the app's runtime Node means upgrading Electron, not this pin.

```bash
cd desktop/src
mise install                    # node 24 + pnpm 12.15.0
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
pnpm dev                        # build the shell, then launch with Dashboard hot reload
pnpm dev:start                  # relaunch without rebuilding the shell (Dashboard still hot-reloads)
pnpm dev:no-sandbox             # same, minus the Chromium sandbox + GPU process
pnpm package                    # electron-builder (requires staged resources)
```

All three launch scripts are `scripts/run-dev.sh` with different flags; `--`
forwards the rest of the line to the Electron binary:

```bash
pnpm dev:start -- --lang=en-US --remote-debugging-port=9222
```

`Ctrl+C`, `SIGTERM`, and `SIGHUP` stop the shell **and** its Python sidecar.
`run-dev.sh` delegates lifecycle management to `scripts/dev-process.mjs` before
building, then replaces the build shell with Electron. The managed command runs
in its own process group, so terminal signals reach the supervisor only. It
sends Electron one `SIGTERM` to allow its normal sidecar shutdown, tracks the
process tree (including Python's detached group), and cleans up observed
survivors even if Electron crashes or exits normally.

After 8 seconds the supervisor sends `SIGKILL` to remaining processes and waits
up to 2 more seconds to confirm cleanup; a second signal skips the grace window.
Explicit terminal stops return 0, while build/app failures retain their non-zero
exit status. Unconfirmed cleanup returns 1 instead of claiming success. There is
no background shell watchdog left behind.

This runner supports macOS/Linux and requires a readable `ps`; when the host
blocks it the script refuses to start rather than launching something it cannot
clean up. A single failed sample during a run is skipped, not treated as a
reason to stop the app.

Descendants are sampled while the app is alive, so a detached process that is
orphaned between two snapshots can evade tracking; `SIGKILL` of the supervisor
itself cannot run any cleanup. Detached children of a build that died before the
first snapshot are still adopted by process group, unless their number was
already reused. None of this changes the packaged app's lifecycle or the
separate root `make dev` command.

### Why the launch flags

`run-dev.sh` always drops `ELECTRON_RUN_AS_NODE` for the launch (and only for
the launch). When that variable is set to anything — some shells and CI images
export it globally — the Electron binary runs as a plain `node`, so
`require("electron")` returns a path string instead of the API and the first
line of `main/index.ts` dies with
`Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`.

`--no-sandbox` is **not** the default, because it removes Chromium's renderer
isolation. Reach for `pnpm dev:no-sandbox` only where the setuid helper cannot
initialise (`sandbox initialization failed: Operation not permitted`) or the GPU
process dies (`GPU process exited unexpectedly`): containers, CI, headless
hosts, locked-down sandboxes. It is a dev-host switch and must never reach a
packaged build.

`dashboard/` is still npm-managed (`dashboard/package-lock.json`); the two
package managers never share a `node_modules` tree.

## Accounts (no sign-in wall)

Local desktop mode runs without a password sign-in wall. `buildSidecarEnv()` gives the
sidecar `OCTOP_REQUIRE_SETUP_PASSWORD=0`, so the wizard skips its CLI password
and the first admin gets a server-minted password nobody ever types
(`POST /api/setup/initial-admin` accepts a body without `password`). The JWT
lifetime is left at the server default: the session is renewed, not lengthened.

The Dashboard is not desktop-specific: it reads `wizard_password_required`
from `/api/setup/status` and hides the password step plus the Admin step's
password fields. A web deployment keeps the default `true` and the same code
renders them again. While the shell runs `OCTOP_REQUIRE_SETUP_PASSWORD` is
shell-owned — the `~/.octop/env` file and `PUT /api/envs` cannot put the
sign-in wall back.

An unknown password would be a dead end the moment the JWT expired, so the
shell holds a **device credential** instead:

- `main/session/device-credential.ts` mints a 32-byte secret on first use and
  stores it encrypted with `safeStorage` (Keychain / DPAPI / libsecret) at
  `<OCTOP_HOME>/desktop-device.json`, mode `0600`. A host with **no usable
  keychain** (headless Linux, WSL, CI) keeps the secret in memory for that launch
  and writes nothing: a plaintext file leaks through every backup or sync of the
  home directory, and a key stored beside its own ciphertext would be decoration.
  The trade-off is one sign-in per launch there — the server upserts a single
  `desktop_device` row, so re-registering replaces it instead of piling up
  devices.
- A v1 file written while the plaintext fallback still existed is re-encrypted on
  the next start when a keychain is available, and deleted otherwise (its secret
  is still adopted for that one launch).
- The renderer never sees it. After the first authenticated response,
  `dashboard/src/api/desktopSession.ts` asks the shell to bind the credential to
  the signed-in user (`POST /api/auth/device/register`, which replaces any
  previous token, so a reinstall or second machine takes over).
- On a `401`, `request()` renews once through the shell
  (`POST /api/auth/device/token`) and retries with the new JWT. The exchange is
  JWT-exempt but requires the shell flag, a loopback peer, a matching SHA-256
  digest (constant-time compare) and stays under a per-host failure throttle —
  only the digest is stored server-side (`secrets` row `desktop_device`).
- `POST /api/auth/device/revoke` forgets the credential; the shell exposes it as
  `session.revoke` for a future "reset this device's login" action.

So a desktop install keeps working across restarts and across JWT expiry without
ever asking for a password. Sliding renewal still rotates the token during use.
The one remaining dead end is deliberate: an admin who *deletes* the credential
(or whose user row is removed) reaches the normal login page, and recovering
from there is a server-side operation (`octop user passwd`), not something the
shell can do on its own.

A different gap is also unsolved: an `OCTOP_HOME` that already has users (an
older desktop install, or a local `octop run`) never registered a device
credential, so the new shell lands on the login page. The claim flow for that
case is specified in [`docs/LOCAL_ACCOUNT_CLAIM.zh.md`](docs/LOCAL_ACCOUNT_CLAIM.zh.md)
and is not implemented yet.

## WebSocket relay (shell-owned)

`octop://app` cannot carry a WebSocket handshake: the upgrade never reaches
`protocol.handle`, and `webRequest.onBeforeRequest` drops `redirectURL` for a
`webSocket` request. So the shell runs a relay on `127.0.0.1`
(`main/protocol/ws-relay.ts`) and the page dials
`ws://127.0.0.1:<ephemeral>/<per-launch path segment>/api/<path>?<query>`,
learning both from `window.octopDesktop.wsEndpoint()` — never the sidecar port,
which the relay re-reads per connection. Requests without the exact path segment,
or with any `Origin` other than `octop://app`, are refused with `403`; a sidecar
that is down gives `503` and an unreachable one `504`, while a backend refusal
(401/404) is passed through instead of being turned into a tunnel. The JWT still
travels in the query, exactly as it does in a browser — the relay injects
nothing. Outside the shell there is no bridge, so `resolveWsUrl()` falls back to
the page origin and every hook works in both modes.

## Update flow (shell-owned)

`installUpdate()` is the only install entry point the renderer has, and it
takes **no arguments**. The settings page confirms first. The shell then
re-selects the release, so the page cannot name a package URL. Check and
install failures stay on the shell's system dialog; download progress stays on
the taskbar or Dock.

1. `main/update/update-coordinator.ts` selects the release from the manifest
   (stable/beta preference, never a downgrade, `https` + `download.octop.cloud`
   only).
2. `main/update/download.ts` streams the installer into `$TMPDIR/octop-update`
   and reports progress to the taskbar/Dock.
3. API admission closes (the `octop://app/api/*` proxy answers `503`), then
   `SidecarSupervisor.stop()` waits for Python to exit **by itself with code 0**.
   A forced kill or non-zero exit cancels the install instead of replacing files
   under a live backend.
4. `main/update/installer.ts` hands the file to the OS installer — `dmg`/`pkg`
   through `shell.openPath`, `exe`/`msi` spawned detached on Windows, AppImage
   `chmod +x` first — and the shell quits so the installer can replace it.
5. If the installer never opens, the sidecar is restarted and the window
   reloads, so a failed hand-off does not leave a dead backend.

Not covered yet: the §3.4 "running tasks" confirmation before quit (the backend
has no task-query endpoint) and manifest-level digests — release assets carry no
checksum, so only the pinned-download-host rule is enforced.

## Data directory

Same as the Octop CLI/server default:

- `OCTOP_HOME` → `~/.octop` (or the existing `OCTOP_HOME` env)
- Green runtime → Windows `<install>\resources\sidecar`, macOS and Linux `Contents/Resources/portable` (Linux deb/rpm use the same `resources/portable` path under the install prefix)
- Shell prefs → Electron's `app.getPath("userData")/desktop-settings.json`

The old Wails `OCTOP_HOME/desktop-settings.json` is not imported by upstream.
This is an upstream storage/schema migration, not a HiveWork identity rename.

The shell points `OCTOP_GREEN_PACKAGES` at the extracted `packages/` directory.
The backend and CLI reject in-place updates while `OCTOP_DESKTOP_SHELL=1`; Newer
extracted runtimes are never downgraded; PostgreSQL stays externally managed and
is not copied by the shell.

## Build green zip

From repo root:

```bash
make -f desktop/portable/Makefile green
```

CI: `.github/workflows/octop-desktop.yml` builds one package per native
platform/arch (`darwin-arm64`, `darwin-amd64`, `linux-arm64`, `linux-amd64`,
`windows-arm64`, `windows-amd64`). The green zip matches the published image
and includes the `browser` extra only. Desktop, OCR, and local embedding stay
on the Docker `:<version>-full` image. Pull requests, tags, and manual
dispatch all build this one package. The workflow attaches
`Octop-portable-<plat>-<version>.zip` to the GitHub Release, then mirrors it
to COS, only in the gated upstream repository. Each job bootstraps portable CPython, packages the zip, smoke-tests
every frozen requirement, and bundles that exact zip plus the Dashboard into
a native Electron installer. For macOS this produces DMG and ZIP, for Windows
NSIS EXE, and for Linux deb and rpm. A deb install also places a desktop
launcher for the account that ran `apt` (see
`desktop/docs/DESKTOP_ARCHITECTURE.zh.md` §7.2). Installer files are named
`HiveWork-desktop-<plat>-<version>.<ext>`. The portable manifest records the
original Python version and the bundled zip's SHA-256. Installers are
unsigned and not notarized.

A `v*` tag in `TencentCloud/Octop` triggers building all six platform/architecture variants and attaches
both portable and desktop assets to the same GitHub Release. For a trial build
without publishing a release, dispatch `octop-desktop.yml` on the feature branch
with `platforms=all` and `attach_release=false`; download the artifacts from
that workflow run. Those dispatch jobs remain disabled in the HiveWork fork
until a separate distribution channel is reviewed and authorized. Do not
dispatch on an older tag without the Electron source.
