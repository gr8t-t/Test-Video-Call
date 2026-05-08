// ══════════════════════════════════════════════════════════════
//  MARV — Fingerprint API  (Vercel Serverless Function)
//  Endpoint: /api/fingerprint
//  Uses: ioredis via REDIS_URL environment variable
//
//  POST { action: "check",    email, fingerprint }
//    → { status: "match" }
//    → { status: "mismatch" }
//    → { status: "new" }
//
//  POST { action: "register", email, fingerprint }
//    → { status: "registered" }
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

// Reuse Redis connection across warm invocations
let redis;
function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      tls: { rejectUnauthorized: false },
      maxRetriesPerRequest: 3,
    });
  }
  return redis;
}

export default async function handler(req, res) {

  // ── CORS ────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Parse body ──────────────────────────────────────────────
  const { action, email, fingerprint } = req.body || {};

  if (!action || !email || !fingerprint) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Sanitise email for use as Redis key
  const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  const key       = `marv_fp:${safeEmail}`;

  try {
    const client = getRedis();

    // ── ACTION: check ────────────────────────────────────────
    if (action === 'check') {
      const stored = await client.get(key);
      if (!stored)                 return res.status(200).json({ status: 'new' });
      if (stored === fingerprint)  return res.status(200).json({ status: 'match' });
      return res.status(200).json({ status: 'mismatch' });
    }

    // ── ACTION: register ─────────────────────────────────────
    if (action === 'register') {
      await client.set(key, fingerprint);
      return res.status(200).json({ status: 'registered' });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Redis error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}
