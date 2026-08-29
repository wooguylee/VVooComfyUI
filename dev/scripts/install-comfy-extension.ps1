[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$ComfyRoot,

    [Parameter()]
    [switch]$ForceTokenRotation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Resolve-ComfyRoot {
    param([Parameter()][string]$ExplicitRoot)

    if ($ExplicitRoot) {
        $resolvedRoot = (Resolve-Path -LiteralPath $ExplicitRoot).Path
        if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'custom_nodes') -PathType Container)) {
            throw "ComfyRoot must contain a custom_nodes directory: $resolvedRoot"
        }
        return Get-NormalizedPath $resolvedRoot
    }

    $installationsPath = Join-Path $env:APPDATA 'Comfy Desktop\installations.json'
    if (-not (Test-Path -LiteralPath $installationsPath -PathType Leaf)) {
        throw "Comfy Desktop installations file was not found: $installationsPath"
    }

    $installations = @(Get-Content -Raw -LiteralPath $installationsPath | ConvertFrom-Json)
    $matches = @(
        $installations | Where-Object {
            $_.name -eq 'ComfyUI' -and
            $_.status -eq 'installed' -and
            $_.sourceId -ne 'cloud' -and
            -not [string]::IsNullOrWhiteSpace([string]$_.installPath)
        }
    )
    if ($matches.Count -ne 1) {
        throw "Expected exactly one installed local ComfyUI record, found $($matches.Count)"
    }

    $candidate = Join-Path ([string]$matches[0].installPath) 'ComfyUI'
    $resolvedRoot = (Resolve-Path -LiteralPath $candidate).Path
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'custom_nodes') -PathType Container)) {
        throw "Detected ComfyUI root does not contain custom_nodes: $resolvedRoot"
    }
    return Get-NormalizedPath $resolvedRoot
}

function Get-JunctionTarget {
    param([Parameter(Mandatory = $true)]$Item)

    $rawTarget = @($Item.Target)[0]
    if ([string]::IsNullOrWhiteSpace([string]$rawTarget)) {
        return $null
    }
    if (-not [System.IO.Path]::IsPathRooted([string]$rawTarget)) {
        $rawTarget = Join-Path $Item.Parent.FullName ([string]$rawTarget)
    }
    return Get-NormalizedPath ([string]$rawTarget)
}

$projectRoot = Get-NormalizedPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$source = Get-NormalizedPath (Resolve-Path -LiteralPath (
    Join-Path $projectRoot 'comfy-extension\vvoo_comfy_mcp'
)).Path
$legacySource = Get-NormalizedPath (Join-Path (
    Split-Path -Parent $projectRoot
) 'comfy-extension\vvoo_comfy_mcp')
$resolvedComfyRoot = Resolve-ComfyRoot $ComfyRoot
$customNodesRoot = Get-NormalizedPath (Resolve-Path -LiteralPath (
    Join-Path $resolvedComfyRoot 'custom_nodes'
)).Path
$destination = Get-NormalizedPath (Join-Path $customNodesRoot 'vvoo_comfy_mcp')

if (-not $destination.StartsWith(
    "$customNodesRoot$([System.IO.Path]::DirectorySeparatorChar)",
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "Extension destination escaped the ComfyUI custom_nodes directory: $destination"
}

$junctionState = 'planned-create'
$junctionNeedsCreation = $true
$junctionNeedsMigration = $false
if (Test-Path -LiteralPath $destination) {
    $existing = Get-Item -Force -LiteralPath $destination
    if ($existing.LinkType -ne 'Junction') {
        throw "Extension destination exists and is not a junction: $destination"
    }
    $existingTarget = Get-JunctionTarget $existing
    if (-not [string]::Equals(
        $existingTarget,
        $source,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        if ([string]::Equals(
            $existingTarget,
            $legacySource,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            $junctionState = 'planned-legacy-migration'
            $junctionNeedsMigration = $true
        } else {
            throw "Extension junction points elsewhere: $destination -> $existingTarget"
        }
    } else {
        $junctionState = 'already-installed'
        $junctionNeedsCreation = $false
    }
}

$tokenDirectory = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'VVooComfyUI')
$tokenPath = Get-NormalizedPath (Join-Path $tokenDirectory 'bridge-token')
$tokenExists = Test-Path -LiteralPath $tokenPath -PathType Leaf
$tokenState = if ($tokenExists -and -not $ForceTokenRotation) {
    'already-present'
} elseif ($ForceTokenRotation) {
    'planned-rotation'
} else {
    'planned-create'
}

if (-not $tokenExists -or $ForceTokenRotation) {
    if ($PSCmdlet.ShouldProcess($tokenPath, 'Create local Comfy canvas bridge token')) {
        [System.IO.Directory]::CreateDirectory($tokenDirectory) | Out-Null
        $randomBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $token = [System.Convert]::ToHexString($randomBytes).ToLowerInvariant()
        [System.IO.File]::WriteAllText(
            $tokenPath,
            $token,
            [System.Text.UTF8Encoding]::new($false)
        )
        $tokenState = if ($ForceTokenRotation) { 'rotated' } else { 'created' }
    }
}

if ($junctionNeedsMigration -and $PSCmdlet.ShouldProcess(
    $destination,
    "Replace known legacy junction target $legacySource"
)) {
    Remove-Item -LiteralPath $destination
}

if ($junctionNeedsCreation -and $PSCmdlet.ShouldProcess($destination, "Create junction to $source")) {
    New-Item -ItemType Junction -Path $destination -Target $source | Out-Null
    $junctionState = if ($junctionNeedsMigration) { 'legacy-migrated' } else { 'created' }
}

[pscustomobject]@{
    ProjectRoot = $projectRoot
    ComfyRoot = $resolvedComfyRoot
    Source = $source
    Destination = $destination
    TokenPath = $tokenPath
    TokenState = $tokenState
    JunctionState = $junctionState
    RestartRequired = $true
}
