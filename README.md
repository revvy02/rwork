# rwork

A CLI for fully managed Rojo workflows — build, sync, and publish Roblox places from one config.

rwork drives [Rojo](https://github.com/rojo-rbx/rojo) and [darklua](https://github.com/seaofvoices/darklua) through a preset-based `rwork.toml`, and opens/publishes places via [rodeo](https://github.com/revvy02/rodeo). It expects `rojo` and `rodeo` on your PATH.

## Install

```sh
rokit add revvy02/rwork
# or
mise use ubi:revvy02/rwork
```

Or download a prebuilt binary from [Releases](https://github.com/revvy02/rwork/releases).

## Configure

Define build presets in `rwork.toml`. Each preset picks a Rojo project, source dir, darklua config, and build-time globals:

```toml
[build.dev]
project = "default.project.json"
src = "src"
darklua = ".darklua/dev.darklua.json"

[build.dev.globals]
__DEV_TOOLS__ = true

[build.prod]
project = "default.project.json"
src = "src"
darklua = ".darklua/prod.darklua.json"

[build.prod.globals]
__DEV_TOOLS__ = false
```

Select one with `--preset <name>` (default `dev`; `--dev`/`--prod` are shorthands).

## Commands

```sh
rwork build [--open]    # compile + build → .rwork/<preset>/build.rbxl
rwork sync              # live-sync source into an open Studio (rojo serve + watchers)
rwork dev               # build + open + sync — the local iteration loop
rwork publish --place <id>   # build + upload to a live place
```

`--open` opens the result in Studio: the built file for `build`, the live place for `publish`.

### Live places

Pass `--place <id>` (or set `RWORK_PLACE`) to work against a real Roblox place instead of a local file:

```sh
rwork dev --place <id>              # publish + open the place + sync into it
rwork publish --place <id> --open   # publish and open, no sync loop
```

Publishing authenticates via an Open Cloud API key: set `RWORK_API_KEY` (a key with place-publishing scope for the place's universe) and the universe is auto-resolved from the place id. Without a key, it falls back to Rojo's cookie auth.

## Environment

- `RWORK_PLACE` — default live place id
- `RWORK_API_KEY` — Open Cloud key for publishing (place-publishing scope)
- `RWORK_UNIVERSE` — override the auto-resolved universe id when publishing
- `RWORK_DIAG=1` — verbose diagnostic logging
- `RWORK_INCLUDE_ASSETS_WHEN_SYNCING` / `RWORK_INCLUDE_SERVER_STORAGE_WHEN_SYNCING` — set `false` to exclude during sync

## License

[MIT](LICENSE)
