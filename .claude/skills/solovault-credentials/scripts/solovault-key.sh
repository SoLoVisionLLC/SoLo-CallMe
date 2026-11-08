# Sourced by solovault-run.sh and solovault-write.sh; not run on its own.
#
# solovault_load_key: make SOLOVAULT_AGENT_KEY available to this script without
# printing it. Order:
#   1. SOLOVAULT_AGENT_KEY already in the environment.
#   2. The machine's password manager, under the name in SOLOVAULT_KEY_NAME
#      (default "solovision-env:SOLOVAULT_AGENT_KEY"):
#        Windows (Git Bash, or WSL via powershell.exe): Credential Manager,
#          generic credential whose target is the name
#        macOS: Keychain generic password whose service is the name
#        Linux: Secret Service item with attributes service=<before ':'> key=<after ':'>
#          (default: service=solovision-env key=SOLOVAULT_AGENT_KEY)
# The value is exported only inside this process; the helpers unset it again
# before running the caller's command. Returns 1 with a reason on stderr when
# no source has it.

solovault_key_name="${SOLOVAULT_KEY_NAME:-solovision-env:SOLOVAULT_AGENT_KEY}"

_solovault_key_windows() {
  command -v powershell.exe >/dev/null 2>&1 || return 1
  command -v iconv >/dev/null 2>&1 || return 1
  local ps
  ps='$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class SvKeyRead {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public int LastWrittenLow; public int LastWrittenHigh; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredRead(string t, int type, int flags, out IntPtr c);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr c);
  public static string Read(string target) {
    IntPtr p; if (!CredRead(target, 1, 0, out p)) return "";
    try { var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2); } finally { CredFree(p); } }
}
"@
[Console]::Out.Write([SvKeyRead]::Read($env:SOLOVAULT_KEY_TARGET))'
  SOLOVAULT_KEY_TARGET="$solovault_key_name" WSLENV="${WSLENV:+$WSLENV:}SOLOVAULT_KEY_TARGET" \
    powershell.exe -NoProfile -NonInteractive -EncodedCommand \
    "$(printf '%s' "$ps" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')" 2>/dev/null | tr -d '\r'
}

_solovault_key_macos() {
  command -v security >/dev/null 2>&1 || return 1
  security find-generic-password -s "$solovault_key_name" -w 2>/dev/null
}

_solovault_key_linux() {
  command -v secret-tool >/dev/null 2>&1 || return 1
  secret-tool lookup service "${solovault_key_name%%:*}" key "${solovault_key_name#*:}" 2>/dev/null
}

solovault_load_key() {
  [ -n "${SOLOVAULT_AGENT_KEY:-}" ] && return 0
  local value="" store=""
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) store="Windows Credential Manager"; value="$(_solovault_key_windows || true)" ;;
    Darwin) store="the macOS Keychain"; value="$(_solovault_key_macos || true)" ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        store="Windows Credential Manager (from WSL)"; value="$(_solovault_key_windows || true)"
      else
        store="the Secret Service keyring"; value="$(_solovault_key_linux || true)"
      fi ;;
  esac
  if [ -n "$value" ]; then
    export SOLOVAULT_AGENT_KEY="$value"
    unset value
    return 0
  fi
  say "SOLOVAULT_AGENT_KEY is not set and ${store:-the password manager} has no '$solovault_key_name' entry; ask the owner to store it there (never paste it into chat)"
  return 1
}
