# Steam Achievements Tracker

Track Steam games and achievements after signing in with Steam OpenID.

## Environment Variables

Create a `.env.local` file with:

```bash
STEAM_API_KEY=your_steam_web_api_key
NEXTAUTH_URL=http://localhost:3000
STEAM_WHITELIST_IDS=76561198000000000,76561198000000001
```

## Steam Whitelist

- `STEAM_WHITELIST_IDS` is a comma-separated list of Steam64 IDs allowed to use the app.
- Spaces and empty entries are ignored.
- If `STEAM_WHITELIST_IDS` is empty or missing, no users are allowed (deny by default).
- If you remove an ID from the whitelist, that user is revoked on their next authenticated request.

## Auth Behavior

- Whitelist is checked in the Steam callback before creating the session cookie.
- Non-whitelisted users are redirected to `/` with `?error=not_whitelisted`.
- Existing sessions are re-checked on server auth read and cleared if no longer authorized.
