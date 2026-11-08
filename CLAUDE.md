<!-- solo-skills:credentials:start -->
## Missing credentials: check SoLoVault
- For a missing key, token or password needed by an already authorized task, check existing environment variables, the local credentials folder and the OS secret store first. If it is still missing, check SoLoVault before stopping or asking the owner for the value.
- Read the `solovault-credentials` skill before using the vault. In a project clone, including Codex, read `.claude/skills/solovault-credentials/SKILL.md`; if absent, use the installed shared skill or its canonical source at `SoLoVisionLLC/solo-skills/claude-plugins/solo-skills/skills/solovault-credentials/SKILL.md`.
- Use the skill's `scripts/solovault-run.sh` helper to pass a value directly into the authorized command. Never print secrets, commit them, put them in command arguments or expose plaintext through `solovault-agent get` or MCP `read_entry`.
- If the existing agent key or entry cannot be found, or the vault returns `BAD_KEY` or `DENIED`, stop that operation and report the missing credential by name only. Do not create credentials, expand access or bypass a denial to unblock it.
- This is lookup guidance only. It does not authorize credential creation or rotation, permission changes, external transmission, production deployment or any otherwise unapproved action. Repository-specific restrictions always win: preserve read-only tasks and synthetic-only development; when real credentials or real vault data are forbidden, do not access them.
<!-- solo-skills:credentials:end -->
