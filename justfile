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

# --- stubs, implemented in later phases ---

test-e2e:
    @echo "test-e2e: implemented in phase 3" && exit 1

compose-up:
    @echo "compose-up: implemented in phase 3" && exit 1

compose-down:
    @echo "compose-down: implemented in phase 3" && exit 1

ceremony:
    @echo "ceremony: implemented in phase 3" && exit 1

demo:
    @echo "demo: implemented in phase 6" && exit 1

demo-byzantine:
    @echo "demo-byzantine: implemented in phase 6" && exit 1

bench:
    cargo bench -p bte-crypto

publish-dry:
    @echo "publish-dry: implemented in phase 4" && exit 1

prod-up:
    @echo "prod-up: implemented in phase 8" && exit 1
