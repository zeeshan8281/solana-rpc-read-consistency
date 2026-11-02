import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import {
  ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID, AuthorityType,
  createInitializeMint2Instruction, createInitializeAccount3Instruction,
  createMintToInstruction, createSetAuthorityInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const local = process.argv.includes('--local');
assert(process.argv.slice(2).every(x => x === '--local'), 'Only --local is supported.');
const network = local ? 'local-validator' : 'devnet';
const key = process.env.HELIUS_API_KEY || '';
assert(local || key, 'Set HELIUS_API_KEY for devnet, or use --local with a running test validator.');
const endpoint = local ? 'http://127.0.0.1:8899' : `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
const privateDir = local ? '.local-validator' : '.devnet';
const commitment = 'finalized';
const config = { commitment, encoding: 'jsonParsed' };
const records = [];
let id = 0;
const started = new Date().toISOString();
const output = `runs/${started.replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const redact = text => key ? text.replaceAll(encodeURIComponent(key), '[REDACTED]').replaceAll(key, '[REDACTED]') : text;
const sanitize = value => redact(JSON.stringify(value, null, 2));

async function rpc(method, params = [], url = endpoint) {
  const request = { jsonrpc: '2.0', id: ++id, method, params };
  const record = { at: new Date().toISOString(), provider: local ? 'Local Agave validator' : url === endpoint ? 'Helius devnet' : 'Solana public devnet', request };
  records.push(record);
  if (method === 'sendTransaction') await writeFile(`${output}/pending-requests.json`, sanitize(records) + '\n');
  const http = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(20_000),
  });
  record.httpStatus = http.status;
  const body = await http.text();
  try { record.response = JSON.parse(body); }
  catch { record.body = body; throw new Error(`${method}: HTTP ${http.status}; response was not JSON.`); }
  const response = record.response;
  assert(http.ok, `${method}: HTTP ${http.status}`);
  assert.equal(response.id, request.id);
  assert(!response.error, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}

async function finalized(signature) {
  for (let attempt = 0; attempt < 75; attempt++) {
    const status = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
    if (status) {
      assert.equal(status.err, null, 'Transaction failed.');
      if (status.confirmationStatus === 'finalized') return status.slot;
    }
    await sleep(1_000);
  }
  throw new Error(`Confirmation timed out; inspect ${network} transaction ${signature} before retrying.`);
}

async function send(instructions, payer, extraSigners = []) {
  const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment }])).value;
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(...instructions);
  tx.sign(payer, ...extraSigners);
  const signature = await rpc('sendTransaction', [tx.serialize().toString('base64'), {
    encoding: 'base64', preflightCommitment: commitment, skipPreflight: false, maxRetries: 3,
  }]);
  console.log(`Submitted ${network} transaction: ${signature}`);
  const slot = await finalized(signature);
  return { signature, slot };
}

function amount(account, mint, owner) {
  assert(account, 'Token account is missing.');
  assert.equal(account.owner, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(account.data?.parsed?.type, 'account');
  const info = account.data.parsed.info;
  assert.equal(info.mint, mint);
  assert.equal(info.owner, owner);
  assert.equal(info.tokenAmount.decimals, 0);
  assert.equal(typeof info.tokenAmount.amount, 'string');
  assert(/^\d+$/.test(info.tokenAmount.amount));
  return BigInt(info.tokenAmount.amount);
}

async function main() {
  const genesisHash = await rpc('getGenesisHash');
  if (!local) assert.equal(genesisHash, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', 'Refusing a non-devnet cluster.');
  const validatorVersion = await rpc('getVersion');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  let payer;
  try {
    payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(`${privateDir}/payer.json`, 'utf8'))));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    payer = Keypair.generate();
    await writeFile(`${privateDir}/payer.json`, JSON.stringify([...payer.secretKey]), { mode: 0o600, flag: 'wx' });
  }
  const owner = payer.publicKey.toBase58();
  console.log(`${local ? 'Local Agave validator' : 'Helius devnet'} | finalized | ${started}`);
  console.log(`Test wallet: ${owner}`);
  const balance = (await rpc('getBalance', [owner, { commitment }])).value;
  if (balance < 10_000_000) {
    let signature;
    for (const faucet of local ? [endpoint] : [endpoint, 'https://api.devnet.solana.com']) {
      try { signature = await rpc('requestAirdrop', [owner, 1_000_000_000], faucet); break; }
      catch (error) { console.log(`Test SOL airdrop attempt failed: ${redact(error.message)}`); }
    }
    assert(signature, `Test SOL funding failed for ${owner}. See the README funding instructions before retrying.`);
    await finalized(signature);
  }

  const mintKey = Keypair.generate(), a = Keypair.generate(), b = Keypair.generate();
  const mint = mintKey.publicKey.toBase58(), addresses = [a.publicKey.toBase58(), b.publicKey.toBase58()];
  const mintRent = await rpc('getMinimumBalanceForRentExemption', [MINT_SIZE]);
  const accountRent = await rpc('getMinimumBalanceForRentExemption', [ACCOUNT_SIZE]);
  const create = (kp, space, lamports) => SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space, lamports, programId: TOKEN_PROGRAM_ID });
  const setup = await send([
    create(mintKey, MINT_SIZE, mintRent),
    createInitializeMint2Instruction(mintKey.publicKey, 0, payer.publicKey, null),
    create(a, ACCOUNT_SIZE, accountRent),
    createInitializeAccount3Instruction(a.publicKey, mintKey.publicKey, payer.publicKey),
    create(b, ACCOUNT_SIZE, accountRent),
    createInitializeAccount3Instruction(b.publicKey, mintKey.publicKey, payer.publicKey),
    createMintToInstruction(mintKey.publicKey, a.publicKey, payer.publicKey, 100n),
    createMintToInstruction(mintKey.publicKey, b.publicKey, payer.publicKey, 100n),
    createSetAuthorityInstruction(mintKey.publicKey, payer.publicKey, AuthorityType.MintTokens, null),
  ], payer, [mintKey, a, b]);
  const before = await rpc('getMultipleAccounts', [addresses, { ...config, minContextSlot: setup.slot }]);
  const initial = before.value.map(x => amount(x, mint, owner));
  assert.deepEqual(initial, [100n, 100n]);
  const first = await rpc('getAccountInfo', [addresses[0], { ...config, minContextSlot: before.context.slot }]);
  const oldA = amount(first.value, mint, owner);
  assert.equal(oldA, 100n);

  // Deliberately place one real transfer between the two independent reads.
  const transfer = await send([
    createTransferCheckedInstruction(a.publicKey, mintKey.publicKey, b.publicKey, payer.publicKey, 10n, 0),
  ], payer);
  assert(first.context.slot < transfer.slot, 'Expected the first read before the transfer execution slot.');
  const second = await rpc('getAccountInfo', [addresses[1], { ...config, minContextSlot: transfer.slot }]);
  const grouped = await rpc('getMultipleAccounts', [addresses, { ...config, minContextSlot: transfer.slot }]);
  assert(second.context.slot >= transfer.slot && grouped.context.slot >= transfer.slot);
  const newB = amount(second.value, mint, owner);
  const after = grouped.value.map(x => amount(x, mint, owner));
  assert.equal(newB, 110n);
  assert.deepEqual(after, [90n, 110n]);
  assert.equal(oldA + newB, 210n);
  assert.equal(after[0] + after[1], 200n);

  let receipt;
  for (let attempt = 0; attempt < 10; attempt++) {
    receipt = await rpc('getTransaction', [transfer.signature, { commitment, encoding: 'json', maxSupportedTransactionVersion: 0 }]);
    if (receipt) break;
    await sleep(1_000);
  }
  assert(receipt, 'Finalized receipt unavailable.');
  assert.equal(receipt.meta.err, null);
  assert.equal(receipt.slot, transfer.slot);
  const keys = receipt.transaction.message.accountKeys;
  const txAmount = (rows, address) => {
    const row = rows.find(x => keys[x.accountIndex] === address);
    assert(row, 'Token balance missing from receipt.');
    assert.equal(row.mint, mint);
    assert.equal(row.uiTokenAmount.decimals, 0);
    return row.uiTokenAmount.amount;
  };
  const pre = addresses.map(x => txAmount(receipt.meta.preTokenBalances, x));
  const post = addresses.map(x => txAmount(receipt.meta.postTokenBalances, x));
  assert.deepEqual(pre, ['100', '100']);
  assert.deepEqual(post, ['90', '110']);
  const mintInfo = (await rpc('getAccountInfo', [mint, { ...config, minContextSlot: transfer.slot }])).value.data.parsed.info;
  assert.equal(mintInfo.mintAuthority, null);
  assert.equal(mintInfo.supply, '200');
  const result = {
    started, completed: new Date().toISOString(), node: process.version,
    network, genesisHash, validatorVersion, commitment, owner, mint, addresses, decimals: 0,
    setup, transfer, beforeSlot: before.context.slot, firstReadSlot: first.context.slot,
    secondReadSlot: second.context.slot, groupedSlot: grouped.context.slot,
    before: initial.map(String), firstA: String(oldA), secondB: String(newB),
    mixedTotal: String(oldA + newB), after: after.map(String), groupedTotal: String(after[0] + after[1]),
    receiptPre: pre, receiptPost: post, mintSupply: mintInfo.supply,
    sourceSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
    records,
  };
  await writeFile(`${output}/controlled-run.json`, sanitize(result) + '\n');
  console.log(`Mint: ${mint}`);
  console.log(`Account A: ${addresses[0]}`);
  console.log(`Account B: ${addresses[1]}`);
  console.log(`Before: A=100 B=100 total=200 | slot ${before.context.slot}`);
  console.log(`Read A before transfer: ${oldA} | slot ${first.context.slot}`);
  console.log(`Transfer: 10 tokens A -> B | finalized slot ${transfer.slot}`);
  console.log(`Read B after transfer: ${newB} | slot ${second.context.slot}`);
  console.log(`MIXED TOTAL: ${oldA} + ${newB} = ${oldA + newB}`);
  console.log(`GROUPED TOTAL: ${after[0]} + ${after[1]} = ${after[0] + after[1]} | slot ${grouped.context.slot}`);
  console.log(`Transaction metadata: [${pre}] -> [${post}]; err=null`);
  console.log('Mint authority revoked; supply=200. All assertions passed.');
  if (!local) console.log(`Explorer: https://explorer.solana.com/tx/${transfer.signature}?cluster=devnet`);
  console.log(`Decoded requests and responses: ${output}/controlled-run.json`);
}

main().catch(async error => {
  process.exitCode = 1;
  console.error(redact(error.message));
  try { await writeFile(`${output}/failed-requests.json`, sanitize(records) + '\n'); }
  catch { console.error('Could not save failure records.'); }
});
