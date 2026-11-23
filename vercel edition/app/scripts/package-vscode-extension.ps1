$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = Join-Path $root "vscode-extension"
$outputDirectory = Join-Path $root "release"
$output = Join-Path $outputDirectory "TF-CODE-Agent-Bridge.vsix"
$publicDownloadDirectory = Join-Path $root "public\downloads"
$publicDownload = Join-Path $publicDownloadDirectory "TF-CODE-Agent-Bridge.vsix"
$temporaryArchive = Join-Path $outputDirectory "TF-CODE-Agent-Bridge-$([guid]::NewGuid().ToString('N')).zip"
$stage = Join-Path $env:TEMP "taskflow-vsix-$([guid]::NewGuid().ToString('N'))"

foreach ($required in @(
  "package.json",
  "extension.js",
  "actionProtocol.js",
  "originProtocol.js",
  "resources\taskflow.svg",
  "extension.vsixmanifest",
  "[Content_Types].xml"
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $required))) {
    throw "VS Code extension input is missing: $required"
  }
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "extension\resources") | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  Copy-Item -LiteralPath (Join-Path $source "package.json") -Destination (Join-Path $stage "extension\package.json")
  Copy-Item -LiteralPath (Join-Path $source "extension.js") -Destination (Join-Path $stage "extension\extension.js")
  Copy-Item -LiteralPath (Join-Path $source "actionProtocol.js") -Destination (Join-Path $stage "extension\actionProtocol.js")
  Copy-Item -LiteralPath (Join-Path $source "originProtocol.js") -Destination (Join-Path $stage "extension\originProtocol.js")
  Copy-Item -LiteralPath (Join-Path $source "resources\taskflow.svg") -Destination (Join-Path $stage "extension\resources\taskflow.svg")
  Copy-Item -LiteralPath (Join-Path $source "extension.vsixmanifest") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $source "[Content_Types].xml") -Destination $stage
  $archive = [System.IO.Compression.ZipFile]::Open(
    $temporaryArchive,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($entry in @(
      @{ Source = (Join-Path $stage "extension\package.json"); Name = "extension/package.json" },
      @{ Source = (Join-Path $stage "extension\extension.js"); Name = "extension/extension.js" },
      @{ Source = (Join-Path $stage "extension\actionProtocol.js"); Name = "extension/actionProtocol.js" },
      @{ Source = (Join-Path $stage "extension\originProtocol.js"); Name = "extension/originProtocol.js" },
      @{ Source = (Join-Path $stage "extension\resources\taskflow.svg"); Name = "extension/resources/taskflow.svg" },
      @{ Source = (Join-Path $stage "extension.vsixmanifest"); Name = "extension.vsixmanifest" },
      @{ Source = (Join-Path $stage "[Content_Types].xml"); Name = "[Content_Types].xml" }
    )) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $entry.Source,
        $entry.Name,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
  Move-Item -LiteralPath $temporaryArchive -Destination $output -Force
  New-Item -ItemType Directory -Force -Path $publicDownloadDirectory | Out-Null
  Copy-Item -LiteralPath $output -Destination $publicDownload -Force
} finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
  if (Test-Path -LiteralPath $temporaryArchive) {
    Remove-Item -LiteralPath $temporaryArchive -Force
  }
}

Write-Output "Created VS Code extension package: $output"
