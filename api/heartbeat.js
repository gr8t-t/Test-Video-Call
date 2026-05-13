// ══════════════════════════════════════════════════════════════
//  MARV — HEARTBEAT API  (Vercel Serverless Function)
//  Endpoint: /api/heartbeat
//  Called every 25s by logged-in users to mark them as online
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

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

  const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');

  try {
    const client = getRedis();
    // Store timestamp, auto-expire after 60s
    await client.set(`marv_hb:${safeEmail}`, Date.now().toString(), 'EX', 60);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }
}
