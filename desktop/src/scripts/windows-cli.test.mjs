import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const buildDir = resolve(here, "../build");
const windows = process.platform === "win32";
const artifacts = process.env.HIVEWORK_CLI_TEST_ARTIFACTS
  ?? resolve(here, "../../../logs/desktop-cli-tests");
const powershell = windows
  ? join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe")
  : "powershell.exe";

function fixture() {
  mkdirSync(artifacts, { recursive: true });
  return mkdtempSync(join(artifacts, "hivework-cli-"));
}

function runPowerShell(source, env = {}) {
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", source],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return result.stdout;
}

test("PATH updates preserve long values, expansion, scope data and unrelated entries", { skip: !windows }, () => {
  const output = runPowerShell(`
$ErrorActionPreference = 'Stop'
. $env:HIVEWORK_PATH_SCRIPT
$subkey = 'Software\\HiveWork\\CliTests\\' + [Guid]::NewGuid().ToString('N')
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subkey)
function Assert-Equal($actual, $expected) {
    if ($actual -cne $expected) { throw "Expected [$expected], received [$actual]" }
}
function Read-RawPath {
    return $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
try {
    $bin = 'C:\\Program Files\\HiveWork\\bin'
    $other = 'C:\\Other HiveWork\\bin'
    $original = '%SystemRoot%\\System32;' + (('C:\\UnrelatedTool;' * 1600)) + $other + ';;'
    $key.SetValue('Path', $original, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    $key.SetValue('Unrelated', 'must remain')
    Assert-Equal (Update-HiveWorkPath $key Install $bin) $true
    Assert-Equal (Read-RawPath) ($original + ';' + $bin)
    Assert-Equal ($key.GetValueKind('Path')) ([Microsoft.Win32.RegistryValueKind]::ExpandString)
    Assert-Equal (Update-HiveWorkPath $key Install $bin) $false
    Assert-Equal (Read-RawPath) ($original + ';' + $bin)
    Assert-Equal (Update-HiveWorkPath $key Remove $bin) $true
    Assert-Equal (Read-RawPath) $original
    Assert-Equal ($key.GetValue('Unrelated')) 'must remain'
    Assert-Equal (Update-HiveWorkPath $key Remove $bin) $false

    $key.SetValue('Path', 'C:\\First;"c:/program files/HIVEWORK/bin/";' + $other + ';' + $bin + ';C:\\Last', [Microsoft.Win32.RegistryValueKind]::String)
    Assert-Equal (Update-HiveWorkPath $key Install $bin) $false
    Assert-Equal (Update-HiveWorkPath $key Remove $bin) $true
    Assert-Equal (Read-RawPath) ('C:\\First;' + $other + ';C:\\Last')
    Assert-Equal ($key.GetValueKind('Path')) ([Microsoft.Win32.RegistryValueKind]::String)

    $key.DeleteValue('Path')
    Assert-Equal (Update-HiveWorkPath $key Remove $bin) $false
    Assert-Equal (Read-RawPath) $null
    Assert-Equal (Update-HiveWorkPath $key Install $bin) $true
    Assert-Equal (Read-RawPath) $bin
    Assert-Equal (Update-HiveWorkPath $key Remove $bin) $true
    Assert-Equal (Read-RawPath) ''
    Write-Output 'isolated-registry-path-tests-passed'
}
finally {
    $key.Dispose()
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subkey, $false)
}
`, { HIVEWORK_PATH_SCRIPT: join(buildDir, "hivework-path.ps1") });
  assert.match(output, /isolated-registry-path-tests-passed/);
});

test("hivework.cmd forwards arguments and exit codes from a path containing spaces", { skip: !windows }, () => {
  const root = join(fixture(), "Hive Work (test) ! 中文");
  const bin = join(root, "bin");
  const sidecar = join(root, "resources/sidecar");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sidecar, "runtime"), { recursive: true });
  copyFileSync(join(buildDir, "hivework.cmd"), join(bin, "hivework.cmd"));
  writeFileSync(join(sidecar, "launch.py"), "# Argument probe; not executed by the stub.\n");
  runPowerShell(`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
public class CliProbe {
    public static int Main(string[] args) {
        foreach (string arg in args)
            Console.WriteLine("ARG:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
        return Int32.Parse(Environment.GetEnvironmentVariable("HIVEWORK_CLI_TEST_EXIT"));
    }
}
'@ -OutputAssembly $env:HIVEWORK_CLI_TEST_PYTHON -OutputType ConsoleApplication
`, { HIVEWORK_CLI_TEST_PYTHON: join(sidecar, "runtime/python.exe") });

  for (const status of [0, 23]) {
    const result = spawnSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", 'hivework user passwd "a name" --password "P a!&中文(123)" --json'],
      {
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PATH: bin + ";" + process.env.PATH,
          PYTHONHOME: "C:\\Nonexistent Conda",
          PYTHONPATH: "C:\\Conflicting Python Packages",
          HIVEWORK_CLI_TEST_EXIT: String(status),
        },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    assert.equal(result.status, status, result.stderr || String(result.error));
    const args = result.stdout.trim().split(/\r?\n/)
      .map((line) => Buffer.from(line.slice("ARG:".length), "base64").toString("utf8"));
    assert.equal(args[0], "-I");
    assert.equal(resolve(args[1]), join(sidecar, "launch.py"));
    assert.deepEqual(args.slice(2), [
      "user", "passwd", "a name", "--password", "P a!&中文(123)", "--json",
    ]);
  }
});

test("the installed command runs the bundled official CLI despite foreign Python dependencies", {
  skip: !windows || !process.env.HIVEWORK_CLI_TEST_PORTABLE,
}, () => {
  const root = join(fixture(), "HiveWork real runtime with spaces");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, "resources"));
  copyFileSync(join(buildDir, "hivework.cmd"), join(bin, "hivework.cmd"));
  symlinkSync(resolve(process.env.HIVEWORK_CLI_TEST_PORTABLE), join(root, "resources/sidecar"), "junction");
  const foreign = join(root, "foreign packages");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "click.py"), 'raise RuntimeError("foreign click imported")\n');
  writeFileSync(join(foreign, "pydantic.py"), 'raise RuntimeError("foreign pydantic imported")\n');
  const output = runPowerShell(`
$ErrorActionPreference = 'Stop'
& hivework user passwd --help
exit $LASTEXITCODE
`, {
    PATH: bin + ";" + process.env.PATH,
    PYTHONHOME: "C:\\Nonexistent Conda",
    PYTHONPATH: foreign,
    PYTHONUSERBASE: join(root, "foreign-userbase"),
    OCTOP_HOME: join(root, "isolated-app-home"),
    PYTHONDONTWRITEBYTECODE: "1",
  });
  assert.match(output, /Reset a user's password/);
  assert.match(output, /--password/);
});

test("Windows packaging carries both command files and installer registers and removes PATH", () => {
  const installer = readFileSync(join(buildDir, "installer.nsh"), "utf8");
  const config = readFileSync(resolve(here, "../electron-builder.config.ts"), "utf8");
  const metadata = readFileSync(resolve(here, "../../../pyproject.toml"), "utf8");
  assert.match(config, /from: "build\/hivework\.cmd", to: "bin\/hivework\.cmd"/);
  assert.match(config, /from: "build\/hivework-path\.ps1", to: "hivework-path\.ps1"/);
  assert.match(installer, /!insertmacro hiveworkUpdateCliPath Install/);
  assert.ok(
    installer.indexOf("!insertmacro hiveworkUpdateCliPath Remove")
      < installer.indexOf('RMDir /r "$INSTDIR\\resources\\sidecar"'),
  );
  assert.match(installer, /\$installMode == "all"/);
  assert.match(installer, /SendMessage 0xffff 0x001a 0 "STR:Environment" \/TIMEOUT=5000/);
  const scripts = metadata.split("[project.scripts]")[1].split("\n[")[0];
  assert.match(scripts, /^octop = "octop\.cli\.main:cli"$/m);
  assert.match(scripts, /^hivework = "octop\.cli\.main:cli"$/m);
});
