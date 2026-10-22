# Downloads a portable Node.js (current LTS, no install, no admin rights) into .node\ next to 설치.bat.
# Called by 설치.bat when Node.js 20+ is not installed.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root '.node'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1
$name = "node-$($lts.version)-win-$arch"
$zip = Join-Path $env:TEMP "$name.zip"
Write-Host "Node.js $($lts.version) downloading..."
Invoke-WebRequest "https://nodejs.org/dist/$($lts.version)/$name.zip" -OutFile $zip -UseBasicParsing
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$($lts.version)/SHASUMS256.txt" -UseBasicParsing).Content
$want = ($sums -split "`n" | Where-Object { $_ -match " $name.zip$" }) -replace ' .*$', ''
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $want.Trim().ToUpper()) { throw 'checksum mismatch' }
$tmp = Join-Path $env:TEMP "svg-engine-node"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Move-Item (Join-Path $tmp $name) $dest
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
