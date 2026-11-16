param(
    [ValidateSet('Install', 'Remove')]
    [string] $Action,
    [ValidateSet('Machine', 'User')]
    [string] $Scope = 'Machine',
    [string] $InstallDirectory
)

$ErrorActionPreference = 'Stop'

function ConvertTo-HiveWorkComparablePath {
    param([string] $Entry)
    $expanded = [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"'))
    return $expanded.Replace('/', '\').TrimEnd('\')
}

function Update-HiveWorkPath {
    param(
        [Microsoft.Win32.RegistryKey] $EnvironmentKey,
        [ValidateSet('Install', 'Remove')]
        [string] $Action,
        [string] $BinDirectory
    )

    # Read the full, unexpanded value. NSIS string limits and setx would truncate
    # long PATH values or replace references such as %SystemRoot% permanently.
    $value = $EnvironmentKey.GetValue(
        'Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    )
    if ($null -ne $value -and $value -isnot [string]) {
        throw 'PATH must be a string registry value.'
    }
    $original = [string] $value
    $target = ConvertTo-HiveWorkComparablePath $BinDirectory
    $entries = @($original -split ';')
    $remaining = @($entries | Where-Object {
        (ConvertTo-HiveWorkComparablePath $_) -ine $target
    })

    if ($Action -eq 'Install') {
        if ($remaining.Count -ne $entries.Count) {
            return $false
        }
        $updated = if ($original.Length) { "$original;$BinDirectory" } else { $BinDirectory }
    }
    else {
        if ($remaining.Count -eq $entries.Count) {
            return $false
        }
        $updated = [string]::Join(';', [string[]] $remaining)
    }

    $kind = if ($null -eq $value) {
        [Microsoft.Win32.RegistryValueKind]::ExpandString
    }
    else {
        $EnvironmentKey.GetValueKind('Path')
    }
    $EnvironmentKey.SetValue('Path', $updated, $kind)
    return $true
}

# Dot-sourcing exposes the same registry operation to isolated-key tests.
if ($MyInvocation.InvocationName -eq '.') {
    return
}

try {
    if (-not $Action -or -not $InstallDirectory) {
        throw 'Action and InstallDirectory are required.'
    }
    $binDirectory = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'bin'))
    $hive = if ($Scope -eq 'Machine') {
        [Microsoft.Win32.RegistryHive]::LocalMachine
    }
    else {
        [Microsoft.Win32.RegistryHive]::CurrentUser
    }
    $subkey = if ($Scope -eq 'Machine') {
        'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    }
    else {
        'Environment'
    }
    $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        $hive, [Microsoft.Win32.RegistryView]::Default
    )
    try {
        $key = $root.CreateSubKey($subkey, $true)
        try {
            [void] (Update-HiveWorkPath $key $Action $binDirectory)
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        $root.Dispose()
    }
    exit 0
}
catch {
    [Console]::Error.WriteLine("HiveWork CLI PATH update failed: $_")
    exit 1
}
