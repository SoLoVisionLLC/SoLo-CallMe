#!/usr/bin/env bash
# Run one command with SoLoVault values in its environment, without the values
# ever reaching this script's stdout or stderr (and so never the agent's output).
#
#   solovault-run.sh VAR=<entry-id>:<field> [VAR=@<name>:<field> ...] -- <command> [args...]
#
# <entry-id> comes from `solovault-agent list` or from the owner. @<name> looks
# the ID up in the owner's map file (SOLOVAULT_ENTRY_MAP, default
# "~/SoloVision Credentials/solovault-entries.txt", lines "<name> <entry-id>",
# '#' comments), or, when the map has no line for it, in the environment variable
# SOLOVAULT_ID_<NAME> (name upper-cased, other characters as _; how cloud sessions,
# which have no map, get IDs). The map holds IDs only, never values.
#
# Only names, IDs and SoLoVault error codes are printed. Exit codes: 2 usage,
# 3 entry not identified (ask the owner for its ID), 4 SoLoVault refused or failed.
# The command itself must not print the variable; that part is on the caller.
set -euo pipefail

agent="${SOLOVAULT_AGENT_BIN:-solovault-agent}"
map="${SOLOVAULT_ENTRY_MAP:-$HOME/SoloVision Credentials/solovault-entries.txt}"
codes='BAD_KEY|DENIED|WRITE_DATE_MISMATCH|NO_OWNER_KEY|RATE_LIMITED|UNAVAILABLE'

say() { printf 'solovault-run: %s\n' "$*" >&2; }
usage() { say "usage: solovault-run.sh VAR=<entry-id>:<field> [...] -- <command> [args...]"; exit 2; }

specs=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do specs+=("$1"); shift; done
[ $# -gt 1 ] && [ "${#specs[@]}" -gt 0 ] || usage
shift

# Validate every destination before loading the key or fetching the first value.
# Ordinary names (including value/agent/specs) are isolated until final launch.
for spec in "${specs[@]}"; do
  var="${spec%%=*}"; rest="${spec#*=}"
  [[ "$spec" == *=*:* && "$var" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || usage
  field="${rest#*:}"
  [[ "$field" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || usage
  case "$var" in
    SOLOVAULT_AGENT_KEY|_solovault_*|BASH*|SHELLOPTS|SHLVL|UID|EUID|PPID|FUNCNAME|GROUPS|DIRSTACK|PIPESTATUS|RANDOM|SRANDOM|SECONDS|LINENO|OPTIND|OPTARG|IFS|LANG|LANGUAGE|LC_*|HISTCMD|EPOCHSECONDS|EPOCHREALTIME|_)
      say "reserved destination variable '$var'; nothing read"; exit 2 ;;
  esac
done

# The key comes from the environment or this machine's password manager (solovault-key.sh).
. "$(dirname "${BASH_SOURCE[0]}")/solovault-key.sh"
solovault_load_key || exit 4
command -v "$agent" >/dev/null 2>&1 || { say "$agent is not installed (npm install -g https://solovault.cloud/api/solovault-agent.tgz)"; exit 4; }

command -v node >/dev/null 2>&1 || { say "Node 18+ is required by solovault-agent"; exit 4; }

assignments=()
unset _solovault_value

for spec in "${specs[@]}"; do
  var="${spec%%=*}"; rest="${spec#*=}"
  [[ "$spec" == *=*:* && "$var" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || usage
  ref="${rest%%:*}"; field="${rest#*:}"
  [[ "$field" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || usage
  if [[ "$ref" == @* ]]; then
    name="${ref#@}"
    id=""
    [ -f "$map" ] && id="$(awk -v n="$name" '$1 == n && $1 !~ /^#/ { print $2; exit }' "$map")"
    # No map (cloud sessions): the environment may carry the ID as SOLOVAULT_ID_<NAME>.
    envvar="SOLOVAULT_ID_$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9\n' '_')"
    [ -n "$id" ] || id="${!envvar:-}"
    [ -n "$id" ] || { say "no entry ID for '$name' in the owner's map ($map) or in $envvar; stop and ask the owner for it"; exit 3; }
  else
    id="$ref"
  fi
  [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || { say "'$id' is not an entry ID; stop and ask the owner for it"; exit 3; }

  err="$(mktemp)"
  # The CLI appends exactly one LF. A sentinel prevents command substitution
  # from trimming newlines belonging to the value; NUL cannot fit in an env var.
  if ! _solovault_value="$("$agent" get "$id" --field "$field" 2>"$err" | node -e '
    const chunks = [];
    process.stdin.on("data", chunk => chunks.push(chunk)).on("end", () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length || raw[raw.length - 1] !== 10 || raw.includes(0)) {
        process.exitCode = 1; return;
      }
      process.stdout.write(Buffer.concat([raw.subarray(0, -1), Buffer.from(".")]));
    });')"; then
    code="$(grep -oE "$codes" "$err" | head -n 1 || true)"
    rm -f "$err"
    say "could not read $var (entry $id, field $field): ${code:-error}; stop and report which credential is missing"
    exit 4
  fi
  rm -f "$err"
  _solovault_value="${_solovault_value%.}"
  [ -n "$_solovault_value" ] || { say "entry $id has an empty $field; stop and report it"; exit 4; }
  assignments+=("$var=$_solovault_value")
  unset _solovault_value
done

# Expand assignments into a shell function, not an external command's argv. Only
# after every lookup succeeds do they enter the destination environment. Clear
# our arrays first so requested names such as specs/assignments become scalars.
_solovault_launch() {
  unset specs assignments SOLOVAULT_AGENT_KEY _solovault_value
  while [ "$1" != "--" ]; do export "$1"; shift; done
  shift
  exec "$@"
}
_solovault_launch "${assignments[@]}" -- "$@"
