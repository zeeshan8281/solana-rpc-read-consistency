# Solana RPC reads: one calculation, one account view

A runnable study of `getAccountInfo`, `getMultipleAccounts`, `context.slot` and `minContextSlot`.

**A real controlled transfer through Helius devnet reproduces the wrong total: 210 from separate reads, versus 200 from a grouped read.** Public explorer links verify the signed transactions. Two earlier local runs and three separate read-only Helius mainnet checks are retained with their own evidence.

Read the [article](article.md) for the explanation and diagrams. The [source notes](source-notes.md) connect its claims to primary documentation and Agave source.

## Run

You need Git, Node.js 22 or later, a Helius API key, and at least 0.01 **devnet SOL** in the script’s wallet. These tokens are test-only; no mainnet funds are used. The recorded public run used Node.js 24.22.1.

```sh
git clone https://github.com/zeeshan8281/solana-rpc-read-consistency.git
cd solana-rpc-read-consistency
npm ci --ignore-scripts
export HELIUS_API_KEY='YOUR_API_KEY'
npm run reproduce
```

The script uses Helius devnet and verifies its genesis hash before signing. It creates a fresh test wallet in ignored `.devnet/payer.json` and prints its public address. If it has less than 0.01 devnet SOL, it attempts an airdrop through Helius and then the public devnet RPC. If both fail, use the [Solana faucet](https://faucet.solana.com/) or another legitimate devnet faucet to fund **that printed address**, then rerun. Do not delete the payer file between funding and rerunning. The successful run was funded with 0.025 devnet SOL after automatic airdrop attempts failed; it did not require a working RPC faucet.

## Public transaction proof

| Step | Finalized explorer receipt (Devnet) | What to inspect |
|---|---|---|
| Funding | [0.025 devnet SOL](https://explorer.solana.com/tx/3YiyZf5aSnq3X9H3MkhedDaK3acfLsabUSv7x1YJNoaLs6fsfc4nXCDa37fUMHYFRaMtZzRnjAALdSsqVd6kMXq3?cluster=devnet) | Destination is the experiment wallet below. |
| Setup | [Create mint/accounts, mint 100 + 100, revoke mint authority](https://explorer.solana.com/tx/MgGWaBb3y9AahCjocwMfUgmANDScnx6Y4Rh5FFFkAS9E8eGTE9xz1yVLvFwcvLmJKeg9TG97QR3fXfJ7kbEeEW3?cluster=devnet) | Nine instructions; execution slot 518004708. |
| Transfer | [Transfer 10 tokens from A to B](https://explorer.solana.com/tx/3nr1sD9rqoRSiWUTg4Du5KfQtDGf3BPymGfJMJ2kMduV79cu96yJpEeeWJqqhohPx2Z7uffmss9tQ9Bgd3xmCR2H?cluster=devnet) | Success, finalized, execution slot 518004720; token deltas −10/+10 and balances 90/110. |

Wallet: `2PWsVRsYPKmg4KbPAy2ArQJtoYMeCW4c4TYFJCRNA1BY`. Mint: `47iGxQW9CTmiNS4uKrW7QtiQGKUEih6vZHSReRieWn78` (classic SPL, zero decimals).

The transfer’s pre-token balances are `[100,100]`; its post-token balances are `[90,110]`, matched to A/B through `accountIndex`. Explorer proves the onchain changes. The [captured RPC requests/responses](evidence/controlled-devnet-run/controlled-run.json) establish the offchain read sequence that produced the mixed total:

| Observation | Amount | Context / execution slot |
|---|---|---|
| Baseline grouped pair | [100,100] | 518004712 |
| A before transfer | 100 | 518004713 |
| Signed transfer, subsequently finalized | 10 A → B | 518004720 |
| B after transfer | 110 | 518004724 |
| Grouped pair after transfer | [90,110] | 518004725 |

Mixed total: **100 + 110 = 210**. Grouped total: **90 + 110 = 200**. The public run began 2026-11-02 at 22:26:11 UTC and exited 0 after all assertions passed.

![Actual Helius devnet stdout](figures/05-controlled-devnet-run.jpg)

This is a real browser capture of a read-only viewer showing a verbatim excerpt of saved stdout. [Full stdout](evidence/controlled-devnet-run/stdout.txt), [stderr](evidence/controlled-devnet-run/stderr.txt), [source snapshot](evidence/controlled-devnet-run/source.mjs), [execution/source/lockfile hashes](evidence/controlled-devnet-run/execution.json), [viewer](evidence/controlled-devnet-run/viewer.html) and [browser text](evidence/controlled-devnet-run/browser-text.txt) are included. Browser text matches the saved excerpt byte-for-byte. The stderr retains the native-bigint warning; the SDK used its pure-JavaScript fallback successfully.

[Independent queries](evidence/controlled-devnet-run/independent-verification.json) to `https://api.devnet.solana.com` confirmed both finalized receipts and the final 90/110 account state. The [funding receipt](evidence/controlled-devnet-run/funding-verification.json) was checked separately. Explorer’s visible success/finalization and token changes are preserved in a [screenshot](evidence/controlled-devnet-run/explorer-transfer.jpg) and [page text](evidence/controlled-devnet-run/explorer-transfer.txt); setup [page text](evidence/controlled-devnet-run/explorer-setup.txt) is also included.

This deliberately scheduled transfer demonstrates the read-composition failure mode; it does not measure production incidence. Devnet history may reset, so preserved responses accompany the public links. For a reproduction independent of public faucet availability, use the local path below.

## Run locally

You need Git, Node.js 22 or later, and `solana-test-validator` from the [official Agave release tools](https://github.com/anza-xyz/agave/releases/tag/v4.4.0). The actual runs used Node.js 24.22.1 and Agave 4.4.0 on macOS ARM64. Other versions/platforms have not been executed for this reproduction.

```sh
git clone https://github.com/zeeshan8281/solana-rpc-read-consistency.git
cd solana-rpc-read-consistency
npm ci --ignore-scripts
solana-test-validator --ledger .local-validator/ledger \
  --bind-address 127.0.0.1 --rpc-port 8899 --quiet
```

Leave that validator running. In a second terminal, from the repository directory:

```sh
npm run reproduce -- --local
```

The script uses only `http://127.0.0.1:8899` in local mode. No Helius key, mainnet funds or external faucet is needed. It creates a private test wallet and obtains local test SOL. It then:

1. Creates a zero-decimal classic SPL mint and two token accounts owned by the wallet; mints 100 to each and revokes mint authority in one setup transaction.
2. Reads A with `finalized` commitment.
3. Signs and sends a real transfer of 10 tokens from A to B, then waits for finalization.
4. Reads B independently and reads A/B together. It asserts the mixed total is 210 and the grouped total is 200.
5. Fetches the finalized transaction receipt, maps token-balance entries through `accountIndex`, and asserts `[100,100]` changed to `[90,110]` with `err: null`.

The transfer is deliberately placed between reads. This demonstrates an application combining two valid states; it does not measure how often production applications do that. Mint authority is revoked to keep the experiment’s supply fixed; no further activity is scheduled. The SOL fee is separate from the token total.

Each run writes decoded RPC requests/responses and metadata into its own timestamped `runs/` directory. Private payer files, local ledger, dependencies and generated logs are Git-ignored. Keep the private payer file private even though it holds only test assets. Stop the validator with Ctrl-C after testing; rerunning without resetting its ledger reuses the local payer and creates a fresh mint/account pair.

The pinned SDK may print `bigint: Failed to load bindings, pure JS will be used`. Both recorded executions emitted that warning and still passed. The stderr files preserve it. No native rebuild is required for the tested path.

## Earlier local results

| Recorded run (UTC) | A read | Transfer execution slot | B read | Grouped read | Mixed / grouped totals | Exit |
|---|---|---|---|---|---|---|
| [2026-11-02 21:56:44](evidence/controlled-local-run/controlled-run.json) | 100 @ 59 | 91 | 110 @ 92 | [90,110] @ 92 | 210 / 200 | 0 |
| [2026-11-02 22:11:39](evidence/controlled-clean-install/controlled-run.json) | 100 @ 1888 | 1920 | 110 @ 1920 | [90,110] @ 1920 | 210 / 200 | 0 |

Both are actual signed executions on the local validator. The second used a new directory, a clean `npm ci`, the exact source and lockfile, and a fresh wallet/mint/pair. Immediately afterward, separate Python RPC calls fetched both finalized receipts and checked the final pair. Those [independent responses](evidence/controlled-clean-install/independent-verification.json) are included.

![Actual saved stdout excerpt](figures/04-controlled-local-run.jpg)

This is a genuine browser screenshot of a read-only viewer showing captured stdout, not a native Terminal screenshot. The [viewer](evidence/controlled-local-run/viewer.html), [screenshot text](evidence/controlled-local-run/browser-text.txt), [verbatim excerpt](evidence/controlled-local-run/stdout-excerpt.txt), full stdout, stderr and execution manifest are included. Browser text was checked byte-for-byte against the saved excerpt. The full stdout is also present in the viewer.

The first run’s [source snapshot](evidence/controlled-local-run/source.mjs) matches its recorded SHA-256. Both manifests also record the dependency lockfile hash. The macOS ARM64 Agave archive was verified against the release asset SHA-256 `7f54760a17ccc51b9aee2e019ef1f841a06edfaa8104ba30f94a877ceec0e8e0` before execution.

**Local signatures are not public explorer proof.** They identify transactions on this local ledger and will not resolve on devnet or mainnet explorers. The script saves receipts during the run because the test validator can prune older blocks. A later lookup of the first run’s transfer returned null after pruning; its [follow-up state check](evidence/controlled-local-run/follow-up-state.json) still returned 90/110. The original receipt remains in the captured run JSON. Rerun the study to create your own independently inspectable local ledger.

## Run the Helius read-only check

```sh
export HELIUS_API_KEY='YOUR_API_KEY'
node code/read-token-pair.mjs
```

This dependency-free script makes four requests to Helius mainnet: separate reads of two public USDC token accounts, one grouped read, and a deliberately far-ahead context floor. It sends no transactions and uses your Helius RPC allowance. Its `confirmed` reads and six-decimal USDC amounts are separate from the controlled zero-decimal devnet and local experiments. Equal totals are a valid result; these public accounts can receive unrelated activity, so a difference alone would not prove the conserved-pair failure.

It overwrites root-level `token-pair-run.json` on success or `failed-requests.json` on failure. A failed run can leave an older success file; check timestamps and exit status. Copy generated logs before rerunning if needed. Checked-in evidence directories are never overwritten by this script.

## Separate Helius mainnet checks

These are actual captured Helius mainnet responses, not expected-output fixtures. Your slots and timestamps will differ; balances may stay the same.

| Run (UTC) | Separate contexts | Grouped context | Both totals, raw USDC units | Floor error | Exit |
|---|---|---|---|---|---|
| [2026-11-02 20:21:45](evidence/article-run/token-pair-run.json) | 464627689 / 464627689 | 464627689 | 1975623 | -32016 | 0 |
| [2026-11-02 20:47:28](evidence/review-run/token-pair-run.json) | 464634887 / 464634887 | 464634888 | 1975623 | -32016 | 0 |
| [2026-11-02 20:53:42](evidence/clean-clone-run/token-pair-run.json) | 464636657 / 464636657 | 464636658 | 1975623 | -32016 | 0 |

USDC has six decimals, so 1975623 raw units is 1.975623 USDC. All three runs made four RPC requests and produced empty stderr. The second run also illustrates that different evaluation slots can return the same balances.

Each evidence directory includes `stdout.txt`, `stderr.txt`, `execution.json` and `token-pair-run.json`. The execution manifest records the source SHA-256. The article's original source is preserved at [evidence/article-run/source.mjs](evidence/article-run/source.mjs). The current [code/read-token-pair.mjs](code/read-token-pair.mjs) adds an explicit amount-string check and preserves the original error if saving failure logs fails; `review-run` validates that revision. Do not treat the original screenshot as evidence of the revised source.

The third run used the README command in a fresh clone of the public repository. Its manifest records the tested commit; its source matches the revised script byte-for-byte. Generated output remained ignored by Git.

![Actual captured stdout from the original run](figures/03-token-pair-run.jpg)

This is a real browser screenshot of a read-only viewer displaying saved process stdout. It is not a native Terminal screenshot. [The viewer](evidence/article-run/viewer.html) and [captured browser text](evidence/article-run/browser-text.txt) are included; the latter matches `stdout.txt` byte-for-byte. The first diagram now uses the measured Helius devnet result. The minimum-slot diagram remains conceptual; editable SVGs accompany both.

[Error-path evidence](evidence/error-path-validation/execution.json) records a separate actual Helius request with a deliberately invalid credential while the log destination was occupied by a directory. The script reported the HTTP rejection and the log-save failure, then exited 1. This checks failure handling, not account-read correctness.

## Failure handling and scope

- Local connection refused: start the validator on 127.0.0.1:8899 and keep it running.
- A submitted transaction times out: inspect the printed signature and saved `pending-requests.json` before rerunning. It may have landed. A rerun creates a new mint/pair rather than retrying that same transfer.
- Invalid/missing account, RPC error or unexpected balance: the script fails and saves failure records instead of fabricating a zero balance. Inspect its nonzero exit status.
- Failure to save logs: stderr reports the error; use a writable directory with free space.
- Helius read-only failures: check key/quota and whether the public sample token accounts still exist.

The devnet and local reproductions prove their deliberately arranged execution/read order and observed totals. They do not measure provider latency or incident frequency, establish Helius’s deployed Agave revision, or test every commitment level. The source-based frozen-view explanation concerns confirmed/finalized reads; processed state can still change. Grouping accepts at most 100 addresses and cannot reserve balances for a later transaction.

Responses are decoded JSON, not raw HTTP wire captures. Token amount strings remain exact; unrelated very large numeric JSON fields may be rounded by ordinary JavaScript parsing. Only the stated Node.js and Agave versions were executed for these records.
