# Windows smoke check for the SoLoVault helpers, run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\windows-smoke.ps1
# Runs the exact form SKILL.md documents (& "<Git Bash>" scripts/<helper> ...) against a
# stub solovault-agent that accepts only a throwaway key, so it never touches the real
# vault or the owner's key. Checks:
#   1. solovault-run.sh delivers the value to the command and does not pass the agent key on.
#   2. solovault-write.sh takes the value from $env:<VAR>, pipes it to the agent and prints
#      only the entry ID, never the value.
#   3. With no SOLOVAULT_AGENT_KEY, the helpers read the key from Windows Credential Manager
#      (a temporary generic credential this script creates and deletes).
#   4. A missing Credential Manager entry stops the helper and names the entry.
#   5. WSL bash (if present) also reads the key from Credential Manager through powershell.exe.
param([string]$GitBash = "C:\Program Files\Git\bin\bash.exe")
# Native stderr must not become a terminating error in Windows PowerShell 5.1; every
# outcome is checked explicitly below.
$ErrorActionPreference = 'Continue'
if (-not (Test-Path $GitBash)) { "Git Bash not found at $GitBash"; exit 1 }

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class SvSmokeCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public int LastWrittenLow; public int LastWrittenHigh; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWrite(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredDelete(string t, int type, int flags);
  public static void Write(string target, string secret) {
    byte[] b = Encoding.Unicode.GetBytes(secret); IntPtr p = Marshal.AllocHGlobal(b.Length);
    try { Marshal.Copy(b, 0, p, b.Length);
      var c = new CREDENTIAL { Type = 1, TargetName = target, UserName = "smoke", CredentialBlob = p, CredentialBlobSize = b.Length, Persist = 2 };
      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(p); } }
  public static void Delete(string target) { CredDelete(target, 1, 0); }
}
'@

$skill = Split-Path $PSScriptRoot -Parent
$id = [guid]::NewGuid().ToString('N')
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("svsmoke-" + $id)
New-Item -ItemType Directory $tmp | Out-Null
$sentinel = 'SENTINEL-not-a-real-secret-' + $id.Substring(0, 8)
$smokeKey = 'sv-smoke-key-not-real-' + $id.Substring(8, 8)
$target = "solovault-smoke:$id"
$saved = @{}
$names = 'SOLOVAULT_URL', 'SOLOVAULT_AGENT_KEY', 'SOLOVAULT_AGENT_BIN', 'SOLOVAULT_ENTRY_MAP', 'SOLOVAULT_KEY_NAME',
  'NEW_TOKEN', 'SMOKE_SENTINEL', 'SMOKE_KEY', 'SMOKE_DIR', 'WSLENV'
foreach ($n in $names) { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
$failed = 0
function Check($name, $ok) {
  if ($ok) { "PASS  $name" } else { "FAIL  $name"; $script:failed++ }
}
# C:\x\y -> /c/x/y (Git Bash's mount for drive C:) and \\server\share\x -> //server/share/x.
# Done here rather than with cygpath, which is not on PATH for every bash.exe in a Git install.
function ToUnix($p) {
  $full = [IO.Path]::GetFullPath($p)
  if ($full.StartsWith('\\')) { return $full.Replace('\', '/') }
  '/' + $full.Substring(0, 1).ToLower() + $full.Substring(2).Replace('\', '/')
}
# WSL mounts drive C: at /mnt/c.
function ToWsl($p) {
  $full = [IO.Path]::GetFullPath($p)
  '/mnt/' + $full.Substring(0, 1).ToLower() + $full.Substring(2).Replace('\', '/')
}
function NoLeak($out) { -not ($out.Contains($sentinel) -or $out.Contains($smokeKey)) }

try {
  # Stub agent: accepts only the throwaway key. get prints the sentinel; create/update record
  # the stdin length and answer with an ID; list shows that ID.
  $stub = @'
#!/usr/bin/env bash
[ "${SOLOVAULT_AGENT_KEY:-}" = "$SMOKE_KEY" ] || { echo "solovault-agent: BAD_KEY" >&2; exit 1; }
case "$1" in
  get) printf '%s\n' "$SMOKE_SENTINEL" ;;
  create|update) v="$(cat)"; printf '%s' "${#v}" > "$SMOKE_DIR/stdin-length"; printf '{"id":"stub-1","writeDate":"1"}\n' ;;
  list) printf '{"entries":[{"id":"stub-1"}]}\n' ;;
  *) exit 1 ;;
esac
'@
  $dest = @'
#!/usr/bin/env bash
[ "${TOKEN:-}" = "$SMOKE_SENTINEL" ] && echo destination-got-value || echo destination-wrong-value
[ -z "${SOLOVAULT_AGENT_KEY:-}" ] && echo agent-key-not-passed || echo agent-key-LEAKED
'@
  [IO.File]::WriteAllText("$tmp\solovault-agent", $stub.Replace("`r`n", "`n"))
  [IO.File]::WriteAllText("$tmp\dest.sh", $dest.Replace("`r`n", "`n"))
  [SvSmokeCred]::Write($target, $smokeKey)

  # Belt and braces: even if the stub were bypassed, a real CLI could not reach the vault.
  $env:SOLOVAULT_URL = 'https://127.0.0.1:9/server'
  $env:SOLOVAULT_AGENT_KEY = $smokeKey
  $env:SOLOVAULT_AGENT_BIN = (ToUnix "$tmp\solovault-agent")
  $env:SOLOVAULT_ENTRY_MAP = (ToUnix "$tmp\map.txt")
  $env:SOLOVAULT_KEY_NAME = $target
  $env:SMOKE_SENTINEL = $sentinel
  $env:SMOKE_KEY = $smokeKey
  $env:SMOKE_DIR = (ToUnix $tmp)
  $destUnix = ToUnix "$tmp\dest.sh"

  Push-Location $skill
  try {
    # 1. Read helper, in the documented form (& "<Git Bash>" scripts/...); $GitBash is the
    #    documented default path unless -GitBash overrides it.
    $out = & $GitBash scripts/solovault-run.sh TOKEN=stub-1:password -- bash $destUnix 2>&1 | Out-String
    Check 'run: exit 0' ($LASTEXITCODE -eq 0)
    Check 'run: command received the value' ($out -match 'destination-got-value')
    Check 'run: agent key not passed on' ($out -match 'agent-key-not-passed')
    Check 'run: value not in output' (NoLeak $out)

    # 2. Write helper, in the documented form.
    $env:NEW_TOKEN = $sentinel
    $out = & $GitBash scripts/solovault-write.sh update stub-1 password=NEW_TOKEN 2>&1 | Out-String
    Check 'write: exit 0' ($LASTEXITCODE -eq 0)
    Check 'write: reports the entry ID' ($out -match 'updated entry stub-1')
    Check 'write: value reached the agent' ((Get-Content "$tmp\stdin-length" -Raw).Trim() -eq "$($sentinel.Length)")
    Check 'write: value not in output' (NoLeak $out)

    # 3. No SOLOVAULT_AGENT_KEY: the key comes from Credential Manager.
    Remove-Item Env:SOLOVAULT_AGENT_KEY
    $out = & $GitBash scripts/solovault-run.sh TOKEN=stub-1:password -- bash $destUnix 2>&1 | Out-String
    Check 'credman: exit 0' ($LASTEXITCODE -eq 0)
    Check 'credman: command received the value' ($out -match 'destination-got-value')
    Check 'credman: agent key not passed on' ($out -match 'agent-key-not-passed')
    Check 'credman: key and value not in output' (NoLeak $out)

    # 4. Missing Credential Manager entry: stop and name it.
    $env:SOLOVAULT_KEY_NAME = "solovault-smoke:missing-$id"
    $out = & $GitBash scripts/solovault-run.sh TOKEN=stub-1:password -- bash $destUnix 2>&1 | Out-String
    Check 'credman missing: stops with exit 4' ($LASTEXITCODE -eq 4)
    Check 'credman missing: error names the entry' ($out.Contains("solovault-smoke:missing-$id"))
    $env:SOLOVAULT_KEY_NAME = $target
  } finally { Pop-Location }

  # 5. WSL bash, if installed: reads the key from Credential Manager through powershell.exe.
  #    WSL sees only the variables WSLENV lists; SOLOVAULT_AGENT_KEY is not among them.
  $wsl = Join-Path $env:SystemRoot 'System32\bash.exe'
  if (Test-Path $wsl) {
    $probe = & $wsl -c 'echo ok' 2>$null | Out-String
    if ($probe -match 'ok') {
      $env:SOLOVAULT_AGENT_BIN = ToWsl "$tmp\solovault-agent"
      $env:WSLENV = 'SOLOVAULT_KEY_NAME:SOLOVAULT_AGENT_BIN:SOLOVAULT_URL:SMOKE_SENTINEL:SMOKE_KEY'
      $out = & $wsl (ToWsl "$skill\scripts\solovault-run.sh") TOKEN=stub-1:password -- bash (ToWsl "$tmp\dest.sh") 2>&1 | Out-String
      Check 'wsl: exit 0' ($LASTEXITCODE -eq 0)
      Check 'wsl: command received the value' ($out -match 'destination-got-value')
      Check 'wsl: agent key not passed on' ($out -match 'agent-key-not-passed')
      Check 'wsl: key and value not in output' (NoLeak $out)
    } else { "SKIP  wsl: no distribution responded" }
  } else { "SKIP  wsl: not installed" }
} finally {
  [SvSmokeCred]::Delete($target)
  foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
if ($failed) { "$failed check(s) failed"; exit 1 } else { 'all checks passed' }
