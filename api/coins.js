// ══════════════════════════════════════════════════════════════
//  MARV AI — COINS API  (Vercel Serverless Function)
//  Endpoint: /api/coins
//  Handles: balance, drain, topup, rates, packages, free coins
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const RATES_KEY           = 'marv_drain_rates';
const PACKAGES_KEY        = 'marv_coin_packages';
const FREE_COINS_KEY      = 'marv_free_coins_grant';
const PENDING_TOPUPS_KEY  = 'marv_pending_topups';
const DEFAULT_FREE_COINS  = 1200;
const DEFAULT_RATES      = { video: 2.0 };
const DEFAULT_PACKAGES   = [
  { id: 'pkg_starter',  coins: 720,  priceNaira: 16000,  priceUsd: 10,  label: 'Starter'  },
  { id: 'pkg_standard', coins: 1680, priceNaira: 32000,  priceUsd: 20,  label: 'Standard' },
  { id: 'pkg_pro',      coins: 4560, priceNaira: 88000,  priceUsd: 55,  label: 'Pro',      featured: true },
  { id: 'pkg_elite',    coins: 8400, priceNaira: 160000, priceUsd: 100, label: 'Elite'     },
];

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

async function getDrainRates(client) {
  try {
    const raw = await client.get(RATES_KEY);
    if (raw) {
      const r = JSON.parse(raw);
      return { video: parseFloat(r.video ?? DEFAULT_RATES.video) };
    }
  } catch (_) {}
  return { ...DEFAULT_RATES };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, amount, password } = req.body || {};
  const safeEmail = email ? email.trim().toLowerCase() : null;
  const coinKey   = safeEmail ? `marv_coins:${safeEmail}` : null;

  try {
    const client = getRedis();

    // ── BALANCE ──────────────────────────────────────────────
    if (action === 'balance') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      const val     = await client.get(coinKey);
      const balance = val ? parseFloat(val) : 0;
      const rates   = await getDrainRates(client);
      return res.status(200).json({ balance, rates });
    }

    // ── DRAIN ────────────────────────────────────────────────
    if (action === 'drain') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      const rates   = await getDrainRates(client);
      const rate    = rates.video;
      const val     = await client.get(coinKey);
      const balance = val ? parseFloat(val) : 0;

      if (balance <= 0) return res.status(402).json({ error: 'Insufficient coins', balance: 0 });

      const newBalance = Math.max(0, parseFloat((balance - rate).toFixed(4)));
      await client.set(coinKey, newBalance.toString());
      return res.status(200).json({ balance: newBalance, drained: rate });
    }

    // ── TOPUP ────────────────────────────────────────────────
    if (action === 'topup') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      if (!amount || isNaN(amount) || amount === 0) return res.status(400).json({ error: 'Invalid amount' });
      const val        = await client.get(coinKey);
      const balance    = val ? parseFloat(val) : 0;
      const newBalance = parseFloat(Math.max(0, balance + parseFloat(amount)).toFixed(4));
      await client.set(coinKey, newBalance.toString());
      return res.status(200).json({ balance: newBalance });
    }

    // ── GET RATES ────────────────────────────────────────────
    if (action === 'get_rates') {
      const rates = await getDrainRates(client);
      return res.status(200).json({ rates });
    }

    // ── SET RATES (admin) ────────────────────────────────────
    if (action === 'set_rates') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { video } = req.body;
      if (video === undefined) return res.status(400).json({ error: 'video rate required' });
      const current = await getDrainRates(client);
      const updated = { video: video !== undefined ? parseFloat(video) : current.video };
      await client.set(RATES_KEY, JSON.stringify(updated));
      return res.status(200).json({ ok: true, rates: updated });
    }

    // ── GET PACKAGES ─────────────────────────────────────────
    if (action === 'get_packages') {
      const raw      = await client.get(PACKAGES_KEY);
      const parsed   = raw ? JSON.parse(raw) : [];
      const packages = parsed.length > 0 ? parsed : DEFAULT_PACKAGES;
      return res.status(200).json({ packages });
    }

    // ── SET PACKAGES (admin) ─────────────────────────────────
    if (action === 'set_packages') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { packages } = req.body;
      if (!Array.isArray(packages)) return res.status(400).json({ error: 'packages must be an array' });
      await client.set(PACKAGES_KEY, JSON.stringify(packages));
      return res.status(200).json({ ok: true, packages });
    }

    // ── GET FREE COINS (admin) ───────────────────────────────
    if (action === 'get_free_coins') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const raw = await client.get(FREE_COINS_KEY);
      return res.status(200).json({ freeCoins: raw ? parseInt(raw) : DEFAULT_FREE_COINS });
    }

    // ── SET FREE COINS (admin) ───────────────────────────────
    if (action === 'set_free_coins') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { freeCoins } = req.body;
      if (freeCoins === undefined || isNaN(freeCoins) || freeCoins < 0) return res.status(400).json({ error: 'Invalid freeCoins' });
      await client.set(FREE_COINS_KEY, String(parseInt(freeCoins)));
      return res.status(200).json({ ok: true, freeCoins: parseInt(freeCoins) });
    }

    // ── BANK TOPUP REQUEST (user) ────────────────────────────
    if (action === 'bank_request') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      const { packageId, amountNaira, note } = req.body;
      if (!packageId && !amountNaira) return res.status(400).json({ error: 'packageId or amountNaira required' });
      const raw      = await client.get(PENDING_TOPUPS_KEY);
      const topups   = raw ? JSON.parse(raw) : [];
      const entry = {
        id: `bt_${Date.now()}`,
        email: safeEmail,
        packageId: packageId || null,
        amountNaira: amountNaira ? parseFloat(amountNaira) : null,
        note: note || '',
        status: 'pending',
        createdAt: Date.now(),
      };
      topups.push(entry);
      await client.set(PENDING_TOPUPS_KEY, JSON.stringify(topups));
      return res.status(200).json({ ok: true, id: entry.id });
    }

    // ── GET PENDING TOPUPS (admin) ───────────────────────────
    if (action === 'get_pending_topups') {
      if (!req.body.password || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const raw    = await client.get(PENDING_TOPUPS_KEY);
      const topups = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ topups: topups.filter(t => t.status === 'pending') });
    }

    // ── APPROVE TOPUP (admin) ────────────────────────────────
    if (action === 'approve_topup') {
      if (!req.body.password || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { id, coins } = req.body;
      if (!id || !coins) return res.status(400).json({ error: 'id and coins required' });
      const raw    = await client.get(PENDING_TOPUPS_KEY);
      const topups = raw ? JSON.parse(raw) : [];
      const idx    = topups.findIndex(t => t.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Topup not found' });
      const entry  = topups[idx];
      // Credit coins
      const ckKey    = `marv_coins:${entry.email}`;
      const val      = await client.get(ckKey);
      const balance  = val ? parseFloat(val) : 0;
      const newBal   = parseFloat((balance + parseFloat(coins)).toFixed(4));
      await client.set(ckKey, newBal.toString());
      topups[idx].status     = 'approved';
      topups[idx].coinsAdded = parseFloat(coins);
      topups[idx].approvedAt = Date.now();
      await client.set(PENDING_TOPUPS_KEY, JSON.stringify(topups));
      return res.status(200).json({ ok: true, newBalance: newBal });
    }

    // ── REJECT TOPUP (admin) ─────────────────────────────────
    if (action === 'reject_topup') {
      if (!req.body.password || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const raw    = await client.get(PENDING_TOPUPS_KEY);
      const topups = raw ? JSON.parse(raw) : [];
      const idx    = topups.findIndex(t => t.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Topup not found' });
      topups[idx].status     = 'rejected';
      topups[idx].rejectedAt = Date.now();
      await client.set(PENDING_TOPUPS_KEY, JSON.stringify(topups));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Coins API error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
