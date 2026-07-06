# deploying bte on Railway

Railway's auto-detection (Railpack) cannot build this repo: it sees the root
Cargo.toml, assumes a plain Rust app, never installs pnpm, and picks `pnpm dev`
as the start command. Every service must be switched to **Dockerfile builds**.
The repo already ships the right Dockerfiles.

Also: `bte-sdk`, `bte-examples`, `bte-demo-sealed-bid`, and
`bte-demo-sealed-bid-anchored` are a library and scripts, not servers.
**Delete those services.** You want exactly seven: 1 coordinator, 5 operator
nodes, 1 web (explorer + edge).

## 0. run the ceremony locally (the dealer never lives in the cloud)

```bash
BTE_KEYSTORE_PASS='<strong passphrase>' just ceremony   # writes .dev-ceremony/
```

Keep `params.bin`. Each `operator-N.keystore` is an encrypted JSON file whose
contents you will paste into one env var per node service.

## 1. coordinator service

- Settings -> Build: **Dockerfile**, path `docker/Dockerfile` (root directory `/`).
- Settings -> Deploy -> Start command: `bte-coordinator`
- Variables:
  - `DATABASE_URL=sqlite:///data/bte.db`
  - `REVEAL_TIMEOUT_SECS=300`
  - `BTE_RATE_RPS=5`, `BTE_RATE_BURST=30`
  - (optional) `SEPOLIA_RPC_URL=...` for at_block conditions
- Volume: mount at `/data`.
- Networking: it listens on Railway's injected `PORT` automatically. Give it a
  private domain only; the public entry point is the web service.

Register the committee once the coordinator is up (from your machine):

```bash
cargo run --release -p bte-cli -- committee-init \
  --coordinator https://<coordinator-public-or-tunnel-url> \
  --params .dev-ceremony/params.bin
```

(Expose the coordinator publicly just long enough to register, or register
through the web service's `/v0` proxy once it is up.)

## 2. node services (x5)

For N in 1..5, one service each:

- Build: **Dockerfile**, path `docker/Dockerfile`.
- Start command: `bte-node --operator-id N`
- Variables:
  - `BTE_COORDINATOR_URL=http://<coordinator service name>.railway.internal:8080`
    (private networking; the coordinator's internal port is whatever `PORT`
    Railway injected there — pin it by setting `PORT=8080` on the coordinator)
  - `BTE_KEYSTORE_PASS=<the ceremony passphrase>`
  - `BTE_KEYSTORE_JSON=<paste the full contents of operator-N.keystore>`
- No volumes, no public networking. Nodes are outbound-only.

## 3. web service (explorer + edge)

- Build: **Dockerfile**, path `docker/Dockerfile.web`.
- Variables:
  - `BTE_DOMAIN=:8080` (Caddy serves plain HTTP on 8080; Railway's edge does TLS)
  - `BTE_UPSTREAM=<coordinator service name>.railway.internal:8080`
- Networking: public domain, target port 8080.

The explorer is same-origin: it calls `/v0/...` on its own domain and Caddy
proxies to the coordinator over private networking. Share links
(`https://<your-domain>/#/s/...`) work for anyone once this service is public.

## sanity checks

```bash
curl https://<web domain>/v0/healthz          # {"ok":true}
curl https://<web domain>/v0/committees        # your committee digest
```

Then open the domain, seal something in the playground, and watch the five
share dots fill.

> v0 posture applies in the cloud too: dealer-trusted setup, everything sealed
> becomes public on cue, do not protect real value.
