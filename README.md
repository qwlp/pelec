# PELEC

PELEC is a desktop messaging workspace built with Electron, Vite, TypeScript, and Bun. It combines a native Telegram connector powered by TDLib with an Instagram experience that can run in native mode when session capability is available and otherwise falls back to the embedded web inbox.

The project is optimized for keyboard-first use. The renderer exposes a modal, Vim-like navigation model for switching networks, browsing chats, reading message history, replying, and triggering auth or refresh actions without leaving the keyboard.

## What the app does

- Runs Telegram through a native TDLib connector instead of a plain web wrapper
- Loads Instagram DMs through a native connector when possible, with embedded web fallback when native capability is unavailable
- Keeps per-network Electron partitions so Telegram and Instagram sessions stay isolated
- Supports Telegram chat browsing, message history, reply flows, forwarding, deletion, image sending, document resolution, and audio playback hooks
- Supports Instagram chat browsing, message history, and message sending in native mode
- Exposes desktop notifications and some Linux-specific clipboard integration for copied files

## Current platform expectations

Development commands are Bun-based and work through Electron Forge. Packaging exists for multiple Electron Forge makers, but the repository is currently most complete for Linux:

- Linux AppImage creation is explicitly supported through `bun run appimage`
- The packaged Telegram native runtime bundles `libtdjson.so` for Linux x64
- If you develop on another platform, expect to verify the Telegram native runtime yourself before relying on packaged builds

## Tech stack

- Electron Forge with the Vite plugin
- TypeScript for main, preload, and renderer processes
- Bun for dependency management and project scripts
- TDLib via `tdl` and `prebuilt-tdlib` for Telegram
- `instagram-private-api` for Instagram native connector flows

## Prerequisites

- Bun `1.3.3` or newer
- A desktop Linux environment if you want the documented packaging flow
- Telegram API credentials if you do not want to rely on the repository defaults

Install Bun if needed:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Installation

Install dependencies from the project root:

```bash
bun install
```

## Configuration

PELEC now reads a user config file on startup at:

- Linux: `$XDG_CONFIG_HOME/pelec/config.toml` or `~/.config/pelec/config.toml`
- macOS: `~/Library/Application Support/pelec/config.toml`
- Windows: `%APPDATA%\\pelec\\config.toml`

The file is created automatically on first launch. Current keys:

```toml
[telegram]
ghost_mode = false

[appearance]
window_padding = 12
window_border_radius = 0
font_family = "Ioskeley Mono, Iosevka Mono, Iosevka, JetBrains Mono, IBM Plex Mono, Fira Code, Consolas, monospace"
font_size = 14
background_opacity = 0.92
text_opacity = 1.0
```

Notes:

- Restart the app after editing `config.toml`
- `ghost_mode = true` keeps Telegram chat reads in a best-effort “do not mark seen” mode by avoiding chat-open watcher calls
- `window_padding` is clamped to `0..64`
- `window_border_radius` is clamped to `0..64`
- `font_size` is clamped to `10..28`
- `background_opacity` and `text_opacity` are clamped to `0..1`

PELEC also reads environment variables from `.env` if present. The main variables are:

```bash
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
```

Notes:

- The app currently falls back to bundled Telegram API values when these variables are missing
- For production or personal use, set your own Telegram credentials instead of relying on defaults
- `.env` is loaded from the repository root in development and from nearby packaged locations when bundled

## Running the app

Start the development app:

```bash
bun run start
```

Clean generated artifacts and start again:

```bash
bun run rebuild:start
```

Lint the codebase:

```bash
bun run lint
```

Run the renderer/unit test suite:

```bash
bun test
```

## Packaging

Package the Electron application with Electron Forge:

```bash
bun run package
```

Run the full Forge make pipeline:

```bash
bun run make
```

Build a Linux AppImage from the latest packaged output:

```bash
bun run appimage
```

Force a fresh Linux package before creating the AppImage:

```bash
bun run appimage:fresh
```

Publish through Electron Forge:

```bash
bun run publish
```

## Authentication model

### Telegram

- Uses TDLib in native mode
- Supports QR-based login
- Supports 2FA password completion when Telegram requires it
- Requires valid `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` for a clean setup

### Instagram

- Tries to detect whether native DM capability is already available
- Falls back to embedded web login when native capability is not ready
- Can accept username/password for native login
- Can continue through 2FA or challenge-code flows
- Can reset native auth state from inside the app command set

## Keyboard workflow

PELEC is designed around a normal/insert mode split.

Common shortcuts:

- `j` / `k`: move selection
- `h` / `l`: move between panes
- `Enter`: activate the selected network or chat
- `i`: enter insert mode
- `Escape`: return to normal mode or close transient UI
- `/`: focus the network filter
- `:`: open the command palette
- `gg` / `G`: jump to top or bottom
- `Ctrl+u` / `Ctrl+d`: page movement
- `a`: start auth for the active network
- `r`: refresh, or reply when focused on Telegram messages
- `d`: delete the selected Telegram message
- `o`: open the active network URL in the external browser
- `Alt+1`: switch to Telegram
- `Alt+2`: switch to Instagram
- `Ctrl+[` or `Cmd+[` on macOS: force normal mode globally

The command palette includes actions such as network switching, auth, connector refresh, Instagram auth reset, opening the active web URL, and sending a test notification.

## Repository layout

```text
src/
  main.ts                         Thin Electron entrypoint
  preload.ts                      Safe renderer bridge
  renderer/                       React entrypoint, legacy host, and renderer utilities/tests
  main/                           Main-process bootstrap, IPC, window, protocol, and helpers
  main/connectors/                Telegram and Instagram connector implementations
  shared/                         Cross-process types
scripts/
  run-forge.js                    Bun wrapper for Electron Forge
  rebuild-start.js                Clean rebuild helper
  build-appimage.js               Linux AppImage builder
forge.config.ts                   Electron Forge configuration
```

## Development notes

- Normal project workflows use Bun; system `npm` is not required for day-to-day work
- The repository includes an `npm` shim because Electron Forge expects an npm-compatible version check during some flows
- Telegram runtime modules are loaded from unpacked packaged resources or `node_modules`, depending on whether the app is running bundled or in development
- Linux desktop notifications rely on the local notification daemon; file-copy integration prefers `wl-copy` on Wayland and `xclip` on X11 when available

## License

MIT
