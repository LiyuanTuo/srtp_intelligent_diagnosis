param([int]$Port = 8000, [string]$BindAddress = '127.0.0.1', [string]$Certificate = '', [string]$PrivateKey = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$env:PYTHONUTF8 = '1'
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Create the .venv environment first; see README.md.' }
$serverArgs = @('-m', 'uvicorn', 'backend.app:app', '--host', $BindAddress, '--port', "$Port", '--no-access-log')
if ($Certificate -and $PrivateKey) { $serverArgs += @('--ssl-certfile', $Certificate, '--ssl-keyfile', $PrivateKey) }
elseif ($Certificate -or $PrivateKey) { throw 'Both Certificate and PrivateKey are required for HTTPS.' }
& $pythonPath @serverArgs

