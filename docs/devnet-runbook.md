# devnet runbook

How to stand up and operate a public bte devnet. Trust model v0 throughout:
dealer-trusted setup.

## 0. posture

Public banner text (explorer carries it; put it on anything user-facing):

> everything sealed here becomes public when its condition fires, and the
> whole devnet is wiped weekly.

## 1. ceremony (offline machine)

The dealer machine is the root of trust for the committee's lifetime. Use a
machine that is not the coordinator and ideally never touches the network
again with this material.

```bash
# on the offline machine
export BTE_KEYSTORE_PASS="<per-operator passphrase scheme, see below>"
bte-cli ceremony --n 5 --t 3 --b 64 --out ./ceremony-2026-07
```

Outputs: `params.bin` (public, ~93 KB) and `operator-1..5.keystore`
(encrypted, argon2id + ChaCha20-Poly1305). tau existed only inside the
process and is gone when it exits.

Hygiene:

- Run on a machine without persistent swap, or wipe it after.
- One passphrase per operator is better than one shared passphrase: run the
  ceremony once per… no. The ceremony is one shot; keystores share the
  passphrase given at ceremony time. For v0 devnet: generate a strong random
  passphrase, split it to operators over a separate channel from the
  keystores, and rotate the committee (new ceremony) if either channel leaks.
- `params.bin` is public by design. The keystores are not.

## 2. keystore distribution

Move each `operator-N.keystore` to its operator host over an authenticated,
encrypted channel (scp to a host you control, or age-encrypt to the
operator's key and send). Never post keystores in chat tools. Delete the
dealer machine's copies when operators confirm receipt:

```bash
shred -u ceremony-2026-07/operator-*.keystore   # params.bin stays
```

## 3. coordinator + params registration

```bash
# coordinator host
BTE_DOMAIN=devnet.example.com BTE_KEYSTORE_PASS=... \
  docker compose -f docker/docker-compose.prod.yml up -d --build coordinator web
# register the committee (from anywhere holding params.bin)
bte-cli committee-init --coordinator https://devnet.example.com --params params.bin
```

For a single-host devnet the compose file also runs the nodes; point each
node's volume at its keystore. For multi-host operators, run the `bte:prod`
image on each operator host:

```bash
docker run -d --restart always \
  -e BTE_KEYSTORE_PASS=... -e BTE_COORDINATOR_URL=https://devnet.example.com \
  -v /etc/bte/operator-3.keystore:/ceremony/operator-3.keystore:ro \
  bte:prod bte-node --operator-id 3 --key /ceremony/operator-3.keystore
```

Nodes make outbound calls only; no inbound ports on operator hosts.

## 4. dns + caddy

Point an A/AAAA record at the coordinator host, set `BTE_DOMAIN`, and Caddy
provisions TLS automatically (Let's Encrypt). The edge serves the explorer at
`/` and proxies `/v0/*` to the coordinator. Production rate limits are on
(5 req/s per IP, burst 30; tune with `BTE_RATE_RPS` / `BTE_RATE_BURST`).

## 5. weekly wipe

The devnet promise is "wiped weekly". Cron on the coordinator host:

```cron
# Sunday 04:00 UTC: wipe state, keep the committee (same ceremony volume)
0 4 * * 0  cd /opt/bte && docker compose -f docker/docker-compose.prod.yml stop coordinator && docker run --rm -v bte_data:/data alpine sh -c 'rm -f /data/bte.db*' && docker compose -f docker/docker-compose.prod.yml start coordinator && bte-cli committee-init --coordinator https://devnet.example.com --params /opt/bte/params.bin
```

Wiping the database forgets conditions/ciphertexts/reveals. Re-register the
committee afterward (the command above does). To rotate the committee too,
also remove the `ceremony` volume and rerun section 1.

## 6. incidents

- **Stalled condition** (`status: stalled` in API/explorer): fewer than t
  verified shares arrived within REVEAL_TIMEOUT_SECS. Check node logs
  (`docker logs <node>`): dead nodes, wrong coordinator URL, or keystore
  passphrase failures are the usual causes. A stalled condition recovers
  automatically the moment enough late shares arrive; nothing to replay.
- **Operator misbehaving** (shares flagged rejected in reveal logs): the
  share failed the public pairing check. It never counts toward t. Identify
  the operator from the share log and investigate their host.
- **Operator replacement**: v0 has no resharing. Replacing an operator means
  a NEW ceremony (section 1), a new committee id, and re-pointing apps at it.
  Old conditions under the old committee still reveal if t of the old
  operators remain; otherwise they stall permanently.
- **Coordinator restart mid-reveal**: safe. Cross-terms are recomputed on
  demand after restart; nodes are stateless and re-poll.

## 7. monitoring

`GET /v0/healthz` for liveness. Watch coordinator logs for `conditions
stalled` warnings and `rejected invalid share` warnings; both indicate an
operator problem worth paging on for a devnet.
