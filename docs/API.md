# API Reference

All data endpoints require authentication via `steam_user` httpOnly cookie. JSDoc documentation is available on every route handler and public function.

## Authentication

| Method | Path                       | Description                                               |
| ------ | -------------------------- | --------------------------------------------------------- |
| `GET`  | `/api/auth/steam`          | Initiate Steam OpenID login (rate limited: 10/min per IP) |
| `GET`  | `/api/auth/steam/callback` | Handle OpenID callback (CSRF nonce validated)             |
| `POST` | `/api/auth/logout`         | Clear session cookie                                      |
| `GET`  | `/api/auth/me`             | Get current authenticated user                            |

## Steam Data

| Method   | Path                                         | Description                                                         |
| -------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `GET`    | `/api/steam/games?type=recent\|all`          | List owned or recently played games                                 |
| `POST`   | `/api/steam/games/hide`                      | Hide a game from the library                                        |
| `DELETE` | `/api/steam/games/hide`                      | Unhide a previously hidden game                                     |
| `GET`    | `/api/steam/achievements?appId=N`            | Get achievements for a game                                         |
| `GET`    | `/api/steam/achievements/batch?appIds=1,2,3` | Batch get achievements (max 200)                                    |
| `GET`    | `/api/steam/game/:id`                        | Get single game details                                             |
| `POST`   | `/api/steam/game/:id/sync`                   | Force-refresh a single game's achievement data from the Steam API   |
| `GET`    | `/api/steam/extras`                          | List "extras" — played-but-not-owned games (`?hidden=1` for hidden) |
| `GET`    | `/api/steam/extras/:id`                      | Get one extra game's detail + enriched achievements                 |
| `GET`    | `/api/steam/stats`                           | Get aggregated user stats                                           |
| `GET`    | `/api/steam/sync`                            | Get last sync timestamps                                            |
| `POST`   | `/api/steam/sync`                            | Trigger full data sync (rate limited: 5/min per user)               |

## Admin

Admin-only routes, gated by `requireAdmin()` (the signed-in user's Steam ID must equal `ADMIN_STEAM_ID`).

| Method   | Path                             | Description                                                             |
| -------- | -------------------------------- | ----------------------------------------------------------------------- |
| `GET`    | `/api/admin/users`               | List allowed users with profile info                                    |
| `POST`   | `/api/admin/users`               | Add an allowed user                                                     |
| `DELETE` | `/api/admin/users`               | Remove an allowed user                                                  |
| `PATCH`  | `/api/admin/users`               | Refresh a user's Steam profile data                                     |
| `GET`    | `/api/admin/pinned-games`        | List globally pinned appids                                             |
| `POST`   | `/api/admin/pinned-games`        | Add an appid to the global pinned list                                  |
| `DELETE` | `/api/admin/pinned-games`        | Remove an appid from the global pinned list                             |
| `GET`    | `/api/admin/orphan-names`        | List appids with a NULL/empty `games.name` referenced by a user         |
| `PUT`    | `/api/admin/orphan-names/:appid` | Set a manual name for an appid (freezes it as `name_source = 'manual'`) |
| `DELETE` | `/api/admin/orphan-names/:appid` | Clear a manual name so auto-sync can resolve it again                   |

## Infrastructure

| Method | Path          | Description                                 |
| ------ | ------------- | ------------------------------------------- |
| `GET`  | `/api/health` | Health check (SQLite connectivity, no auth) |
