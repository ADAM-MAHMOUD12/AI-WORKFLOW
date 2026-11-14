$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $root "runtime\python\python.exe"
$node = Join-Path $root "runtime\node\node.exe"
$bun = Join-Path $root "runtime\bun.exe"

foreach ($required in @(
  $python,
  $node,
  $bun,
  (Join-Path $root "dist\index.html"),
  (Join-Path $root "node_modules\vite\bin\vite.js"),
  (Join-Path $root "vendor\aedifex\node_modules"),
  (Join-Path $root "vendor\aedifex\apps\editor\.next\BUILD_ID"),
  (Join-Path $root "vendor\opencalque\apps\web\dist\index.html")
)) {
  if (-not (Test-Path $required)) {
    throw "The offline installation is incomplete. Required file not found: $required"
  }
}

& $python -c "import cryptography, dotenv, fastapi, uvicorn"
if ($LASTEXITCODE -ne 0) {
  throw "The bundled Python runtime failed its dependency check."
}
& $node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=2)?0:1)"
if ($LASTEXITCODE -ne 0) {
  throw "The bundled Node.js runtime failed its version check."
}
& $bun --version
if ($LASTEXITCODE -ne 0) {
  throw "The bundled Bun runtime failed its startup check."
}

$launcher = Join-Path $root "start-all.bat"
& $env:ComSpec /d /c "call `"$launcher`" --install-only"
if ($LASTEXITCODE -ne 0) {
  throw "The installed application failed its offline startup validation."
}
