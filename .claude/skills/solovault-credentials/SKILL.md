---
name: solovault-credentials
description: Find a credential an agent needs (API key, token, password, environment variable) in SoLoVault when it is not already in the environment, store new or rotated credentials there, and organize the vault (folders, moving, renaming, copying and deleting entries, the trash), using the SOLOVAULT_AGENT_KEY agent key and the solovault-agent CLI. Use whenever a task fails or would stop because a key, token or password is missing, a task creates or rotates one, or a task asks to tidy or reorganize SoLoVault.
---

# SoLoVault credentials

SoLoVault (https://app.solovault.cloud) is SoLo's password vault. Agents reach
it with an **agent key** and the `solovault-agent` tool. Everything is
decrypted on the agent's machine; the server only stores ciphertext.
Reference: https://solovault.cloud/api/

## When to use it

Look in the environment first: environment variables, `~/SoloVision
Credentials/` (`solo-credentials-map`), and the OS secret store. If the
credential is not there, check SoLoVault before stopping or asking the owner,
and use it only through `scripts/solovault-run.sh` (below).

## Setup (once per machine or environment)

```sh
npm install -g https://solovault.cloud/api/solovault-agent.tgz   # Node 18 or later
# if the global npm folder needs root (e.g. /usr/local on SoLoBot):
npm install -g --prefix ~/.local https://solovault.cloud/api/solovault-agent.tgz
```

- `SOLOVAULT_AGENT_KEY` is `sv-` followed by 65 letters and digits (older
  `svk1.` keys still work). The owner makes it at **Manage → Agent keys** in
  SoLoVault, chooses read and/or write, and all entries or only chosen ones.
  The owner's agent keys have read and write access, so agents can store and
  update credentials themselves.
- `SOLOVAULT_URL` defaults to `https://solovault.cloud/server` (HTTPS only).
- Never ask for the key in chat and never write it into a repo, an MCP
  config, a log or a command line.

### Where the agent key lives

The helpers (`solovault-run.sh`, `solovault-write.sh`) find the key themselves,
so agents never load or handle it: first `SOLOVAULT_AGENT_KEY` in the
environment (cloud environments), otherwise the machine's password manager
under the name **`solovision-env:SOLOVAULT_AGENT_KEY`**:

| Machine | Password manager | Entry |
| --- | --- | --- |
| Windows (SoLoPC, SoLoSurface) | Credential Manager | generic credential, target `solovision-env:SOLOVAULT_AGENT_KEY` |
| macOS (SoLoMacServer) | Keychain | generic password, service `solovision-env:SOLOVAULT_AGENT_KEY` |
| Linux (SoLoBot) | Secret Service (GNOME Keyring/KWallet) | attributes `service=solovision-env key=SOLOVAULT_AGENT_KEY` |

The owner stores it once per machine; each command prompts for the value, so
it never lands on a command line or in shell history:

```sh
cmdkey /generic:solovision-env:SOLOVAULT_AGENT_KEY /user:codex /pass       # Windows
security add-generic-password -U -s solovision-env:SOLOVAULT_AGENT_KEY -a codex -w   # macOS
secret-tool store --label='SoLoVault agent key' service solovision-env key SOLOVAULT_AGENT_KEY  # Linux
```

- This is the same `solovision-env:<VARIABLE>` naming the other agent secrets
  on these machines use. `SOLOVAULT_KEY_NAME` overrides the name (tests use it).
- On macOS over SSH the login keychain can be locked; on Linux the keyring
  must be unlocked in a session the agent can reach (it is on SoLoBot over
  SSH). If the helper reports the entry missing, check that before asking the
  owner.
- If neither the environment nor the password manager has it, the helpers stop
  and name the entry; tell the owner it is missing.

### Windows

Run both helpers with Git Bash. From PowerShell, start it with the `&` call
operator (a quoted path alone is only a string), from the skill's folder:

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/solovault-run.sh TOKEN=<entry-id>:password -- ./deploy.sh
$env:NEW_TOKEN = <command that returns the new value>   # PowerShell has no inline VAR=value
& "C:\Program Files\Git\bin\bash.exe" scripts/solovault-write.sh update <entry-id> password=NEW_TOKEN
Remove-Item Env:NEW_TOKEN
```

WSL bash works too: the helpers read Credential Manager through
`powershell.exe`. `scripts/windows-smoke.ps1` checks all of this on a Windows
machine against a stub agent and a temporary credential (no vault access, the
owner's key untouched): `powershell -ExecutionPolicy Bypass -File scripts\windows-smoke.ps1`.

## Finding the entry

```sh
scripts/solovault-agent.sh list   # access level, then id/title/folder/type per entry (no values)
```

- An all-entries key lists titles and folders, so pick the entry ID by title.
- A chosen-entries key lists IDs only. Use an ID the owner gave you, in the
  task or in the owner's map file `~/SoloVision Credentials/solovault-entries.txt`
  (one `<name> <entry-id>` per line; IDs only, never values; override the path
  with `SOLOVAULT_ENTRY_MAP`). Where there is no map (cloud sessions), the owner puts
  IDs in the environment as `SOLOVAULT_ID_<NAME>` (name upper-cased, `-` and other
  characters as `_`), and `VAR=@<name>:<field>` resolves from it. Never guess between
  unlabeled IDs.
- **Stop condition:** if neither the title nor the owner's ID identifies the
  entry, stop and ask the owner for the entry ID. Do not read entries to find out.
- Fields use short names: `username`, `password`, `url`, `notes`, `title`.
  Entry types: `website_password`, `application_password`, `note`,
  `bookmark`, `environment_variables`, `credit_card`, `totp`, `ssh_own_key`.

## Using a value without seeing it

`solovault-agent get` writes the decrypted value (or the whole entry as JSON) to
stdout, and MCP `read_entry` returns the plaintext to the model. Either puts
the secret in the agent's transcript, so **never run `get` where its output
reaches you, and never call `read_entry` for a secret.** Hand the value straight
to the process that needs it with this skill's wrapper:

```sh
scripts/solovault-run.sh COOLIFY_API_TOKEN=<entry-id>:password -- ./deploy.sh
scripts/solovault-run.sh R2_SECRET=@r2-downloads:password R2_KEY_ID=@r2-downloads:username -- node publish.mjs
```

- The wrapper reads each value into the command's environment and prints only
  names, IDs and SoLoVault error codes (exit 3: entry not identified, ask the
  owner; exit 4: SoLoVault refused or failed). It does not pass
  `SOLOVAULT_AGENT_KEY` on to the command.
- Values keep their original whitespace, including trailing newlines; only
  the CLI's one output newline is removed. Empty values, NUL bytes (which an
  environment variable cannot carry), and malformed CLI output stop the command.
- All lookups finish before any destination variable is exported. Names such
  as `value`, `agent`, and `map` cannot overwrite the helper's lookup state.
  `SOLOVAULT_AGENT_KEY`, names beginning `_solovault_`, locale variables, and
  Bash control or read-only variables are reserved and rejected before any
  lookup (exit 2).
- The command must not print, log or write the variable itself; pick commands
  that only use it. Do not wrap `env`, `printenv`, `echo` or a debug mode.
- `tests/test_solovault_run.py` in solo-skills proves a sentinel value reaches the command
  but never the wrapper's stdout or stderr.

## MCP server

`solovault-agent mcp` serves these tools over stdio:

- Entries: `list_entries`, `read_entry`, `update_entry`, `create_entry` (with
  an optional `folder`), `rename_entry`, `move_entry`, `copy_entry`, `delete_entry`.
- Folders and trash (all-entries read and write keys): `list_folders`,
  `create_folder`, `update_folder` (rename or recolor), `move_folder`,
  `delete_folder`, `list_trash`, `restore_from_trash`, `empty_trash`.

All of them return IDs, names and paths except `read_entry`, which returns
plaintext to the model, so use the wrapper above for secrets instead. The same
rules as the command line apply (see "Organizing the vault"). Start it
through `scripts/solovault-agent.sh`, which supplies the key from the
environment or the password manager, so the config names no key:

```json
{ "mcpServers": { "solovault": { "command": "bash", "args": ["<skill folder>/scripts/solovault-agent.sh", "mcp"] } } }
```

`scripts/solovault-agent.sh` runs `list`, `mcp` and the organizing commands
below. It refuses `get`, which prints plaintext, and `update`/`create`, which
take values as arguments (use `solovault-write.sh`).

Never write the real key into an MCP config, `.mcp.json`, a settings file or a
repository.

## Writing (creating and updating entries)

Agents may create a new entry when a task makes a new credential, and update an
entry when a credential is rotated or found to be wrong. No extra approval is
needed. Use this skill's write helper, which pipes the value from an environment
variable on stdin and prints only the entry ID and write date:

```sh
scripts/solovault-write.sh create --title "<app> <service> <purpose>" --type application_password \
  [--folder "Work / Servers"] --map <short-name> password=NEW_TOKEN
scripts/solovault-write.sh update <entry-id> password=NEW_TOKEN
```

- The value goes in the named variable (`NEW_TOKEN` above), never on the
  command line. Set it on the same command so only the helper sees it, filled
  straight from the service API that issued it, without printing it:
  `NEW_TOKEN="$(curl -fsS ... | jq -r .token)" scripts/solovault-write.sh update <entry-id> password=NEW_TOKEN`.
  (A plain `NEW_TOKEN=...` line on its own is not exported, so the helper would
  not see it.) Do not invent a token: store
  only a value the service issued, or a password you generated **and** already
  set and verified in the service (log in or call its API with it first).
- Before creating, check `scripts/solovault-agent.sh list` for the entry and update it
  instead of making a duplicate. Use a clear title: app, service, purpose.
- The helper consumes the complete `solovault-agent list` response and confirms
  the exact ID in its `entries` array (this works for
  chosen-entries keys, which list IDs only). `--map <short-name>` adds
  `<short-name> <entry-id>` to the owner's ID map so later reads can use
  `VAR=@<short-name>:<field>`; use it for every new entry. If the name is already
  mapped to another entry, the helper writes nothing and exits 2. Runs that use
  `--map` take a lock on the map, so two at once cannot claim the same name.
- Update only the entry and field the task is about (`update` keeps the fields
  you do not set; one field per call). Before replacing a value that a live
  service still uses, make sure the new value already works there, so a
  rotation cannot lock anything out.
- `WRITE_DATE_MISMATCH` means someone changed the entry since you read it: retry
  once. Exit 5 means the write succeeded but `list` does not show the entry:
  report the ID to the owner.
- With `--folder`, the helper checks the key's rights and finds the folder
  **before** writing, and creates the entry in that folder by its ID. The
  CLI's own `create --folder` saves the entry first and files it afterwards, so
  a bad folder there leaves an unfiled entry with no ID: use the helper, not the
  CLI. Exit 4 with "refused before writing" means nothing was written. Exit 6
  means create failed after the check passed and the entry **may exist
  unfiled**. The helper names any listed entries with that title; if none are
  listed, the entry shows up in **From agents** after the owner next unlocks.
  Do not create it again; tell the owner, then file it with `move` once listed.
- In your report, name the entry (title, ID, field), never the value.
- `tests/test_solovault_write.py` in solo-skills proves a sentinel value reaches
  `solovault-agent` on stdin but never the helper's output or arguments.

New entries go in the folder given with `--folder` (all-entries keys), otherwise
in the owner's **From agents** folder after they next unlock. No key can read
the vault password, open or change shared folders, share entries, or change
settings.

## File credentials (keystores, certificates, key files)

A credential that a build needs as a **file** (Android keystore, `.p12`, service-account
JSON, SSH key) goes in SoLoVault as base64, in its own entry, so any session can rebuild
the file without the owner's machine. Store it from a machine that has the file:

```sh
KS_B64="$(base64 -w0 "<path to file>")" scripts/solovault-write.sh create \
  --title "<App> Android upload keystore (base64)" --type application_password \
  --map <app>-android-keystore password=KS_B64
```

(`base64 -i <file>` on macOS, which has no `-w0`.) Use it by decoding into a private temp
file inside the command that needs it, never into the repo:

```sh
scripts/solovault-run.sh KS_B64=@<app>-android-keystore:password -- bash -c '
  umask 077; d="$(mktemp -d)"; trap "rm -rf \"$d\"" EXIT
  printf %s "$KS_B64" | base64 --decode > "$d/upload.jks"; ./build-that-uses "$d/upload.jks"'
```

A repo's release script that already takes a base64 variable (for example
`SOLO_SUPPORT_ANDROID_KEYSTORE_BASE64`) gets it straight from `solovault-run.sh`. Keep
the file on the build hosts too; the vault copy is what makes cloud and fresh sessions
work. If `create` refuses the value as too large, report the entry title and size to the
owner instead of splitting it.

## Organizing the vault (folders, entries, trash)

A key with **read and write access to all entries** can do what the app does
with folders and entries. Agents may do this when a task asks for it, for
example tidying entries into folders or removing a credential the task retired.
These commands print IDs, names and paths only, never values:

```sh
scripts/solovault-agent.sh folders                                   # folders with IDs and paths
scripts/solovault-agent.sh folder-create Servers --parent Work --color e53935
scripts/solovault-agent.sh folder-rename "Work / Servers" Hosts
scripts/solovault-agent.sh folder-color <folder> 1e88e5
scripts/solovault-agent.sh folder-move "Work / Hosts" --to Archive  # no --to (or /) = top level
scripts/solovault-agent.sh folder-delete Archive                     # to the trash, with its contents
scripts/solovault-agent.sh rename <entry-id> "New title"
scripts/solovault-agent.sh move <entry-id> --to "Work / Hosts"
scripts/solovault-agent.sh copy <entry-id> [--to <folder>]           # new entry "Copy <title>", new ID (checked first)
scripts/solovault-agent.sh delete <entry-id>                         # to the trash
scripts/solovault-agent.sh trash                                     # what is in the trash
scripts/solovault-agent.sh restore <id>
scripts/solovault-agent.sh empty-trash [<id> ...]                    # permanent
```

- A `<folder>` is a folder ID from `folders` or a path such as
  `"Work / Servers"`. If a path matches more than one folder
  (`AMBIGUOUS_FOLDER`), use the ID. Shared folders are left alone
  (`SHARED_FOLDER`); those changes are the owner's, in the app.
- Renaming and moving keep the entry ID, so the owner's ID map and anything
  using `@<name>` keep working. `copy` makes a new ID; map it with `--map` via
  the write helper's flow only if the copy is meant to be used. Like create,
  the CLI's copy saves the new entry before checking rights or the folder, so
  the wrapper checks both first (exit 4: nothing copied). Exit 6 means a
  `Copy <title>` entry may exist unfiled: find it in `list` before copying
  again, and tell the owner.
- Deleting (entries or folders) only moves things to the trash, where `restore`
  brings them back. Before deleting, make sure nothing still uses the entry:
  check the owner's ID map and the task, and do not delete an entry another
  service still authenticates with.
- **`empty-trash` deletes for good. Run it only when the owner asked for it in
  the task**, and name what it removes (titles and IDs from `trash`) in your
  report. With IDs it removes only those; without, everything in the trash.
- Report every change: what moved, renamed, copied or deleted, with titles and
  IDs, and where it ended up.
- Chosen-entries keys and read-only or write-only keys get `NEEDS_ALL_ENTRIES`
  or `DENIED`: stop and tell the owner which access the task needs.

## Errors

| Code | Meaning | What to do |
| --- | --- | --- |
| `BAD_KEY` | Key missing or not an agent key | Stop; report that `SOLOVAULT_AGENT_KEY` is missing or wrong |
| `DENIED` | Key deleted, lacks access, entry not reachable, or account unusable | Stop; report which entry and access is needed |
| `WRITE_DATE_MISMATCH` | Entry changed since it was read | Read it again, then retry once |
| `NO_OWNER_KEY` | Key cannot add entries yet | Owner opens the key once on the Agent keys screen |
| `NEEDS_ALL_ENTRIES` | Folder, move, copy, delete and trash actions need a read and write key for all entries | Stop; tell the owner the task needs that access |
| `NO_FOLDER`, `AMBIGUOUS_FOLDER` | No folder has that path, or more than one does | Use the folder ID from `folders` |
| `SHARED_FOLDER` | The change would touch a shared folder | Leave it; the owner makes it in the app |
| `NOT_FOUND` | No entry or folder with that ID (or not in the trash, for `restore`) | List again and check the ID |
| `RATE_LIMITED` | Too many requests | Wait, then retry |
| `UNAVAILABLE` | SoLoVault did not answer | Retry shortly; then report |

## Boundaries

- A repo's own AGENTS.md wins where it forbids real credentials (SoLoVault's
  own repo does for its tests).
- Credentials found in SoLoVault do not change where work runs: builds and
  deploys still follow `docs/BUILD_HOSTS.md` (never on SoLoSurface).
