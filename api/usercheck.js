// ══════════════════════════════════════════════════════════════
//  MARV — USER CHECK API  (Vercel Serverless Function)
//  Endpoint: /api/usercheck
//  Called by index.html to verify Redis users at login/boot.
//  Does NOT expose passwords or admin data.
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const USERS_KEY = 'marv_users';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, sessionOnly } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const safeEmail = email.trim().toLowerCase();

  try {
    const client = getRedis();
    const raw    = await client.get(USERS_KEY);
    const users  = raw ? JSON.parse(raw) : [];

    // ── SESSION BOOT CHECK (just confirm user still exists) ──
    if (sessionOnly) {
      const exists = users.some(u => u.email === safeEmail);
      return res.status(200).json({ exists });
    }

    // ── LOGIN CHECK (verify email + password match) ──────────
    const user = users.find(u => u.email === safeEmail && u.password === password);
    if (!user) return res.status(200).json({ found: false });

    return res.status(200).json({ found: true, email: user.email });

  } catch (err) {
    console.error('Usercheck error:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
