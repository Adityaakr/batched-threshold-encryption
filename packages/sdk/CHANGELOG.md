# bte-sdk changelog

## 0.1.0

Initial release.

- `BteClient`: zero-config client (params fetched + cached, digest-checked).
- `condition({at}|{in})`, `seal`, `status`, `reveal`, `waitForReveal`.
- Client-side sealing in wasm (inlined base64, lazy init, no bundler config).
- `bte-sdk/verify` subpath: client-side share verification in its own wasm chunk.
- v0 trust model: dealer-trusted ceremony. Do not protect real value with this.
