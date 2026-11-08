#!/usr/bin/env bash
# Store a credential in SoLoVault without the value reaching this script's output.
#
#   solovault-write.sh create --title "<title>" --type <type> [--folder <folder>] [--map <name>] <field>=<VAR>
#   solovault-write.sh update <entry-id> [--map <name>] <field>=<VAR>
#
# <VAR> names an environment variable that already holds the value (for example
# the token a service just issued). The value is piped to solovault-agent on
# stdin; only the entry ID and write date are printed, and the ID is then checked
# against `solovault-agent list` (works for all-entries and chosen-entries keys).
# --map <name> records "<name> <entry-id>" in the owner's ID map
# (SOLOVAULT_ENTRY_MAP, default "~/SoloVision Credentials/solovault-entries.txt")
# so later lookups with VAR=@<name>:<field> find it. One field per call.
# With --folder, the key's rights and the folder are checked before anything is
# written (solovault-folder.sh), and the entry is created in that folder by its ID.
# Exit codes: 2 usage, 4 SoLoVault refused or failed (nothing written), 5 written
# but not found by list, 6 create --folder failed after the check passed, so the
# entry may exist unfiled: look for its title in list before creating it again.
set -euo pipefail

agent="${SOLOVAULT_AGENT_BIN:-solovault-agent}"
map="${SOLOVAULT_ENTRY_MAP:-$HOME/SoloVision Credentials/solovault-entries.txt}"
codes='BAD_KEY|DENIED|WRITE_DATE_MISMATCH|NO_OWNER_KEY|RATE_LIMITED|UNAVAILABLE|NO_FIELD|USAGE|NEEDS_ALL_ENTRIES|NO_FOLDER|AMBIGUOUS_FOLDER|SHARED_FOLDER'
# solovault-agent prints only the error message, not its code; name the folder errors
# from their fixed wording so the agent can follow the skill's recovery steps.
error_code() {
  local c; c="$(grep -oE "$codes" "$1" | head -n 1 || true)"
  if [ -z "$c" ]; then
    if grep -q 'needs an agent key with all entries' "$1"; then c=NEEDS_ALL_ENTRIES
    elif grep -qE '^(No folder "|Choose a folder\.)' "$1"; then c=NO_FOLDER
    elif grep -q '^More than one folder is called' "$1"; then c=AMBIGUOUS_FOLDER
    elif grep -qE 'is shared; change it in the SoLoVault app|holds shared folders' "$1"; then c=SHARED_FOLDER
    fi
  fi
  printf '%s' "$c"
}

say() { printf 'solovault-write: %s\n' "$*" >&2; }
usage() { say "usage: solovault-write.sh create --title T --type TYPE [--folder F] [--map NAME] FIELD=VAR | update ID [--map NAME] FIELD=VAR"; exit 2; }

# The key comes from the environment or this machine's password manager (solovault-key.sh).
. "$(dirname "${BASH_SOURCE[0]}")/solovault-key.sh"
. "$(dirname "${BASH_SOURCE[0]}")/solovault-folder.sh"
solovault_load_key || exit 4
command -v "$agent" >/dev/null 2>&1 || { say "$agent is not installed (npm install -g https://solovault.cloud/api/solovault-agent.tgz)"; exit 4; }

mode="${1:-}"; shift || true
id="" title="" type="" name="" spec="" folder=""
case "$mode" in
  create) ;;
  update) id="${1:-}"; shift || true; [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || usage ;;
  *) usage ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --title) title="${2:-}"; shift 2 ;;
    --type) type="${2:-}"; shift 2 ;;
    --folder) folder="${2:-}"; [ -n "$folder" ] || usage; shift 2 ;;
    --map) name="${2:-}"; shift 2 ;;
    *=*) [ -z "$spec" ] || usage; spec="$1"; shift ;;
    *) usage ;;
  esac
done
[ -n "$spec" ] || usage
field="${spec%%=*}"; var="${spec#*=}"
[[ "$field" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$var" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || usage
[ -z "$name" ] || [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || usage
if [ "$mode" = create ]; then [ -n "$title" ] && [ -n "$type" ] || usage; fi
[ "$mode" = create ] || [ -z "$folder" ] || { say "--folder is for create; move an existing entry with solovault-agent.sh move"; exit 2; }
[ -n "${!var:-}" ] || { say "\$$var is empty or not exported; nothing was written (set it on the same command: $var=\"\$(...)\" solovault-write.sh ...)"; exit 2; }

# With --map, hold an exclusive lock on the map from the conflict check through the
# vault write to the map append, so two runs cannot claim the same name. mkdir is
# atomic on every OS (macOS has no flock). A lock older than 10 minutes is stale.
lock=""
release_lock() { [ -n "$lock" ] && rmdir "$lock" 2>/dev/null; lock=""; }
if [ -n "$name" ]; then
  mkdir -p "$(dirname "$map")"
  lockdir="$map.lock"; tries=0
  until mkdir "$lockdir" 2>/dev/null; do
    if [ -n "$(find "$lockdir" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$lockdir" 2>/dev/null; continue; fi
    tries=$((tries + 1))
    [ "$tries" -le 300 ] || { say "the owner's map is locked by another solovault-write run; nothing was written, retry shortly"; exit 4; }
    sleep 0.1
  done
  lock="$lockdir"; trap release_lock EXIT
fi
# Refuse a conflicting map entry before writing, so the map never points at a stale ID.
if [ -n "$name" ]; then
  mapped="$(awk -v n="$name" '$1 == n { print $2; exit }' "$map" 2>/dev/null || true)"
  if [ -n "$mapped" ] && { [ "$mode" = create ] || [ "$mapped" != "$id" ]; }; then
    say "the owner's map already has $name -> $mapped; nothing was written (update that entry, or pick another --map name)"
    exit 2
  fi
fi

if [ -n "$folder" ] && ! solovault_check_folder "$folder"; then
  say "create refused before writing: $solovault_folder_error; nothing was written (folder IDs and paths: solovault-agent.sh folders)"
  exit 4
fi

out="$(mktemp)"; err="$(mktemp)"
trap 'rm -f "$out" "$err"; release_lock' EXIT
if [ "$mode" = create ]; then
  args=(create --title "$title" --type "$type" --set "$field=-")
  [ -z "$folder" ] || args+=(--folder "$solovault_folder_id")
else
  args=(update "$id" --set "$field=-")
fi
if ! printf '%s' "${!var}" | "$agent" "${args[@]}" >"$out" 2>"$err"; then
  code="$(error_code "$err")"
  if [ -n "$folder" ]; then
    # The CLI may have saved the entry before failing to file it; never create again
    # here. Name the entries with this title so the agent can report the ID.
    ids="$("$agent" list 2>/dev/null | SOLOVAULT_TITLE="$title" node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        try { const ok = v => /^[A-Za-z0-9_.:-]+$/.test(String(v));
          console.log(JSON.parse(s).entries.filter(e => e.title === process.env.SOLOVAULT_TITLE && ok(e.id))
            .map(e => e.id).join(" ")); } catch { console.log(""); } });' || true)"
    say "create failed after the folder check passed: ${code:-error}; the entry may have been saved without being filed (entries titled \"$title\": ${ids:-none listed; an unfiled entry shows up in From agents after the owner next unlocks}). Do not create it again; tell the owner, and once it is listed, file it with solovault-agent.sh move <id> --to <folder>"
    exit 6
  fi
  say "$mode failed: ${code:-error}; nothing to report beyond that"
  exit 4
fi

# The CLI answers {"id": ..., "writeDate": ...}; print only those two keys.
read -r new_id write_date < <(node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try { const r = JSON.parse(s); const ok = v => typeof v === "string" && /^[A-Za-z0-9_.:+-]+$/.test(v);
      console.log((ok(r.id) ? r.id : "") + " " + (ok(String(r.writeDate)) ? String(r.writeDate) : "-")); }
    catch { console.log(" -"); } });' <"$out")
[ -n "${new_id:-}" ] || { say "$mode returned no entry ID; check the entry in SoLoVault"; exit 4; }
[ "$mode" = create ] || [ "$new_id" = "$id" ] || { say "update answered for a different entry ($new_id)"; exit 4; }

# Consume the entire listing before checking IDs: an early-exiting reader can
# give the CLI SIGPIPE and turn a successful match into failure under pipefail.
# Parse only entries[].id so a matching title or unrelated field cannot verify it.
if ! "$agent" list 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try {
      const r = JSON.parse(s);
      process.exitCode = Array.isArray(r.entries) &&
        r.entries.some(e => e !== null && typeof e === "object" && e.id === process.argv[1]) ? 0 : 1;
    } catch { process.exitCode = 1; }
  });' "$new_id"; then
  say "wrote entry $new_id but list does not show it; report it to the owner"
  exit 5
fi
if [ -n "$name" ] && [ -z "$mapped" ]; then
  mkdir -p "$(dirname "$map")"
  printf '%s %s\n' "$name" "$new_id" >>"$map"; chmod 600 "$map"
fi
printf 'solovault-write: %s entry %s field %s writeDate %s%s\n' "${mode}d" "$new_id" "$field" "${write_date:--}" "${name:+ (mapped as $name)}"
