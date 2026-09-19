# SoLo-CallMe

**Let Claude Code call you on the phone.**

Start a task, walk away. Your phone rings when Claude is done, stuck, or needs a decision.

<img src="./call-me-comic-min.png" width="800" alt="SoLo-CallMe comic strip">

- **Just works** - Connect to our hosted server in one command
- **Multi-turn conversations** - Talk through decisions naturally
- **Works anywhere** - Smartphone, smartwatch, or landline
- **Tool-use composable** - Claude can search the web while on a call with you

---

## Quick Start (Hosted Server)

The fastest way to get started - connect to our hosted MCP server.

### 1. Get a Phone Number

You need a [Telnyx](https://telnyx.com) account with a phone number (~$1/month).

1. Create account at [portal.telnyx.com](https://portal.telnyx.com)
2. [Buy a phone number](https://portal.telnyx.com/#/numbers/buy-numbers)
3. [Create a Voice API application](https://portal.telnyx.com/#/call-control/applications):
   - Webhook URL: `https://callme.sololink.cloud/twiml`
   - API version: v2
4. [Verify your phone number](https://portal.telnyx.com/#/numbers/verified-numbers) (the number you want to receive calls on)
5. Get your **Application ID** and **API Key** from the portal

### 2. Configure Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "CALLME_PHONE_PROVIDER": "telnyx",
    "CALLME_PHONE_ACCOUNT_SID": "your-application-id",
    "CALLME_PHONE_AUTH_TOKEN": "your-api-key",
    "CALLME_PHONE_NUMBER": "+15551234567",
    "CALLME_USER_PHONE_NUMBER": "+15559876543"
  }
}
```

### 3. Connect to Server

```bash
claude mcp add -s user --transport http solo-callme https://callme.sololink.cloud/mcp
```

Restart Claude Code. Done!

---

## Self-Hosting

Want to run your own server? Deploy to Coolify, Railway, or any Docker host.

### Required Services

| Service | Provider | Cost |
|---------|----------|------|
| Phone | [Telnyx](https://telnyx.com) | ~$0.007/min + $1/mo |
| Text-to-Speech | [LemonFox](https://lemonfox.ai) or [OpenAI](https://openai.com) | ~$0.02/min |
| Speech-to-Text | [Deepgram](https://deepgram.com) | ~$0.006/min |

**Total**: ~$0.03-0.04/minute of conversation

### Environment Variables

```env
# Required: Your deployment URL
CALLME_PUBLIC_URL=https://callme.yourdomain.com

# Phone (Telnyx)
CALLME_PHONE_PROVIDER=telnyx
CALLME_PHONE_ACCOUNT_SID=<application-id>
CALLME_PHONE_AUTH_TOKEN=<api-key>
CALLME_PHONE_NUMBER=+15551234567
CALLME_USER_PHONE_NUMBER=+15559876543

# Text-to-Speech (LemonFox recommended)
CALLME_TTS_API_KEY=<your-api-key>
CALLME_TTS_BASE_URL=https://api.lemonfox.ai/v1
CALLME_TTS_VOICE=heart

# Speech-to-Text (Deepgram)
CALLME_STT_API_KEY=<your-deepgram-key>
```

### Deploy with Docker

```bash
docker build -t solo-callme .
docker run -p 3333:3333 --env-file .env solo-callme
```

Or deploy directly on Coolify/Railway pointing to this repo.

### Connect Claude Code

```bash
claude mcp add -s user --transport http solo-callme https://callme.yourdomain.com/mcp
```

---

## How It Works

```
Claude Code                         SoLo-CallMe Server
    │                                      │
    │  "I finished the feature..."         │
    ▼                                      ▼
   MCP ─────── HTTP ─────────────────► Server
                                           │
                                           ├─► Telnyx (phone)
                                           ├─► LemonFox (TTS)
                                           └─► Deepgram (STT)
                                                   │
                                                   ▼
                                            Your Phone rings
                                            You speak
                                            Text returns to Claude
```

---

## Tools

### `initiate_call`
Start a phone call.

```typescript
const { callId, response } = await initiate_call({
  message: "Hey! I finished the auth system. What should I work on next?"
});
```

### `continue_call`
Continue with follow-up questions.

```typescript
const response = await continue_call({
  call_id: callId,
  message: "Got it. Should I add rate limiting too?"
});
```

### `speak_to_user`
Speak without waiting for a response. Useful before time-consuming operations.

```typescript
await speak_to_user({
  call_id: callId,
  message: "Let me search for that. One moment..."
});
```

### `end_call`
End the call.

```typescript
await end_call({
  call_id: callId,
  message: "Perfect, I'll get started. Talk soon!"
});
```

---

## Configuration Reference

### Required Variables

| Variable | Description |
|----------|-------------|
| `CALLME_PHONE_PROVIDER` | `telnyx` (recommended) or `twilio` |
| `CALLME_PHONE_ACCOUNT_SID` | Telnyx Application ID |
| `CALLME_PHONE_AUTH_TOKEN` | Telnyx API Key |
| `CALLME_PHONE_NUMBER` | Phone number Claude calls from (E.164) |
| `CALLME_USER_PHONE_NUMBER` | Your phone number to receive calls |

### Self-Hosting Variables

| Variable | Description |
|----------|-------------|
| `CALLME_PUBLIC_URL` | Your server's public URL |
| `CALLME_TTS_API_KEY` | TTS provider API key |
| `CALLME_TTS_BASE_URL` | TTS API endpoint (e.g., `https://api.lemonfox.ai/v1`) |
| `CALLME_TTS_VOICE` | Voice name (e.g., `heart`, `onyx`) |
| `CALLME_STT_API_KEY` | Deepgram API key |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_PORT` | `3333` | Server port |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Max wait for user speech (3 min) |
| `CALLME_STT_SILENCE_DURATION_MS` | `800` | Silence to detect end of speech |
| `CALLME_TELNYX_PUBLIC_KEY` | - | Webhook signature verification |

---

## Troubleshooting

### Claude doesn't use the tool
1. Check environment variables are set in `~/.claude/settings.json`
2. Restart Claude Code after adding the MCP server
3. Try explicitly: "Call me when you're done"

### Call doesn't connect
1. Verify your Telnyx credentials
2. Check webhook URL in Telnyx portal matches your server
3. Ensure your phone number is verified

### Audio issues
1. Confirm phone number verification in Telnyx
2. Check TTS/STT API keys are valid

---

## Server Endpoints

| Path | Purpose |
|------|---------|
| `/mcp` | MCP Streamable HTTP (recommended) |
| `/sse` | MCP SSE (deprecated) |
| `/twiml` | Phone provider webhooks |
| `/media-stream` | WebSocket for audio |
| `/health` | Health check |

---

## Development

```bash
cd server
bun install

# Local mode (requires ngrok)
CALLME_NGROK_AUTHTOKEN=your-token bun run dev

# Cloud/SSE mode
CALLME_PUBLIC_URL=https://your-url.com bun run dev:sse
```

---

## Automatic release branch preparation

The standard release command can start on a clean named feature branch. It fetches
`origin/main`, switches to `main` (creating the local tracking branch if needed),
and pulls with fast-forward-only behavior before calculating a version or creating
release metadata. If the branch or commit changes, it restarts the release script
from the updated checkout with the same arguments. It leaves the checkout on `main`.

Unmerged feature commits remain on their original branch and are not included in
the release. Merge the relevant pull request first if those changes must ship.
Local-only or divergent `main` commits, detached HEAD, unavailable Git access,
and `main` already open in another worktree stop preparation safely. Commit or
stash pending changes before switching or pulling; the command never resets,
rebases, automatically stashes, or merges feature work.

Run the branch-preparation regression checks without publishing anything:

```bash
node --test scripts/ci/release-branch.test.cjs
```

This command does not offer a dry-run mode. Use the tests above to check preparation safely.

## License

MIT

---

Built by [SoLoVisionLLC](https://github.com/SoLoVisionLLC)
