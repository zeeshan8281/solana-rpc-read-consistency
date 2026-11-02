# Source notes

Checked on 3 November 2026. This is a targeted review of the article's claims, not a certification of any RPC provider's deployed implementation. All external sources below are public primary sources. Undated documentation was inspected as available on that date.

The Agave references pin commit `a1468974d804b413285d87030f20bd40ae22ffaa` (1 November 2026). Linking a source revision makes the explanation inspectable; it does not establish that Helius deploys that revision.

## Claim-to-source map

| Claim | Primary source and scope |
|---|---|
| A Solana transaction applies its instructions atomically. | [Solana transactions](https://solana.com/docs/core/transactions), atomicity and rollback. |
| A wallet can own multiple token accounts for the same mint. | [Solana tokens](https://solana.com/docs/tokens), token-account model. This does not mean multiple associated token accounts for one owner/mint/program tuple. |
| A classic token transfer subtracts from one balance and adds to the other. | [SPL Token transfer handler, program@v9.0.0](https://github.com/solana-program/token/blob/program@v9.0.0/program/src/processor.rs#L228-L355) and [Solana transfer instructions](https://solana.com/docs/tokens/basics/transfer-tokens). The illustration excludes native SOL, transfer-fee extensions and unrelated token movement. |
| Each independent account request selects a Bank. | [Agave getAccountInfo](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L541-L568). |
| A grouped account request selects a Bank once before its loop. | [Agave getMultipleAccounts](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L569-L599). It reuses the same Bank reference; this is not a claim that all memory reads happen simultaneously. |
| The frozen-view scope matters. | [Bank lifecycle](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/runtime/src/bank.rs#L1-L31) and [confirmed tracker](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/optimistically_confirmed_bank_tracker.rs#L312-L355). A processed Bank can still accept transactions. |
| context.slot is the selected Bank's slot, not an account's last-change slot. | [Agave response context](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L148-L153). |
| minContextSlot is a floor, not exact history or a read session. | [Agave select-then-check](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L278-L293) and [Helius getAccountInfo](https://www.helius.dev/docs/api-reference/rpc/http/getaccountinfo). |
| An HTTP batch does not establish a common snapshot. | [JSON-RPC 2.0 batch specification](https://www.jsonrpc.org/specification#batch), which permits arbitrary execution order and parallelism. This does not say every server executes batches concurrently. |
| The grouped method accepts at most 100 addresses and preserves request order. | [Solana getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts) and [Helius method reference](https://www.helius.dev/docs/api-reference/rpc/http/getmultipleaccounts). |
| Parsed token amounts are integer strings; parsed data must be validated. | [Solana RPC JSON structures](https://solana.com/docs/rpc/json-structures) and [Agave token parser](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L2701-L2723). The script rejects null, unexpected token data and parser fallback instead of inventing zero. |
| The example mint is mainnet USDC. | [Circle contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), Solana mainnet entry. |

## Counterchecks

- **Would finalized fix two independent reads?** Finalized selection can advance between requests. It does not pin the earlier Bank for the later request.
- **Does sharing a Bank always mean a fixed snapshot?** No. The frozen confirmed/finalized scope is necessary for this explanation; a processed Bank can change.
- **Do equal numeric slots prove two responses belong to identical state?** Not universally. The slot does not identify a fork by itself, and processed state can change within a slot.
- **Could a changed total prove the motivating failure?** No. The public sample accounts can receive unrelated transfers. A controlled conserved pair would be needed to establish that incident experimentally.
- **Does a minimum slot guarantee ancestry or exact history?** No. It is a numeric lower-bound check on the selected Bank.
- **Can 250 accounts be made coherent by concatenating chunks?** The method limit leaves multiple independent read boundaries. Concatenation alone provides no common-view guarantee.

## Evidence boundary

The live evidence directories record API behavior, not upstream-source correctness or provider deployment. The opening transfer is an explicitly labeled thought experiment. No transfer was executed for this study. The original and revised source hashes identify which version produced each captured result.

The sample addresses were selected through a bounded [Helius DAS getTokenAccounts](https://www.helius.dev/docs/api-reference/das/gettokenaccounts) lookup filtered by mint. Discovery is separate from the four account-RPC calls. The arithmetic uses the parsed integer strings returned by the account RPCs, not an indexed DAS amount or indexing watermark.
