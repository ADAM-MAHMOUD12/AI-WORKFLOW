$StageOnly = $args -contains "-StageOnly"
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$payload = Join-Path $env:SystemDrive "TFP-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$output = Join-Path $root "release"
$runtimeCache = Join-Path $output "offline-runtime"
$icon = Join-Path $root "installer\taskflow.ico"
$pythonVersion = "3.12.10"
$nodeVersion = "24.22.2"
$pythonArchive = Join-Path $runtimeCache "python-embed.zip"
$nodeArchive = Join-Path $runtimeCache "node-win-x64.zip"
$bunArchive = Join-Path $runtimeCache "bun-win-x64.zip"
$innoCompiler = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $innoCompiler) {
  $knownInnoCompiler = Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"
  if (Test-Path $knownInnoCompiler) {
    $innoCompiler = $knownInnoCompiler
  }
}

function Get-Download([string]$Uri, [string]$Destination) {
  if (-not (Test-Path $Destination)) {
    Invoke-WebRequest -Uri $Uri -OutFile $Destination
  }
  if ((Get-Item $Destination).Length -lt 1MB) {
    throw "The runtime download is incomplete: $Destination"
  }
}

function Copy-FilteredTree([string]$Source, [string]$Destination, [string[]]$ExcludedDirectories = @()) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $arguments = @($Source, $Destination, "/E", "/XJ", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS")
  if ($ExcludedDirectories.Count -gt 0) {
    $arguments += "/XD"
    $arguments += $ExcludedDirectories
  }
  $arguments += @("/XF", ".env", "desktop.ini", "*.pyc", "test_gemini.py")
  & robocopy @arguments
  if ($LASTEXITCODE -ge 8) {
    throw "Could not stage application files from $Source."
  }
}

function Restore-InternalJunctions([string]$Source, [string]$Destination, [string[]]$ExcludedTargets = @()) {
  $sourceRoot = (Resolve-Path $Source).Path.TrimEnd("\")
  $destinationRoot = (Resolve-Path $Destination).Path.TrimEnd("\")
  $junctions = Get-ChildItem $sourceRoot -Directory -Recurse -Force |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
  foreach ($junction in $junctions) {
    $target = [string]$junction.Target[0]
    if (-not $target.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "An application dependency points outside the installer source: $($junction.FullName)"
    }
    $relativeLink = $junction.FullName.Substring($sourceRoot.Length).TrimStart("\")
    $relativeTarget = $target.Substring($sourceRoot.Length).TrimStart("\")
    if ($ExcludedTargets -contains $relativeTarget) {
      continue
    }
    $destinationLink = Join-Path $destinationRoot $relativeLink
    $destinationTarget = Join-Path $destinationRoot $relativeTarget
    if (-not (Test-Path $destinationTarget)) {
      throw "The target of an application dependency was not staged: $relativeTarget"
    }
    New-Item -ItemType Junction -Path $destinationLink -Target $destinationTarget | Out-Null
  }
}

if (-not (Test-Path $icon)) {
  throw "The installer icon is missing: $icon"
}
if (Test-Path $payload) {
  throw "The temporary installer staging path already exists: $payload"
}
if (-not $innoCompiler) {
  throw "Inno Setup 6 (ISCC.exe) is required to compile the installer."
}
if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  throw "PyInstaller is required to build the Windows launcher."
}
if (-not (Test-Path (Join-Path $root "backend\.venv\Lib\site-packages\fastapi"))) {
  throw "The backend virtual environment must be prepared before building the offline installer."
}
foreach ($requiredPath in @(
  "OPENFILM-AI TASKFLOW EDITION.exe",
  "node_modules\vite\bin\vite.js",
  "vendor\aedifex\node_modules",
  "vendor\aedifex\apps\editor\.next\BUILD_ID",
  "vendor\opencalque\apps\web\dist\index.html"
)) {
  if (-not (Test-Path (Join-Path $root $requiredPath))) {
    throw "Offline installer input is missing: $requiredPath"
  }
}

Push-Location $root
try {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "package-vscode-extension.ps1")
  if ($LASTEXITCODE -ne 0) { throw "TF CODE VS Code extension packaging failed." }

  New-Item -ItemType Directory -Force -Path $output, $runtimeCache | Out-Null
  Get-Download "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" $pythonArchive
  Get-Download "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" $nodeArchive
  Get-Download "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip" $bunArchive

  $runtimeRoot = Join-Path $runtimeCache "runtime"
  if (Test-Path $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
  }
  $pythonRuntime = Join-Path $runtimeRoot "python"
  $nodeRuntime = Join-Path $runtimeRoot "node"
  New-Item -ItemType Directory -Force -Path $pythonRuntime, $nodeRuntime | Out-Null
  Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRuntime -Force
  $nodeExtract = Join-Path $runtimeCache "node-extract"
  if (Test-Path $nodeExtract) {
    Remove-Item -LiteralPath $nodeExtract -Recurse -Force
  }
  Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtract -Force
  $nodeRoot = Join-Path $nodeExtract "node-v$nodeVersion-win-x64"
  if (-not (Test-Path (Join-Path $nodeRoot "node.exe"))) {
    throw "The Node.js offline archive has an unexpected layout."
  }
  Copy-Item (Join-Path $nodeRoot "*") $nodeRuntime -Recurse -Force
  $bunExtract = Join-Path $runtimeCache "bun-extract"
  if (Test-Path $bunExtract) {
    Remove-Item -LiteralPath $bunExtract -Recurse -Force
  }
  Expand-Archive -LiteralPath $bunArchive -DestinationPath $bunExtract -Force
  $bunExecutable = Get-ChildItem $bunExtract -Filter bun.exe -File -Recurse | Select-Object -First 1
  if (-not $bunExecutable) {
    throw "The Bun offline archive does not contain bun.exe."
  }
  Copy-Item $bunExecutable.FullName (Join-Path $runtimeRoot "bun.exe") -Force

  $pythonPathFile = Get-ChildItem $pythonRuntime -Filter "python*._pth" -File | Select-Object -First 1
  if (-not $pythonPathFile) {
    throw "The Python embeddable archive does not contain its path configuration."
  }
  $sitePackages = Join-Path $pythonRuntime "Lib\site-packages"
  New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null
  Copy-Item (Join-Path $root "backend\.venv\Lib\site-packages\*") $sitePackages -Recurse -Force
  Set-Content -LiteralPath $pythonPathFile.FullName -Value @(
    "python312.zip",
    ".",
    "Lib\site-packages",
    "import site"
  ) -Encoding Ascii
  & (Join-Path $pythonRuntime "python.exe") -c "import cryptography, dotenv, fastapi, uvicorn"
  if ($LASTEXITCODE -ne 0) {
    throw "The bundled Python runtime failed its offline dependency check."
  }
  & (Join-Path $nodeRuntime "node.exe") -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=2)?0:1)"
  if ($LASTEXITCODE -ne 0) {
    throw "The bundled Node.js runtime is not supported by this application."
  }

  New-Item -ItemType Directory -Force -Path $payload | Out-Null
  $excludedRootDirectories = @(".git", ".vscode", "data", "release", "installer", "theia-app")
  foreach ($directory in Get-ChildItem $root -Directory -Force) {
    if ($excludedRootDirectories -contains $directory.Name) { continue }
    $destination = Join-Path $payload $directory.Name
    if ($directory.Name -eq "backend") {
      Copy-FilteredTree $directory.FullName $destination @(".venv", "data", "__pycache__", ".pytest_cache")
    } elseif ($directory.Name -eq "vendor") {
      $vendorExclusions = @(".git", ".turbo", ".cache", "coverage", "__pycache__")
      foreach ($cachePath in @(
        "aedifex\apps\editor\.next\dev",
        "aedifex\apps\editor\.next\cache"
      )) {
        $excludedCache = Join-Path $directory.FullName $cachePath
        if (Test-Path $excludedCache) {
          $vendorExclusions += $excludedCache
        }
      }
      $aedifex = Join-Path $directory.FullName "aedifex"
      $aedifexExclusions = $vendorExclusions + (Join-Path $aedifex "apps\ifc-converter")
      Copy-FilteredTree $aedifex (Join-Path $destination "aedifex") $aedifexExclusions
      Restore-InternalJunctions $aedifex (Join-Path $destination "aedifex") @("apps\ifc-converter")
      $openCalque = Join-Path $directory.FullName "opencalque"
      $openCalqueDestination = Join-Path $destination "opencalque"
      New-Item -ItemType Directory -Force -Path (Join-Path $openCalqueDestination "apps\web") | Out-Null
      Copy-Item (Join-Path $openCalque "start-editor.bat") $openCalqueDestination -Force
      Copy-FilteredTree (Join-Path $openCalque "apps\web\dist") (Join-Path $openCalqueDestination "apps\web\dist")
    } else {
      Copy-FilteredTree $directory.FullName $destination
    }
  }
  foreach ($file in Get-ChildItem $root -File -Force) {
    if ($file.Name -in @(".env", "desktop.ini", "OPENFILM-AI TASKFLOW EDITION.spec", "test_gemini.py")) { continue }
    Copy-Item $file.FullName $payload -Force
  }
  Copy-Item (Join-Path $output "TF-CODE-Agent-Bridge.vsix") (Join-Path $payload "vscode-extension\TF-CODE-Agent-Bridge.vsix") -Force
  Copy-Item $runtimeRoot (Join-Path $payload "runtime") -Recurse -Force

  foreach ($excludedPath in @("data", "backend\data", "backend\.venv", "release", "installer")) {
    if (Test-Path (Join-Path $payload $excludedPath)) {
      throw "Unexpected local or build data was copied into installer staging: $excludedPath"
    }
  }
  if (Get-ChildItem $payload -Filter ".env" -File -Recurse -Force) {
    throw "Environment files must not be included in the installer."
  }
  foreach ($requiredPath in @(
    "node_modules\vite\bin\vite.js",
    "vendor\aedifex\node_modules",
    "vendor\aedifex\apps\editor\.next\BUILD_ID",
    "vendor\opencalque\apps\web\dist\index.html",
    "runtime\python\python.exe",
    "runtime\node\node.exe",
    "runtime\bun.exe",
    "vscode-extension\TF-CODE-Agent-Bridge.vsix",
    "dist\index.html"
  )) {
    if (-not (Test-Path (Join-Path $payload $requiredPath))) {
      throw "A required offline application file was not staged: $requiredPath"
    }
  }

  pyinstaller --noconfirm --clean --onefile --noconsole --name "OPENFILM-AI TASKFLOW EDITION" --icon $icon --distpath $output --workpath (Join-Path $output "pyinstaller-work") --specpath $output scripts\launcher.py
  if ($LASTEXITCODE -ne 0) { throw "Windows launcher EXE build failed." }
  Copy-Item (Join-Path $output "OPENFILM-AI TASKFLOW EDITION.exe") (Join-Path $payload "OPENFILM-AI TASKFLOW EDITION.exe") -Force

  if ($StageOnly) {
    $stagedBytes = (Get-ChildItem $payload -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum
    Write-Output "Offline installer staging is ready ($([math]::Round($stagedBytes / 1GB, 2)) GB)."
    Write-Output "Staged at $payload"
    return
  }

  $env:TASKFLOW_INSTALLER_PAYLOAD = $payload
  & $innoCompiler "/Qp" (Join-Path $root "installer\AI-TaskFlow.iss")
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
  $extendedPayload = "\\?\$payload"
  & $env:ComSpec /d /c "rd /s /q `"$extendedPayload`" 2>nul"
  if (Test-Path $payload) {
    throw "The installer compiled, but its temporary staging directory could not be removed: $payload"
  }
} finally {
  Remove-Item Env:\TASKFLOW_INSTALLER_PAYLOAD -ErrorAction SilentlyContinue
  Pop-Location
}
