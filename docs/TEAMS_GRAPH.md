# Teams channel adapter (Microsoft Graph)

Cursor Autopilot can post chat summaries to a **fixed Teams channel** and read your **thread replies** to continue or steer the agent—without a public webhook.

## Prerequisites

- Microsoft 365 work or school account with access to the target team and channel
- [Entra app registration](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app) (single tenant is typical)

### Entra app settings

1. **Supported account types:** per your organization (single tenant or multitenant).
2. **Allow public client flows:** Yes (required for browser / loopback sign-in).
3. **Mobile and desktop redirect URI:** `http://localhost` (no port) for loopback browser auth.
4. **API permissions (delegated):**
   - `ChannelMessage.Send`
   - `ChannelMessage.Read.All`
   - `User.Read`
   - `offline_access`
5. **Admin consent** for `ChannelMessage.Read.All` if your tenant requires it.

Do **not** put client secrets in `.autopilot.json`. Tokens are stored in VS Code **Secret Storage** after sign-in.

## Find team and channel IDs

Using [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) while signed in:

1. `GET /me/joinedTeams` — note `id` for your team (`teamId`).
2. `GET /teams/{team-id}/channels` — note `id` for the channel (`channelId`).

Standard channels use IDs like `19:...@thread.tacv2`; the full string is the `channelId`.

## Configuration

In the project root `.autopilot.json`:

```json
{
  "enabled": true,
  "adapters": ["teams"],
  "teams": {
    "tenantId": "<directory-tenant-guid>",
    "clientId": "<app-client-guid>",
    "teamId": "<team-id>",
    "channelId": "<channel-id>",
    "pollIntervalSeconds": 10,
    "threadMode": "single-root",
    "authMethod": "browser",
    "externalTokenCachePath": "%USERPROFILE%/.config/ms365-mcp/.token-cache.json"
  }
}
```

| Field | Purpose |
|-------|---------|
| `authMethod` | `"browser"` (recommended) or `"deviceCode"` (headless; often blocked by Conditional Access) |
| `externalTokenCachePath` | Optional: MSAL cache file to import (default matches [ms-365-mcp-server](https://github.com/softeria/ms-365-mcp-server) when `MS365_MCP_TOKEN_CACHE_PATH` is unset). Set to `""` to disable import. |

## Sign in

1. Open the workspace in Cursor with Autopilot enabled.
2. Command Palette → **Cursor Autopilot: Teams Sign In**.
3. Complete sign-in in the browser (loopback / device code, per `authMethod`).
4. If you already use an MCP server that caches Graph tokens at the default path above, Autopilot may reuse that cache and skip a new login.
5. To revoke: **Cursor Autopilot: Teams Sign Out** (Clears the extension’s Secret Storage; does not delete the external cache file).

## Behavior

- The first summary creates a **root message** in the channel.
- Later summaries post as **replies** in the same thread (single-root mode).
- The adapter **polls** for new replies every `pollIntervalSeconds` (default 10).
- Reply semantics match other adapters: `1` continue, `2` stop, or any text to inject into Cursor chat.

## Build and install from source

```bash
cd cursor-autopilot
npm install
npm run compile
npx vsce package
cursor --install-extension cursor-autopilot-*.vsix
```

Restart Cursor after installing the VSIX.

## Troubleshooting

| Symptom | Check |
|--------|--------|
| **AADSTS53003** after device code | Many tenants block device code via [Conditional Access](https://learn.microsoft.com/entra/identity/conditional-access/concept-authentication-flows). Use `"authMethod": "browser"` |
| AADSTS550011 redirect URI | Add `http://localhost` on **Mobile and desktop** in the app registration |
| 401 / sign-in loops | Sign out, sign in again; verify public client flows enabled |
| 403 on send | `ChannelMessage.Send` granted; you are a member of the team |
| 403 on poll | `ChannelMessage.Read.All` admin consent |
| Replies ignored | Reply **in the thread** of the autopilot root message, not a new top-level post |
| Paste but no send (Windows) | Extension tries Ctrl+Enter via helper script; press **Ctrl+Enter** manually if focus was on another app |
| New thread every time | Anchor lost; extension recreates root if reply POST fails |

## Security notes

- Tokens stay on the machine (Cursor Secret Storage).
- Use a dedicated channel or thread for autopilot traffic.
- Summaries may contain code or paths—treat the channel like any internal engineering chat.
