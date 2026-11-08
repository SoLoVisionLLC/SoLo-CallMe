#!/usr/bin/env bash
# Run solovault-agent's commands that never print entry values, with the agent key
# from the environment or this machine's password manager (see solovault-key.sh):
#
#   solovault-agent.sh list                     # access, then id/title/folder/type per entry
#   solovault-agent.sh mcp                      # MCP server over stdio (an MCP config "command")
#
# Organizing the vault (key with read and write access to ALL entries):
#   solovault-agent.sh folders | trash
#   solovault-agent.sh folder-create <name> [--parent <folder>] [--color <hex>]
#   solovault-agent.sh folder-rename <folder> <name>
#   solovault-agent.sh folder-color <folder> <hex>
#   solovault-agent.sh folder-move <folder> [--to <folder>]
#   solovault-agent.sh folder-delete <folder>   # to the trash, with everything in it
#   solovault-agent.sh rename <entry-id> <title>
#   solovault-agent.sh move <entry-id> [--to <folder>]
#   solovault-agent.sh copy <entry-id> [--to <folder>]   # rights and folder checked first
#   solovault-agent.sh delete <entry-id>        # to the trash
#   solovault-agent.sh restore <id>
#   solovault-agent.sh empty-trash [<id> ...]   # permanent; only when the owner asked for it
#
# These print IDs, names and paths only. `get` is refused (it prints plaintext): use
# solovault-run.sh. `update` and `create` are refused (they take values as arguments):
# use solovault-write.sh.
set -euo pipefail

agent="${SOLOVAULT_AGENT_BIN:-solovault-agent}"
say() { printf 'solovault-agent.sh: %s\n' "$*" >&2; }

case "${1:-}" in
  list|mcp|folders|trash|folder-create|folder-rename|folder-color|folder-move|folder-delete| \
  rename|move|copy|delete|restore|empty-trash) ;;
  get) say "get prints plaintext; use scripts/solovault-run.sh VAR=<entry-id>:<field> -- <command>"; exit 2 ;;
  update|create) say "$1 takes values as arguments; use scripts/solovault-write.sh"; exit 2 ;;
  *) say "usage: solovault-agent.sh list | mcp | folders | trash | folder-create | folder-rename | folder-color | folder-move | folder-delete | rename | move | copy | delete | restore | empty-trash"; exit 2 ;;
esac

. "$(dirname "${BASH_SOURCE[0]}")/solovault-key.sh"
solovault_load_key || exit 4
command -v "$agent" >/dev/null 2>&1 || { say "$agent is not installed (npm install -g https://solovault.cloud/api/solovault-agent.tgz)"; exit 4; }

# copy creates the new entry before it checks rights or files it, so check first
# (solovault-folder.sh) and pass the folder by ID.
if [ "$1" = copy ]; then
  . "$(dirname "${BASH_SOURCE[0]}")/solovault-folder.sh"
  [ $# -eq 2 ] || { [ $# -eq 4 ] && [ "$3" = --to ]; } || { say "usage: solovault-agent.sh copy <entry-id> [--to <folder>]"; exit 2; }
  if ! solovault_check_folder "${4:-}"; then
    say "copy refused before writing: $solovault_folder_error; nothing was copied (folder IDs and paths: solovault-agent.sh folders)"
    exit 4
  fi
  args=(copy "$2"); [ $# -eq 2 ] || args+=(--to "$solovault_folder_id")
  "$agent" "${args[@]}" && exit 0
  say "copy failed after the check passed; a \"Copy <title>\" entry may exist unfiled. Look for it in solovault-agent.sh list before copying again, and tell the owner"
  exit 6
fi
exec "$agent" "$@"
