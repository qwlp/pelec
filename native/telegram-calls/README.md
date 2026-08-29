# PELEC Telegram call engine

`pelec-call-engine` is an isolated Linux x64 host. It speaks a 4-byte big-endian
length-prefixed JSON protocol over stdin/stdout and dynamically loads
`libpelec-tgcalls.so`.

The bridge uses the LGPL NTgCalls media engine, which implements Telegram
private and group calls over WebRTC. It exports
`pelec_tgcalls_get_bridge_api` from `include/pelec_tgcalls_bridge.h`, keeping
the LGPL library dynamically replaceable.

`bun install` automatically downloads the pinned Linux x86_64 shared-library
release, verifies its checksums, and builds the adapter and protocol host.

```bash
bun run calls:install
```

Set `PELEC_SKIP_CALLS_INSTALL=1` to skip the native call runtime.

The pinned release, source commit, asset hashes, and license hash are recorded
in `dependencies.lock.json`.
