import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const key = process.env.HELIUS_API_KEY;
assert(key, 'Set HELIUS_API_KEY before running this example.');
const endpoint = `https://mainnet.helius-rpc.com/?api-key=${key}`;
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const config = { commitment: 'confirmed', encoding: 'jsonParsed' };
// Public sample accounts; unrelated transfers can change their combined balance.
const addresses = [
  '1113odRAP5wXa8n7NFVBG53XrqWeDrViZu5rSiSsVA3',
  '11NCSQ2Bm6UZdtDqBeHFcos5eFXT1kJ3jG29qKJCWU',
];
const records = [];
let id = 0;

async function rpc(method, params) {
  const request = { jsonrpc: '2.0', id: ++id, method, params };
  const http = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15_000),
  });
  assert(http.ok, `${method}: HTTP ${http.status}`);
  const response = await http.json();
  records.push({ request, response });
  assert.equal(response.id, request.id);
  return response;
}

function amount(account) {
  assert(account, 'A requested token account was not found.');
  assert.equal(account.owner, tokenProgram);
  assert.equal(account.data?.parsed?.type, 'account');
  const info = account.data.parsed.info;
  assert.equal(info.mint, mint);
  assert.equal(info.tokenAmount.decimals, 6);
  assert.equal(typeof info.tokenAmount.amount, 'string');
  assert(/^\d+$/.test(info.tokenAmount.amount));
  return BigInt(info.tokenAmount.amount);
}

async function main() {
  const started = new Date().toISOString();
  const [accountA, accountB] = addresses;

  const first = await rpc('getAccountInfo', [accountA, config]);
  const second = await rpc('getAccountInfo', [accountB, config]);
  assert(!first.error && !second.error, 'An independent read failed.');
  const separateTotal = amount(first.result.value) + amount(second.result.value);

  const grouped = await rpc('getMultipleAccounts', [addresses, config]);
  assert(!grouped.error, 'The grouped read failed.');
  assert.equal(grouped.result.value.length, 2);
  const groupedTotal = grouped.result.value.reduce((sum, value) => sum + amount(value), 0n);
  const slots = [first, second, grouped].map(x => x.result.context.slot);
  assert(slots.every(Number.isSafeInteger));

  const floor = grouped.result.context.slot + 1_000_000;
  const future = await rpc('getAccountInfo', [accountA, {
    ...config, minContextSlot: floor,
  }]);
  assert.equal(future.error?.code, -32016);
  assert(Number.isSafeInteger(future.error.data?.contextSlot));
  assert(future.error.data.contextSlot < floor);

  const run = {
    started, completed: new Date().toISOString(), node: process.version,
    network: 'mainnet-beta', mint, addresses, slots,
    separateTotal: separateTotal.toString(), groupedTotal: groupedTotal.toString(),
    decimals: 6, floor, floorError: future.error.code,
    nodeContextSlot: future.error.data.contextSlot, records,
  };
  await writeFile('token-pair-run.json', JSON.stringify(run, null, 2) + '\n');
  console.log(`Helius mainnet | confirmed | ${started}`);
  console.log(`Separate read slots: ${slots[0]}, ${slots[1]}`);
  console.log(`Grouped read slot:   ${slots[2]}`);
  console.log(`Separate total: ${separateTotal} raw USDC units`);
  console.log(`Grouped total:  ${groupedTotal} raw USDC units`);
  console.log(`Totals equal: ${separateTotal === groupedTotal}`);
  console.log(`Requested floor: ${floor}`);
  console.log(`Floor error: ${future.error.code}; node context: ${future.error.data.contextSlot}`);
  console.log(`Checks passed; ${records.length} read-only RPC requests. No transaction sent.`);
  console.log('Full decoded responses: token-pair-run.json');
}

main().catch(async error => {
  console.error(error.message.replaceAll(key, '[REDACTED]'));
  process.exitCode = 1;
  try {
    await writeFile('failed-requests.json', JSON.stringify(records, null, 2).replaceAll(key, '[REDACTED]') + '\n');
  } catch {
    console.error('Could not save failed-requests.json. Check directory permissions and disk space.');
  }
});
