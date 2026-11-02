# When two Solana RPC reads give you the wrong total

Reading related accounts with commitment, context slots and getMultipleAccounts

A treasury dashboard tracks a token across two accounts. Each holds 100 tokens. Someone transfers 10 from account A to account B, leaving 90 and 110. The total is still 200.

Now refresh the dashboard. Its first RPC call reads A before the transfer: 100. Its second call reads B after the transfer: 110. Both requests succeed. The dashboard displays 210.

This is an illustrative example using two token accounts controlled by one wallet, holding the same non-native classic SPL token, with no other token movements. The transaction fee is paid in SOL and does not change this token total. How can an application combine two valid responses into a balance that neither complete state contains?

## Each request chooses a view

Solana [transactions execute atomically](https://solana.com/docs/core/transactions). The transfer changes both token balances together. Our dashboard has sampled complete states on opposite sides of that change; it has not caught half an executed transfer.

![Two complete views and the mixed total](figures/01-mixed-account-views.png)

Figure 1. The highlighted values come from different observations. These balances and slot labels are illustrative, not a captured transaction.

Inside Agave, a Bank represents account state for a slot. An account read uses a selected Bank to resolve the account. That choice happens for each request: the [getAccountInfo handler](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L541-L568) obtains a Bank, looks up the account and constructs the response.

The request's commitment tells the node which view it may use. It does not bind your next call to the same view. Two requests can both use `confirmed` while the second selects a later Bank. Changing both to `finalized` does not pin the first observation either: the finalized view can advance between calls.

This is why increasing commitment alone does not fix the dashboard. The application needs the two balances to belong to one selected state. It currently asks the node to make that selection twice.

The distinction matters whenever one result depends on several accounts. A list of unrelated balances may tolerate separate observations. For a total, ratio or invariant involving accounts that can change together, decide whether the calculation needs one state view.

## Read the related accounts together

For a known set of addresses, [getMultipleAccounts](https://www.helius.dev/docs/api-reference/rpc/http/getmultipleaccounts) returns the accounts in request order with one response context. In Agave's [grouped handler](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L569-L599), the node selects a Bank once before reading the list.

At confirmed or finalized commitment, this is a [frozen Bank](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/runtime/src/bank.rs#L1-L31): it has finished processing transactions for its slot, so its account state no longer changes. For our treasury, the pair is either 100 and 100, or 90 and 110. Both add to 200.

The [complete example](https://github.com/zeeshan8281/solana-rpc-read-consistency/blob/main/code/read-token-pair.mjs) keeps HTTP handling and validation in the accompanying repository. The grouped request is:

```js
const grouped = await rpc('getMultipleAccounts', [addresses, config]);
assert(!grouped.error, 'The grouped read failed.');
```

Here, `addresses` contains the two token-account addresses and `config` requests `confirmed` commitment with `jsonParsed` encoding. Parsing makes the token fields readable; it does not change the read boundary. The helper in the complete example checks the account program, mint and decimals before adding raw token amounts with `BigInt`. A missing account causes a failure instead of silently becoming a zero balance.

Use token-account addresses here. A wallet address identifies the wallet, and a mint address identifies the token; neither is a substitute for the accounts holding the balances. A wallet can have [multiple token accounts for one mint](https://solana.com/docs/tokens). Keep the response entries attached to their input addresses when caching or displaying them, since a correct list read can still become a wrong calculation if the application mixes up its entries.

The frozen-view detail matters. Agave's [confirmed-Bank tracker](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/optimistically_confirmed_bank_tracker.rs#L312-L336) adopts a notified Bank only after it is frozen and its hash matches the notification. A processed Bank can still change while a request holds its reference. The one-view explanation here follows Agave's implementation for confirmed or finalized reads.

Putting two `getAccountInfo` calls into one HTTP batch is a different operation. The [JSON-RPC specification](https://www.jsonrpc.org/specification#batch) allows batch members to run concurrently and in any order. One HTTP envelope does not make those method invocations share a Bank. Likewise, starting two promises at the same time does not establish a shared observation.

## Keep the context beside the value

The grouped response has a `context.slot` alongside its array of values. Agave builds that context from the [selected Bank's slot](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L148-L153). It describes where the read was evaluated.

It is not the time each account last changed. Account A might remain untouched for many slots while reads of it return increasingly recent context slots. An oracle account can also belong to the selected view while its own published price is old. Check the program's update fields when the age of the underlying data matters.

Keep the context when storing or passing along a combined result. A helper that returns only `result.value` discards information you may need when explaining why two refreshes differ. When diagnosing a total, record the account addresses and commitment too, so you can tell which observations the application combined.

Comparing slots helps identify separate evaluation contexts. Matching slot numbers from independent requests, especially across providers, should not replace a grouped read contract: a slot number alone does not identify a fork or prove that a mutable view stayed unchanged.

## A minimum slot does not pin a snapshot

Suppose the first read returned slot S. It is tempting to set `minContextSlot: S` on the second and expect both values to come from S.

The parameter sets a lower bound. In Agave, the node [selects a Bank using commitment, then checks its slot against the minimum](https://github.com/anza-xyz/agave/blob/a1468974d804b413285d87030f20bd40ae22ffaa/rpc/src/rpc.rs#L278-L293). A later context can pass that check. The request does not select an exact historical Bank or open a persistent read session.

![How a minimum context slot is checked](figures/02-minimum-context-floor.png)

Figure 2. A selected slot below S fails the floor check. S and later slots can pass it; the account lookup can still fail for other reasons.

For the treasury, this means the second call may still read B after the transfer. The floor rejects an older evaluation context, but it cannot make two separate requests share the earlier state. It also supplies no fork-continuity guarantee.

The example deliberately sets a floor far ahead of the current view to make the error visible:

```js
const floor = grouped.result.context.slot + 1_000_000;
const future = await rpc('getAccountInfo', [accountA, {
  ...config, minContextSlot: floor,
}]);
```

Use this parameter when an operation requires a context at least as recent as an observed slot. If the node cannot meet that floor, the application must retry later or fail the operation. The large offset here exists only to make the rejection visible.

## Inspect the response contexts

The companion script lets you inspect response contexts on Helius mainnet. It reads two public USDC token accounts separately and together, then deliberately triggers the minimum-slot error. It does not attempt to reproduce the transfer in Figure 1. You need Node.js 20 or later and a Helius API key. The script has no package dependencies and sends no transactions.

Save [the source](https://github.com/zeeshan8281/solana-rpc-read-consistency/blob/main/code/read-token-pair.mjs) as `read-token-pair.mjs`, then run:

```sh
export HELIUS_API_KEY='YOUR_API_KEY'
node read-token-pair.mjs
```

In the run on 2 November 2026 at 20:21 UTC, using Node.js 24.22.1, both independent reads and the grouped read reported slot 464627689. Both totals were 1975623 raw USDC units, or 1.975623 USDC at six decimals. The final request asked for a minimum of 465627689 and received error -32016. The process exited with code 0. This run did not produce a conflicting total.

![Captured output from the token-account experiment](figures/03-token-pair-run.jpg)

Screenshot. Actual process stdout displayed in a browser log viewer. Full decoded responses and the account addresses are saved in `token-pair-run.json`.

The public accounts can receive unrelated transfers, so their combined balance is not conserved. A different total would need investigation; equality is also a valid result. This run checks response fields and the expected error. The transfer diagram explains the consistency problem separately.

## Where the grouped read stops helping

The method accepts up to 100 addresses. Splitting 250 accounts into several calls creates several read boundaries again. A minimum slot on later chunks does not turn them into one historical snapshot. Concatenating those arrays cannot establish that all 250 values came from one view.

There is also a boundary between reading and acting. A coherent balance observation cannot reserve those balances for a later transaction. The onchain program must check any condition that needs to hold when the transaction executes.

For the two-account dashboard, the practical change is small: request the related accounts together, validate both values, and carry their context with the total. The choice of RPC method determines whether that total starts from one selected view.

[Run the complete study on GitHub](https://github.com/zeeshan8281/solana-rpc-read-consistency#run): setup instructions, source code, diagrams and the captured RPC responses are included.
