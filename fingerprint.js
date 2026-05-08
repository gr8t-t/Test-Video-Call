// ══════════════════════════════════════════════════════════════
//  MARV — Fingerprint API  (Vercel Serverless Function)
//  Endpoint: /api/fingerprint
//
//  POST { action: "check",    email, fingerprint }
//    → { status: "match" }           fingerprint matches stored one
//    → { status: "mismatch" }        fingerprint does NOT match
//    → { status: "new" }             no fingerprint stored yet
//
//  POST { action: "register", email, fingerprint }
//    → { status: "registered" }      fingerprint saved to KV
//
//  Vercel KV env vars required (auto-set after creating KV store):
//    KV_REST_API_URL
//    KV_REST_API_TOKEN
// ══════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── CORS headers (same-origin is fine on Vercel, but be safe) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Read body ───────────────────────────────────────────────
  const { action, email, fingerprint } = req.body || {};

  if (!action || !email || !fingerprint) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Sanitise email used as key (no spaces, lowercase)
  const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  const kvKey     = `marv_fp:${safeEmail}`;

  // ── KV helpers (using Vercel KV REST API directly) ──────────
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured' });
  }

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const data = await r.json();
    return data.result ?? null;   // null if key doesn't exist
  }

  async function kvSet(key, value) {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'GET',   // Vercel KV REST uses GET for set with inline value
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    return r.ok;
  }

  // ── ACTION: check ────────────────────────────────────────────
  if (action === 'check') {
    const stored = await kvGet(kvKey);
    if (!stored)                   return res.status(200).json({ status: 'new' });
    if (stored === fingerprint)    return res.status(200).json({ status: 'match' });
    return res.status(200).json({ status: 'mismatch' });
  }

  // ── ACTION: register ─────────────────────────────────────────
  if (action === 'register') {
    const ok = await kvSet(kvKey, fingerprint);
    if (!ok) return res.status(500).json({ error: 'KV write failed' });
    return res.status(200).json({ status: 'registered' });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
