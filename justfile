# bte task runner. Recipes fill in as phases land.

default:
    @just --list

setup:
    rustup target add wasm32-unknown-unknown
    cargo fetch
    pnpm install

build:
    cargo build --workspace

fmt:
    cargo fmt --all

lint:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings

test:
    cargo test --workspace

# Bring up the full dev network: coordinator + fresh ceremony + 5 nodes.
compose-up:
    docker compose -f docker/docker-compose.yml up -d --build
    @echo "waiting for coordinator health…"
    @for i in $(seq 1 60); do curl -fsS http://localhost:8080/v0/healthz >/dev/null 2>&1 && break; sleep 1; done
    @curl -fsS http://localhost:8080/v0/healthz >/dev/null

compose-down:
    docker compose -f docker/docker-compose.yml down -v

# Drive seal -> freeze -> reveal against the live stack and assert payloads.
test-e2e:
    cargo run --release -p bte-cli -- e2e --coordinator http://localhost:8080 --expect-verified-at-least 3

# Local dev ceremony (writes gitignored .dev-ceremony/).
ceremony:
    BTE_KEYSTORE_PASS=${BTE_KEYSTORE_PASS:-devnet-pass} cargo run --release -p bte-cli -- ceremony --n 5 --t 3 --b 64 --out .dev-ceremony

demo:
    @echo "demo: implemented in phase 6" && exit 1

demo-byzantine:
    @echo "demo-byzantine: implemented in phase 6" && exit 1

bench:
    cargo bench -p bte-crypto

publish-dry:
    pnpm -C packages/sdk build
    pnpm -C packages/sdk test
    cd packages/sdk && npm publish --dry-run

prod-up:
    @echo "prod-up: implemented in phase 8" && exit 1
