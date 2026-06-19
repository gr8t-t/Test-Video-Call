// ══════════════════════════════════════════════════════════════
//  MARV AI — SIGNUP API  (Vercel Serverless Function)
//  Endpoint: /api/signup
//  Handles: signup fee, pending signups, crypto auto-approval,
//           bank transfer pending → admin approval
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const USERS_KEY         = 'marv_users';
const PENDING_KEY       = 'marv_signup_pending';
const FEE_KEY           = 'marv_signup_fee';
const TX_USED_PREFIX    = 'marv_tx_used:';
const WALLETS_KEY       = 'marv_crypto_wallets';
const SIGNUP_COINS      = 500;

const DEFAULT_FEE = { usd: 5, naira: 8000 };

const TRC20_CONTRACTS = {
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
};
const ERC20_CONTRACTS = {
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
};

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `MARV-${seg(4)}-${seg(4)}`;
}

async function createAccount(client, email) {
  const raw   = await client.get(USERS_KEY);
  const users = raw ? JSON.parse(raw) : [];
  if (users.find(u => u.email === email)) return null;
  const newUser = { email, password: generatePassword(), label: email, createdAt: Date.now() };
  users.push(newUser);
  await client.set(USERS_KEY, JSON.stringify(users));
  // Give signup coins
  const coinKey = `marv_coins:${email}`;
  const val     = await client.get(coinKey);
  const balance = val ? parseFloat(val) : 0;
  await client.set(coinKey, (balance + SIGNUP_COINS).toString());
  // Mark first login as done so they don't double-collect
  await client.set(`marv_first_login:${email}`, '1');
  return newUser;
}

// ── BLOCKCHAIN VERIFIERS ─────────────────────────────────────

async function verifyTRC20(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  try {
    const url  = `https://apilist.tronscanapi.com/api/transaction-info?hash=${txHash}`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data || data.contractRet !== 'SUCCESS') return { verified: false, amount: 0 };
    for (const t of (data.trc20TransferInfo || [])) {
      const isUsd = TRC20_CONTRACTS.USDT.toLowerCase() === (t.contract_address || '').toLowerCase()
                 || TRC20_CONTRACTS.USDC.toLowerCase() === (t.contract_address || '').toLowerCase();
      const isUs  = (t.to_address || '').toLowerCase() === walletAddress.toLowerCase();
      const amt   = parseFloat(t.amount_str || t.amount || 0) / 1e6;
      if (isUsd && isUs && amt >= expectedUsd * 0.95) return { verified: true, amount: amt };
    }
    return { verified: false, amount: 0 };
  } catch (_) { return { verified: false, amount: 0 }; }
}

async function verifyERC20(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  const apiKey = process.env.ETHERSCAN_API_KEY || '';
  try {
    const receiptUrl  = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`;
    const receiptData = await (await fetch(receiptUrl)).json();
    const receipt     = receiptData.result;
    if (!receipt || receipt.status !== '0x1') return { verified: false, amount: 0 };
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    for (const log of (receipt.logs || [])) {
      const addr  = (log.address || '').toLowerCase();
      const isUsd = addr === ERC20_CONTRACTS.USDT.toLowerCase() || addr === ERC20_CONTRACTS.USDC.toLowerCase();
      if (!isUsd) continue;
      if ((log.topics || [])[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      const toAddr = '0x' + (log.topics[2] || '').slice(26).toLowerCase();
      if (toAddr !== walletAddress.toLowerCase()) continue;
      const amt = parseInt(log.data, 16) / 1e6;
      if (amt >= expectedUsd * 0.95) return { verified: true, amount: amt };
    }
    return { verified: false, amount: 0 };
  } catch (_) { return { verified: false, amount: 0 }; }
}

async function verifyBTC(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  try {
    const priceData  = await (await fetch('https://api.blockchain.com/v3/exchange/tickers/BTC-USD')).json();
    const btcPrice   = parseFloat(priceData?.last_trade_price || priceData?.price || 0);
    if (!btcPrice) return { verified: false, amount: 0 };
    const expectedBtc = expectedUsd / btcPrice;
    const txData      = await (await fetch(`https://blockchain.info/rawtx/${txHash}`)).json();
    if (!txData || txData.error) return { verified: false, amount: 0 };
    for (const out of (txData.out || [])) {
      if ((out.addr || '').toLowerCase() !== walletAddress.toLowerCase()) continue;
      const btcAmt = (out.value || 0) / 1e8;
      if (btcAmt >= expectedBtc * 0.95) return { verified: true, amount: btcAmt * btcPrice };
    }
    return { verified: false, amount: 0 };
  } catch (_) { return { verified: false, amount: 0 }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, password } = req.body || {};

  try {
    const client = getRedis();

    // ── GET FEE (public) ─────────────────────────────────────
    if (action === 'get_fee') {
      const raw = await client.get(FEE_KEY);
      return res.status(200).json({ fee: raw ? JSON.parse(raw) : DEFAULT_FEE });
    }

    // ── CHECK EMAIL (public) ─────────────────────────────────
    if (action === 'check_email') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      const raw       = await client.get(USERS_KEY);
      const users     = raw ? JSON.parse(raw) : [];
      // Also check pending
      const pendingRaw = await client.get(PENDING_KEY);
      const pending    = pendingRaw ? JSON.parse(pendingRaw) : [];
      const exists = users.some(u => u.email === safeEmail) || pending.some(p => p.email === safeEmail);
      return res.status(200).json({ exists });
    }

    // ── CREATE PENDING (public) ──────────────────────────────
    if (action === 'create_pending') {
      const { email, emailPassword, method } = req.body;
      if (!email || !emailPassword || !method) return res.status(400).json({ error: 'Missing fields' });
      const safeEmail = email.trim().toLowerCase();

      // Check not already registered
      const raw    = await client.get(USERS_KEY);
      const users  = raw ? JSON.parse(raw) : [];
      if (users.find(u => u.email === safeEmail)) return res.status(409).json({ error: 'Email already registered' });

      const pendingRaw = await client.get(PENDING_KEY);
      const pending    = pendingRaw ? JSON.parse(pendingRaw) : [];
      if (pending.find(p => p.email === safeEmail)) return res.status(409).json({ error: 'Signup already pending' });

      const entry = { email: safeEmail, emailPassword, method, status: 'pending', createdAt: Date.now(), id: `sp_${Date.now()}` };
      pending.push(entry);
      await client.set(PENDING_KEY, JSON.stringify(pending));
      return res.status(200).json({ ok: true, id: entry.id });
    }

    // ── VERIFY CRYPTO SIGNUP (public) ───────────────────────
    if (action === 'verify_crypto') {
      const { email, emailPassword, txHash, network } = req.body;
      if (!email || !emailPassword || !txHash || !network) return res.status(400).json({ error: 'Missing fields' });
      const safeEmail = email.trim().toLowerCase();
      const safeTx    = txHash.trim();

      // Check tx not already used
      const txKey = `${TX_USED_PREFIX}${safeTx}`;
      if (await client.get(txKey)) return res.status(409).json({ error: 'Transaction already used.' });

      // Check not already registered
      const usersRaw = await client.get(USERS_KEY);
      const users    = usersRaw ? JSON.parse(usersRaw) : [];
      if (users.find(u => u.email === safeEmail)) return res.status(409).json({ error: 'Email already registered' });

      // Get wallets + fee
      const walletsRaw = await client.get(WALLETS_KEY);
      const wallets    = walletsRaw ? JSON.parse(walletsRaw) : {};
      const feeRaw     = await client.get(FEE_KEY);
      const fee        = feeRaw ? JSON.parse(feeRaw) : DEFAULT_FEE;

      let verified = false, amountUsd = 0;
      if      (network === 'trc20') ({ verified, amount: amountUsd } = await verifyTRC20(safeTx, wallets.trc20, fee.usd));
      else if (network === 'erc20') ({ verified, amount: amountUsd } = await verifyERC20(safeTx, wallets.erc20, fee.usd));
      else if (network === 'btc')   ({ verified, amount: amountUsd } = await verifyBTC(safeTx, wallets.btc, fee.usd));
      else return res.status(400).json({ error: 'Unknown network' });

      if (!verified) return res.status(402).json({ error: 'Transaction not verified. Check the hash and try again, or wait a few minutes.' });

      // Mark tx used
      await client.set(txKey, JSON.stringify({ email: safeEmail, ts: Date.now(), type: 'signup' }), 'EX', 60 * 60 * 24 * 365);

      // Create account
      const newUser = await createAccount(client, safeEmail);
      if (!newUser) return res.status(409).json({ error: 'Email already registered' });

      return res.status(200).json({ ok: true, password: newUser.password, coins: SIGNUP_COINS });
    }

    // ── ADMIN ONLY BELOW ─────────────────────────────────────
    if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

    // ── GET PENDING (admin) ──────────────────────────────────
    if (action === 'get_pending') {
      const raw     = await client.get(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ pending: pending.filter(p => p.status === 'pending') });
    }

    // ── APPROVE (admin) ──────────────────────────────────────
    if (action === 'approve') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const raw     = await client.get(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) : [];
      const idx     = pending.findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Pending signup not found' });
      const entry = pending[idx];

      // Create account
      const newUser = await createAccount(client, entry.email);
      if (!newUser) {
        // Already exists — just remove from pending
        pending.splice(idx, 1);
        await client.set(PENDING_KEY, JSON.stringify(pending));
        return res.status(409).json({ error: 'User already exists' });
      }

      pending[idx].status = 'approved';
      await client.set(PENDING_KEY, JSON.stringify(pending));
      return res.status(200).json({ ok: true, user: newUser, coins: SIGNUP_COINS });
    }

    // ── REJECT (admin) ───────────────────────────────────────
    if (action === 'reject') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const raw     = await client.get(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) : [];
      const idx     = pending.findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      pending[idx].status = 'rejected';
      await client.set(PENDING_KEY, JSON.stringify(pending));
      return res.status(200).json({ ok: true });
    }

    // ── SET FEE (admin) ──────────────────────────────────────
    if (action === 'set_fee') {
      const { usd, naira } = req.body;
      if (!usd || !naira) return res.status(400).json({ error: 'usd and naira required' });
      const fee = { usd: parseFloat(usd), naira: parseFloat(naira) };
      await client.set(FEE_KEY, JSON.stringify(fee));
      return res.status(200).json({ ok: true, fee });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Signup API error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
