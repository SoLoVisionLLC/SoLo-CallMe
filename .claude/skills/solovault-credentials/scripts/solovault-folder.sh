# Sourced by solovault-write.sh and solovault-agent.sh; needs $agent and node.
#
# solovault-agent's create (and copy, which creates) saves the new entry first and
# only then checks the key's rights and files it in the folder, so a bad folder or
# a key without all entries leaves an unfiled entry and no ID. Check both here,
# before anything is written.
#
#   solovault_check_folder "<folder>"   # an ID, a path like "Work / Servers", "/" for the top
#   solovault_check_folder ""           # rights only
#
# On success sets solovault_folder_id to the folder's ID ("/" for the top, "" when
# no folder was given) and returns 0. Otherwise sets solovault_folder_error to
# NEEDS_ALL_ENTRIES, NO_FOLDER, AMBIGUOUS_FOLDER or CHECK_FAILED and returns 1.
# Prints nothing; folder names and IDs are not secret, entry values never pass here.
solovault_check_folder() {
  local ref="$1" listing folders verdict
  solovault_folder_id="" solovault_folder_error=""
  if ! listing="$("$agent" list 2>/dev/null)"; then solovault_folder_error=CHECK_FAILED; return 1; fi
  verdict="$(printf '%s' "$listing" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { const r = JSON.parse(s); console.log(r.allEntries && r.canRead && r.canWrite ? "ok" : "NEEDS_ALL_ENTRIES"); }
      catch { console.log("CHECK_FAILED"); } });')"
  [ "$verdict" = ok ] || { solovault_folder_error="$verdict"; return 1; }
  [ -n "$ref" ] || return 0
  if ! folders="$("$agent" folders 2>/dev/null)"; then solovault_folder_error=CHECK_FAILED; return 1; fi
  # The same rules as the CLI: an ID first, then the path of names; "/" is the top.
  # Shared folders are not listed, so they come back as NO_FOLDER.
  verdict="$(printf '%s' "$folders" | SOLOVAULT_FOLDER_REF="$ref" node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const ref = process.env.SOLOVAULT_FOLDER_REF;
        const path = ref.split("/").map(n => n.trim()).filter(Boolean).join(" / ");
        if (!path) { console.log("id /"); return; }
        const all = JSON.parse(s).folders;
        const byId = all.filter(f => f.id === ref);
        const hits = byId.length ? byId : all.filter(f => f.path === path);
        const safe = hits.length === 1 && /^[A-Za-z0-9_.:-]+$/.test(String(hits[0].id));
        console.log(!hits.length ? "NO_FOLDER" : hits.length > 1 ? "AMBIGUOUS_FOLDER" : safe ? "id " + hits[0].id : "CHECK_FAILED");
      } catch { console.log("CHECK_FAILED"); } });')"
  case "$verdict" in
    "id "*) solovault_folder_id="${verdict#id }" ;;
    *) solovault_folder_error="$verdict"; return 1 ;;
  esac
}
