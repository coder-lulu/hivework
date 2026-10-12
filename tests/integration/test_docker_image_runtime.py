"""Offline runtime regressions against OCTOP_TEST_IMAGE (real Docker, isolated data).

This file is self-contained: copy it outside the repository and run ``python -m
pytest test_docker_image_runtime.py`` on a Docker host with pytest installed.
No application packages are required on that host; they run inside the image.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import textwrap
import uuid
from collections.abc import Callable, Iterator

import pytest

IMAGE = os.environ.get("OCTOP_TEST_IMAGE", "")


def _docker(args: list[str], *, script: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args],
        input=script,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )


@pytest.fixture(scope="module", autouse=True)
def _require_image() -> None:
    if not IMAGE or not shutil.which("docker"):
        pytest.skip("set OCTOP_TEST_IMAGE to a locally built image; Docker is required")
    try:
        for args in (["info"], ["image", "inspect", IMAGE]):
            result = _docker(args)
            if result.returncode:
                pytest.skip(f"need a working Docker daemon and local image {IMAGE}")
    except (OSError, subprocess.TimeoutExpired):
        pytest.skip("Docker daemon unavailable")


@pytest.fixture
def isolated_runtime() -> Iterator[Callable[[str], str]]:
    """Each invocation is a new container; only this test's volume is shared."""
    prefix = f"hivework-runtime-test-{uuid.uuid4().hex}"
    volume = f"{prefix}-data"
    containers: list[str] = []
    created = _docker(["volume", "create", volume])
    assert created.returncode == 0, created.stderr

    def run(script: str) -> str:
        name = f"{prefix}-{len(containers)}"
        containers.append(name)
        result = _docker(
            [
                "run",
                "--rm",
                "-i",
                "--name",
                name,
                "--network",
                "none",
                "--cap-drop",
                "ALL",
                "-e",
                "HOME=/data",
                "-e",
                "OCTOP_HOME=/data/.octop",
                "-e",
                "PIP_NO_INDEX=1",
                "-e",
                "PIP_DISABLE_PIP_VERSION_CHECK=1",
                "-e",
                "npm_config_offline=true",
                "-v",
                f"{volume}:/data/.octop",
                IMAGE,
                "python",
                "-",
            ],
            script=textwrap.dedent(script),
        )
        assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
        return result.stdout

    try:
        yield run
    finally:
        # UUID ownership is local to this fixture; never enumerate Docker resources.
        for name in containers:
            _docker(["rm", "-f", name])
        _docker(["volume", "rm", volume])


@pytest.mark.slow
def test_runtime_commands_and_desktop_scripts(isolated_runtime: Callable[[str], str]) -> None:
    output = isolated_runtime(r"""
        import json
        import shlex
        import subprocess
        import sys
        from pathlib import Path
        from octop_harness.backends.local_shell import HarnessLocalShellBackend

        assert sys.prefix == "/app/.venv", sys.prefix
        workspace = Path("/tmp/runtime-workspace")
        workspace.mkdir()
        probe = workspace / "probe.py"
        probe.write_text("import json,sys; print(json.dumps({'prefix':sys.prefix,'exe':sys.executable}))")
        backend = HarnessLocalShellBackend(root_dir=workspace, virtual_mode=False)
        commands = [f"{command} {shlex.quote(str(probe))}" for command in ("python", "python3")]
        commands.append("bash -lc " + shlex.quote(commands[0]))
        for invocation in commands:
            result = backend.execute(invocation)
            assert result.exit_code == 0, result.output
            assert json.loads(result.output)["prefix"] == sys.prefix, result.output
            assert json.loads(result.output)["exe"].startswith("/app/.venv/bin/python"), result.output
        for command in ("pip --version", "python -m pip --version",
                        "node --version", "npm --version", "npx --version"):
            result = backend.execute(command)
            assert result.exit_code == 0, (command, result.output)
            if "pip" in command:
                assert "/app/.venv/" in result.output, result.output
        scripts = list(Path("/app/src/octop/infra/desktop/scripts").rglob("*.sh"))
        assert scripts, "packaged desktop scripts missing"
        for relative in (
            "infra/agents/builtin_skills/skill-manager/SKILL.md",
            "infra/agents/experts/library/wechat-ops/skills/publisher-multi-platform/SKILL.md",
        ):
            assert (Path("/app/src/octop") / relative).is_file(), relative
        for script in scripts:
            assert b"\r\n" not in script.read_bytes(), script
            result = subprocess.run(["bash", "-n", str(script)], capture_output=True, text=True)
            assert result.returncode == 0, (script, result.stderr)
        print("runtime-and-scripts-ok")
    """)
    assert "runtime-and-scripts-ok" in output


@pytest.mark.slow
@pytest.mark.parametrize("dependency_source", ["requires", "requirements"])
def test_plugin_archive_installs_python_dependency(
    isolated_runtime: Callable[[str], str], dependency_source: str
) -> None:
    # Build a tiny pure-Python wheel with stdlib only. pip must install it into
    # the application's interpreter before the plugin entry point can import it.
    script = r"""
        import base64
        import hashlib
        import importlib.util
        import json
        import os
        import sys
        import tempfile
        import zipfile
        from pathlib import Path
        from octop.infra.agents.plugins.manager import PluginManager

        source = DEPENDENCY_SOURCE
        module = "hivework_runtime_fixture"
        assert importlib.util.find_spec(module) is None
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dist = module + "-1.0.dist-info"
            files = {
                module + "/__init__.py": b"VALUE = 'installed-by-plugin'\n",
                dist + "/METADATA": (
                    "Metadata-Version: 2.1\nName: hivework-runtime-fixture\nVersion: 1.0\n"
                ).encode(),
                dist + "/WHEEL": (
                    "Wheel-Version: 1.0\nGenerator: runtime-test\n"
                    "Root-Is-Purelib: true\nTag: py3-none-any\n"
                ).encode(),
            }
            records = []
            for path, data in files.items():
                digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=")
                records.append(f"{path},sha256={digest.decode()},{len(data)}")
            records.append(f"{dist}/RECORD,,")
            files[dist + "/RECORD"] = ("\n".join(records) + "\n").encode()
            wheel = root / (module + "-1.0-py3-none-any.whl")
            with zipfile.ZipFile(wheel, "w") as archive:
                for path, data in files.items():
                    archive.writestr(path, data)
            os.environ["PIP_FIND_LINKS"] = str(root)
            manifest = {"id": "runtime-fixture", "version": "1.0", "entry": "main.py"}
            if source == "requires":
                manifest["requires"] = ["hivework-runtime-fixture==1.0"]
            plugin_zip = root / "plugin.zip"
            with zipfile.ZipFile(plugin_zip, "w") as archive:
                archive.writestr("plugin.yaml", json.dumps(manifest))
                archive.writestr("main.py", (
                    "from hivework_runtime_fixture import VALUE\n"
                    "def setup(ctx):\n"
                    "    assert VALUE == 'installed-by-plugin'\n"
                ))
                if source == "requirements":
                    archive.writestr("requirements.txt", "hivework-runtime-fixture==1.0\n")
            manager = PluginManager(plugins_dir=root / "installed", config_path=root / "config.json")
            loaded = manager.install_archive(plugin_zip)
            assert loaded.manifest.id == "runtime-fixture"
            import hivework_runtime_fixture
            assert str(Path(hivework_runtime_fixture.__file__).resolve()).startswith(sys.prefix + "/")
            assert hivework_runtime_fixture.VALUE == "installed-by-plugin"
        print("plugin-dependency-ok")
    """
    output = isolated_runtime(script.replace("DEPENDENCY_SOURCE", repr(dependency_source)))
    assert "plugin-dependency-ok" in output


@pytest.mark.slow
def test_global_npm_cli_survives_container_recreation(
    isolated_runtime: Callable[[str], str],
) -> None:
    installed = isolated_runtime(r"""
        import io
        import json
        import subprocess
        import tarfile
        from pathlib import Path

        package = {"name": "hivework-runtime-fixture", "version": "1.0.0",
                   "bin": {"hivework-runtime-cli": "cli.js"}}
        tarball = Path("/tmp/runtime-fixture.tgz")
        with tarfile.open(tarball, "w:gz") as archive:
            for name, data in {
                "package/package.json": json.dumps(package).encode(),
                "package/cli.js": b"#!/usr/bin/env node\nconsole.log('persistent-cli-ok');\n",
            }.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o755 if name.endswith(".js") else 0o644
                archive.addfile(info, io.BytesIO(data))
        subprocess.run(["npm", "install", "--global", "--offline", "--ignore-scripts",
                        "--no-audit", "--no-fund", str(tarball)], check=True)
        subprocess.run(["hivework-runtime-cli"], check=True)
        assert Path("/data/.local").resolve() == Path("/data/.octop/tools/local")
        assert Path("/data/.skillhub").resolve() == Path("/data/.octop/tools/skillhub")
        skillhub = Path("/data/.skillhub/bin/runtime-skillhub-fixture")
        skillhub.parent.mkdir(parents=True, exist_ok=True)
        skillhub.write_text("#!/bin/sh\nprintf 'persistent-skillhub-ok\\n'\n")
        skillhub.chmod(0o755)
    """)
    assert "persistent-cli-ok" in installed
    recreated = isolated_runtime(r"""
        import shlex
        from pathlib import Path
        from octop_harness.backends.local_shell import HarnessLocalShellBackend

        assert not Path("/tmp/runtime-fixture.tgz").exists(), "container was not recreated"
        backend = HarnessLocalShellBackend(root_dir="/tmp", virtual_mode=False)
        for command, expected in (("hivework-runtime-cli", "persistent-cli-ok"),
                                  ("runtime-skillhub-fixture", "persistent-skillhub-ok")):
            for invocation in (command, "bash -lc " + shlex.quote(command)):
                result = backend.execute(invocation)
                assert result.exit_code == 0, result.output
                assert expected in result.output, result.output
        print("recreated-container-ok")
    """)
    assert "recreated-container-ok" in recreated
