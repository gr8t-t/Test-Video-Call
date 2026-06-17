// ══════════════════════════════════════════════════════════════
//  MARV AI — GET DECART KEY  (Vercel Serverless Function)
//  Endpoint: /api/get-key
//  Returns the Decart API key to authenticated users only.
//  Set DECART_API_KEY in Vercel environment variables.
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

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const safeEmail = email.trim().toLowerCase();

  try {
    const client = getRedis();
    const raw    = await client.get(USERS_KEY);
    const users  = raw ? JSON.parse(raw) : [];
    const exists = users.some(u => u.email === safeEmail);

    if (!exists) return res.status(401).json({ error: 'Unauthorized' });

    const key = process.env.DECART_API_KEY;
    if (!key)  return res.status(500).json({ error: 'API key not configured on server' });

    return res.status(200).json({ key });
  } catch (err) {
    console.error('get-key error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
