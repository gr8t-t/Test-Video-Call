// ──────────────────────────────────────────────────────────────
//  MARV AI — Realtime AI Video Transform
//  Powered by Decart lucy_2_rt model
//  API key is fetched from the backend — never entered by users
// ──────────────────────────────────────────────────────────────

import { createDecartClient, models } from "https://esm.sh/@decartai/sdk";

// ── DOM REFS ──────────────────────────────────────────────────
const inputVideo        = document.getElementById("input-video");
const outputVideo       = document.getElementById("output-video");
const inputPlaceholder  = document.getElementById("input-placeholder");
const outputPlaceholder = document.getElementById("output-placeholder");
const statusBadge       = document.getElementById("status-badge");
const statusText        = document.getElementById("status-text");
const promptInput       = document.getElementById("prompt-input");
const presetBtns        = document.querySelectorAll(".preset-btn");
const uploadZone        = document.getElementById("upload-zone");
const imageUpload       = document.getElementById("image-upload");
const imagePreviewWrap  = document.getElementById("image-preview-wrap");
const imagePreview      = document.getElementById("image-preview");
const removeImageBtn    = document.getElementById("remove-image");
const enhanceToggle     = document.getElementById("enhance-toggle");
const applyBtn          = document.getElementById("apply-btn");
const startBtn          = document.getElementById("start-btn");
const stopBtn           = document.getElementById("stop-btn");
const billingCounter    = document.getElementById("billing-counter");
const billingSecs       = document.getElementById("billing-secs");
const toast             = document.getElementById("toast");
const fmtLaptopBtn      = document.getElementById("fmt-laptop");
const fmtMobileBtn      = document.getElementById("fmt-mobile");
const coinBalanceMain   = document.getElementById("coin-balance-main");
const coinBalanceChip   = document.getElementById("coin-balance");
const coinChip          = document.getElementById("coin-chip");
const coinBarFill       = document.getElementById("coin-bar-fill");
const coinWarning       = document.getElementById("coin-warning");
const drainInfo         = document.getElementById("drain-info");
const drainModeLabel    = document.getElementById("drain-mode-label");
const buyCoinsBtn       = document.getElementById("buy-coins-btn");

// ── STATE ─────────────────────────────────────────────────────
let realtimeClient  = null;
let localStream     = null;
let referenceFile   = null;
let isConnected     = false;
let settingsApplied = false;
let outputTab       = null;
let selectedFormat  = window.__forcedFormat || "laptop";
let decartApiKey    = null;
let currentEmail    = null;
let coinBalance     = 0;
let coinMaxBalance  = 0;
let drainRate       = 1.0;

// ── BROADCAST CHANNEL ─────────────────────────────────────────
const channel = new BroadcastChannel("lucy_stream");

// ── TOAST ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 4500, green = false) {
  toast.textContent = msg;
  toast.className = green ? 'show green' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.className = '', duration);
}

// ── STATUS BADGE ──────────────────────────────────────────────
function setStatus(label, mode = "") {
  statusText.textContent = label;
  statusBadge.className = "";
  if (mode) statusBadge.classList.add(mode);
}

// ── COIN DISPLAY ──────────────────────────────────────────────
function updateCoinDisplay(balance) {
  coinBalance = balance;
  const display = Math.floor(balance).toLocaleString();
  if (coinBalanceMain) coinBalanceMain.textContent = display;
  if (coinBalanceChip) coinBalanceChip.textContent = display;

  if (coinMaxBalance > 0) {
    const pct = Math.min(100, (balance / coinMaxBalance) * 100);
    coinBarFill.style.width = pct + '%';
    coinBarFill.className = 'coin-bar-fill' + (pct < 20 ? ' low' : pct < 50 ? ' mid' : '');
    if (coinChip) coinChip.className = 'coin-chip' + (pct < 20 ? ' low' : '');
  }

  if (coinWarning) coinWarning.style.display = balance < 200 ? 'flex' : 'none';
}

async function loadCoins(email) {
  try {
    const res  = await fetch('/api/coins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'balance', email })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (coinMaxBalance === 0) coinMaxBalance = Math.max(data.balance, 5000);
    drainRate = data.rates?.video ?? 1.0;
    if (drainInfo) drainInfo.textContent = `Video: ${drainRate} coin/sec`;
    if (drainModeLabel) drainModeLabel.textContent = 'VIDEO';
    updateCoinDisplay(data.balance);
  } catch (_) {}
}

let lastBilledSeconds = 0;

async function drainCoins(seconds = 1) {
  if (!currentEmail) return;
  try {
    const res = await fetch('/api/coins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drain', email: currentEmail, mode: 'video', seconds })
    });
    if (res.status === 402) {
      showToast("⚠ You've run out of coins. Please top up to continue.");
      stopStream();
      return;
    }
    if (res.ok) {
      const data = await res.json();
      updateCoinDisplay(data.balance);
    }
  } catch (_) {}
}

// ── INIT (called after auth confirms user) ────────────────────
window.addEventListener('marv:logged-in', async (e) => {
  currentEmail = e.detail.email;
  await loadCoins(currentEmail);

  // Fetch Decart API key from backend
  try {
    const res  = await fetch('/api/get-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail })
    });
    const data = await res.json();
    if (data.key) {
      decartApiKey = data.key;
    } else {
      showToast('⚠ Could not load API key: ' + (data.error || 'Unknown error. Check Vercel env vars.'), 6000);
    }
  } catch (err) {
    showToast('⚠ API key fetch failed: ' + err.message, 6000);
  }

  // Start heartbeat
  startHeartbeat(currentEmail);
});

// ── HEARTBEAT ─────────────────────────────────────────────────
let heartbeatInterval = null;
function startHeartbeat(email) {
  clearInterval(heartbeatInterval);
  const ping = () => {
    fetch('/api/usercheck', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'heartbeat', email })
    }).catch(() => {});
  };
  ping();
  heartbeatInterval = setInterval(ping, 25000);
}

// ── FORMAT BUTTONS ────────────────────────────────────────────
fmtLaptopBtn.addEventListener("click", () => {
  selectedFormat = "laptop";
  fmtLaptopBtn.classList.add("active"); fmtMobileBtn.classList.remove("active");
});
fmtMobileBtn.addEventListener("click", () => {
  selectedFormat = "mobile";
  fmtMobileBtn.classList.add("active"); fmtLaptopBtn.classList.remove("active");
});

// ── PRESETS ───────────────────────────────────────────────────
presetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    presetBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    promptInput.value = btn.dataset.prompt;
  });
});

// ── IMAGE UPLOAD ──────────────────────────────────────────────
uploadZone.addEventListener("dragover",  e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", ()  => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault(); uploadZone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
});
imageUpload.addEventListener("change", () => { if (imageUpload.files[0]) handleImageFile(imageUpload.files[0]); });

function handleImageFile(file) {
  if (!file.type.startsWith("image/")) { showToast("⚠ Invalid file type. Please upload an image."); return; }
  if (file.size > 10 * 1024 * 1024)   { showToast("⚠ Image is too large. Max 10MB."); return; }
  compressImage(file, 1024).then(compressed => {
    referenceFile = compressed;
    imagePreview.src = URL.createObjectURL(compressed);
    imagePreviewWrap.style.display = "block";
    uploadZone.style.display = "none";
    settingsApplied = false;
  });
}

function compressImage(file, maxSize = 1024) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > h && w > maxSize) { h = (h * maxSize) / w; w = maxSize; }
      else if (h > maxSize)     { w = (w * maxSize) / h; h = maxSize; }
      canvas.width = Math.round(w); canvas.height = Math.round(h);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), "image/jpeg", 0.95);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

removeImageBtn.addEventListener("click", () => {
  referenceFile = null; imagePreview.src = "";
  imagePreviewWrap.style.display = "none"; uploadZone.style.display = "block";
  imageUpload.value = ""; settingsApplied = false;
});

// ── APPLY SETTINGS ────────────────────────────────────────────
applyBtn.addEventListener("click", async () => {
  if (!realtimeClient) return;
  applyBtn.textContent = "⟳ Applying…"; applyBtn.disabled = true;
  settingsApplied = false;
  try {
    await applySettings();
    applyBtn.textContent = "✓ Applied!";
    setTimeout(() => { applyBtn.textContent = "⟳ Apply Settings"; applyBtn.disabled = false; }, 1800);
  } catch (err) {
    showToast("⚠ Failed to apply settings: " + (err.message || err));
    applyBtn.textContent = "⟳ Apply Settings"; applyBtn.disabled = false;
  }
});

async function applySettings() {
  const prompt = promptInput.value.trim(), enhance = enhanceToggle.checked;
  const payload = { enhance };
  if (prompt) payload.prompt = prompt;
  if (referenceFile && !settingsApplied) {
    payload.image = referenceFile;
    if (!prompt) payload.prompt = "Transform my face and body to look exactly like the person in the reference image. Keep all objects, phones, cups and items I hold completely unchanged and clearly visible. Only transform my face, skin, hair and body to match the reference person. Do not blur or remove any objects in the scene.";
  }
  await realtimeClient.set(payload);
  settingsApplied = true;
}

function openOutputTab() {
  outputTab = window.open("output.html?format=" + selectedFormat, "lucy_output");
  return outputTab;
}

// ── BUY COINS MODAL ───────────────────────────────────────────
if (buyCoinsBtn) buyCoinsBtn.addEventListener("click", () => document.getElementById("buy-coins-modal").classList.add("open"));
if (coinChip)    coinChip.addEventListener("click",    () => document.getElementById("buy-coins-modal").classList.add("open"));

document.getElementById("close-buy-modal").addEventListener("click", () => document.getElementById("buy-coins-modal").classList.remove("open"));
document.getElementById("buy-coins-modal").addEventListener("click", e => { if (e.target === document.getElementById("buy-coins-modal")) document.getElementById("buy-coins-modal").classList.remove("open"); });

// Package selection
let selectedPkg = null;
async function loadPackages() {
  const grid = document.getElementById("packages-grid");
  try {
    const res  = await fetch('/api/coins', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'get_packages' }) });
    const data = await res.json();
    const pkgs = data.packages || [];
    if (!pkgs.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-family:\'Space Mono\',monospace;font-size:0.7rem;padding:20px">No packages available yet. Contact admin.</div>'; return; }
    grid.innerHTML = pkgs.map(p => `
      <div class="pkg-card" data-id="${p.id}">
        ${p.popular ? '<div class="pkg-badge">Popular</div>' : ''}
        <div class="pkg-label">Coins Package</div>
        <div class="pkg-coins">${Number(p.coins).toLocaleString()}</div>
        <div class="pkg-label" style="margin-top:4px;margin-bottom:6px">coins</div>
        <div class="pkg-naira">₦${Number(p.priceNaira || 0).toLocaleString()}</div>
        <div class="pkg-usd">≈ $${p.priceUsd}</div>
      </div>
    `).join('');
    grid.querySelectorAll('.pkg-card').forEach(card => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.pkg-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPkg = pkgs.find(p => p.id === card.dataset.id);
        document.getElementById('pay-section').style.display = 'block';
        loadWallets();
        showPayArea(activeNet);
      });
    });
  } catch (_) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-family:\'Space Mono\',monospace;font-size:0.7rem;padding:20px">Failed to load packages.</div>';
  }
}

let wallets = {};
async function loadWallets() {
  try {
    const res  = await fetch('/api/crypto-payment', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'get_wallets' }) });
    const data = await res.json();
    wallets = data.wallets || {};
  } catch (_) {}
}

let activeNet = 'trc20';
let bankDetails = null;

function showPayArea(net) {
  const cryptoArea = document.getElementById('crypto-pay-area');
  const bankArea   = document.getElementById('bank-pay-area');
  if (net === 'bank') {
    cryptoArea.style.display = 'none';
    bankArea.style.display   = 'block';
    loadBankDetails();
    updateBankDisplay();
  } else {
    cryptoArea.style.display = 'block';
    bankArea.style.display   = 'none';
    updateWalletDisplay();
  }
}

function updateWalletDisplay() {
  if (!selectedPkg) return;
  const addr = wallets[activeNet] || null;
  if (!addr) {
    document.getElementById('wallet-addr').textContent   = 'Not available at the moment. Please try another payment method.';
    document.getElementById('wallet-amount').textContent = '';
    document.getElementById('copy-addr-btn').style.display = 'none';
  } else {
    document.getElementById('wallet-addr').textContent   = addr;
    document.getElementById('wallet-amount').textContent = activeNet === 'btc'
      ? `≈ $${selectedPkg.priceUsd} USD in BTC`
      : `${selectedPkg.priceUsd} USDT/USDC`;
    document.getElementById('copy-addr-btn').style.display = '';
  }
}

async function loadBankDetails() {
  if (bankDetails !== null) return;
  try {
    const res  = await fetch('/api/admin', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'get_bank_public' }) });
    const data = await res.json();
    bankDetails = data.bank || false;
  } catch (_) { bankDetails = false; }
  updateBankDisplay();
}

function updateBankDisplay() {
  const box = document.getElementById('bank-details-content');
  const amt = document.getElementById('bank-amount');
  if (!selectedPkg) return;
  if (!bankDetails) {
    box.textContent = 'Not available at the moment. Please try another payment method.';
    amt.textContent = '';
    document.getElementById('bank-submit-btn').disabled = true;
    return;
  }
  document.getElementById('bank-submit-btn').disabled = false;
  box.innerHTML = `
    <div><span style="color:var(--muted);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase">Bank</span><br><strong>${bankDetails.bankName}</strong></div>
    <div style="margin-top:8px"><span style="color:var(--muted);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase">Account Number</span><br><strong style="font-size:1.1rem;letter-spacing:0.1em">${bankDetails.accountNumber}</strong></div>
    <div style="margin-top:8px"><span style="color:var(--muted);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase">Account Name</span><br><strong>${bankDetails.accountName}</strong></div>
  `;
  amt.textContent = `Transfer ₦${Number(selectedPkg.priceNaira).toLocaleString()} (${selectedPkg.label} package)`;
}

document.querySelectorAll('.net-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.net-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeNet = tab.dataset.net;
    showPayArea(activeNet);
  });
});

document.getElementById('copy-addr-btn').addEventListener('click', () => {
  const addr = wallets[activeNet];
  if (!addr || addr === '—') return;
  navigator.clipboard.writeText(addr).then(() => showToast('✓ Address copied to clipboard', 2500, true));
});

document.getElementById('verify-btn').addEventListener('click', async () => {
  if (!selectedPkg || !currentEmail) return;
  const txHash = document.getElementById('tx-hash-input').value.trim();
  if (!txHash) { showToast('⚠ Please paste your transaction hash.'); return; }
  const btn = document.getElementById('verify-btn');
  btn.textContent = 'Verifying…'; btn.disabled = true;
  try {
    const res  = await fetch('/api/crypto-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action:'verify', txHash, network: activeNet, email: currentEmail, packageId: selectedPkg.id })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✓ Payment verified! +${Number(selectedPkg.coins).toLocaleString()} coins added.`, 5000, true);
      document.getElementById('buy-coins-modal').classList.remove('open');
      await loadCoins(currentEmail);
    } else {
      showToast('⚠ ' + (data.error || 'Verification failed.'));
    }
  } catch (_) {
    showToast('⚠ Connection error. Please try again.');
  }
  btn.textContent = 'Verify Payment'; btn.disabled = false;
});

document.getElementById('bank-submit-btn').addEventListener('click', async () => {
  if (!selectedPkg || !currentEmail) return;
  const ref = document.getElementById('bank-ref-input').value.trim();
  const btn = document.getElementById('bank-submit-btn');
  btn.textContent = 'Submitting…'; btn.disabled = true;
  try {
    const res  = await fetch('/api/coins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action:'bank_request', email: currentEmail, packageId: selectedPkg.id, amountNaira: selectedPkg.priceNaira, note: ref })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✓ Transfer request submitted! An admin will verify and credit your coins.', 6000, true);
      document.getElementById('buy-coins-modal').classList.remove('open');
      document.getElementById('bank-ref-input').value = '';
    } else {
      showToast('⚠ ' + (data.error || 'Failed to submit request.'));
    }
  } catch (_) {
    showToast('⚠ Connection error. Please try again.');
  }
  btn.textContent = 'Submit Transfer Request'; btn.disabled = false;
});

// Load packages when modal opens
const buyModal = document.getElementById('buy-coins-modal');
const observer = new MutationObserver(() => { if (buyModal.classList.contains('open')) { loadPackages(); } });
observer.observe(buyModal, { attributes: true, attributeFilter: ['class'] });

// ── START ─────────────────────────────────────────────────────
startBtn.addEventListener("click", startStream);
stopBtn.addEventListener("click",  () => stopStream());

async function startStream() {
  if (!decartApiKey) {
    showToast("⚠ API key not loaded. Please refresh and try again.");
    return;
  }
  if (coinBalance <= 0) {
    showToast("⚠ You have no coins. Please top up to start streaming.");
    document.getElementById("buy-coins-modal").classList.add("open");
    return;
  }

  startBtn.disabled = true;
  setStatus("STARTING…", "connecting");
  settingsApplied = false;
  openOutputTab();

  try {
    const model = models.realtime("lucy-2.1");

    localStream = await navigator.mediaDevices.getUserMedia({
      video: { frameRate: { ideal: 30, min: 24 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, facingMode: "user" },
      audio: false,
    }).catch(err => {
      if (err.name === "NotAllowedError"  || err.name === "PermissionDeniedError") throw new Error("Camera access denied. Please allow camera permissions and try again.");
      if (err.name === "NotFoundError") throw new Error("No camera found. Please connect a webcam and try again.");
      throw err;
    });

    inputVideo.srcObject = localStream;
    inputPlaceholder.style.display = "none";
    inputVideo.style.display = "block";
    setStatus("CONNECTING…", "connecting");

    const client  = createDecartClient({ apiKey: decartApiKey });
    realtimeClient = await client.realtime.connect(localStream, {
      model,
      onRemoteStream: (transformedStream) => {
        outputVideo.srcObject = transformedStream;
        outputPlaceholder.style.display = "none";
        outputVideo.style.display = "block";
        window.lucyOutputStream = transformedStream;
        channel.postMessage({ type: "stream_ready" });
        try {
          if (outputTab && !outputTab.closed) {
            outputTab.lucyOutputStream = transformedStream;
            const outVideo = outputTab.document.getElementById("output-video");
            if (outVideo) {
              outVideo.srcObject = transformedStream;
              const waitingEl = outputTab.document.getElementById("waiting");
              const statusEl  = outputTab.document.getElementById("status-bar");
              if (waitingEl) waitingEl.style.display = "none";
              if (statusEl)  statusEl.style.display  = "flex";
            }
          }
        } catch (e) {}
      },
    });

    realtimeClient.on("connectionChange", (state) => {
      const s = (state || "").toLowerCase();
      if      (s === "connected" || s === "generating") setStatus("LIVE · " + s.toUpperCase(), "live");
      else if (s === "connecting" || s === "reconnecting") setStatus(s.toUpperCase() + "…", "connecting");
      else if (s === "disconnected") { setStatus("DISCONNECTED", ""); handleDisconnect(); }
      else setStatus(s.toUpperCase(), "");
    });

    realtimeClient.on("generationTick", async ({ seconds }) => {
      billingSecs.textContent = seconds;
      billingCounter.style.display = "block";
      const elapsed = Math.max(1, seconds - lastBilledSeconds);
      lastBilledSeconds = seconds;
      await drainCoins(elapsed);
    });

    realtimeClient.on("error", (err) => {
      const msg = err?.message || JSON.stringify(err) || "Unknown error";
      if (!msg.toLowerCase().includes("image send timed out")) showToast("⚠ Stream error: " + msg);
    });

    await new Promise(r => setTimeout(r, 1000));
    if (promptInput.value.trim() || referenceFile) {
      await applySettings();
    } else {
      await realtimeClient.set({ prompt: "Transform my face and body realistically with enhanced lighting and clarity. Keep all objects, items and background clearly visible and unchanged.", enhance: enhanceToggle.checked });
      settingsApplied = true;
    }

    isConnected = true;
    stopBtn.disabled  = false;
    applyBtn.disabled = false;
    setStatus("LIVE", "live");

  } catch (err) {
    showToast("⚠ " + (err.message || "Failed to start stream."));
    setStatus("ERROR", "error");
    startBtn.disabled = false;
    stopStream(true);
  }
}

// ── STOP ──────────────────────────────────────────────────────
async function stopStream(silent = false) {
  if (realtimeClient) {
    try { await realtimeClient.disconnect?.(); } catch (_) {}
    try { realtimeClient.close?.(); }           catch (_) {}
    realtimeClient = null;
  }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

  channel.postMessage({ type: "stream_stopped" });
  window.lucyOutputStream = null;

  try { if (outputTab && !outputTab.closed) { outputTab.close(); outputTab = null; } } catch (_) {}

  inputVideo.srcObject = outputVideo.srcObject = null;
  inputVideo.style.display = outputVideo.style.display = "none";
  inputPlaceholder.style.display = outputPlaceholder.style.display = "";
  billingCounter.style.display = "none";
  isConnected = settingsApplied = false;
  lastBilledSeconds = 0;
  startBtn.disabled = false; stopBtn.disabled = true; applyBtn.disabled = true;
  setStatus("IDLE", "");
  if (!silent) showToast("✓ Stream stopped.");

  // Refresh coin balance
  if (currentEmail) await loadCoins(currentEmail);
}

function handleDisconnect() {
  if (isConnected) { isConnected = false; stopStream(true); showToast("⚠ Stream disconnected. Click Start to reconnect."); }
}

// ── KEYBOARD SHORTCUT ─────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ((e.key === "q" || e.key === "Q") && isConnected) stopStream();
});

// ── INITIAL STATE ─────────────────────────────────────────────
inputVideo.style.display = outputVideo.style.display = "none";
stopBtn.disabled = applyBtn.disabled = true;
