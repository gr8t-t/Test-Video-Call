// ──────────────────────────────────────────────────────────────
//  LUCY — Realtime AI Video Transform
//  Powered by Decart lucy_2_rt model
//
//  🔑  PASTE YOUR DECART API KEY into the "API Key" field in the UI
// ──────────────────────────────────────────────────────────────

import { createDecartClient, models } from "https://esm.sh/@decartai/sdk";

// ── DOM REFS ──────────────────────────────────────────────────
const inputVideo        = document.getElementById("input-video");
const outputVideo       = document.getElementById("output-video");
const inputPlaceholder  = document.getElementById("input-placeholder");
const outputPlaceholder = document.getElementById("output-placeholder");
const statusBadge       = document.getElementById("status-badge");
const statusText        = document.getElementById("status-text");
const apiKeyInput       = document.getElementById("api-key");
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

// ── STATE ─────────────────────────────────────────────────────
let realtimeClient  = null;
let localStream     = null;
let referenceFile   = null;
let isConnected     = false;
let settingsApplied = false;
let outputTab       = null;
// Use device-detected forced format if available, otherwise default to laptop
let selectedFormat  = window.__forcedFormat || "laptop";

// ── BROADCAST CHANNEL ─────────────────────────────────────────
const channel = new BroadcastChannel("lucy_stream");

// ── TOAST ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 4500) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ── STATUS BADGE ──────────────────────────────────────────────
function setStatus(label, mode = "") {
  statusText.textContent = label;
  statusBadge.className = "";
  if (mode) statusBadge.classList.add(mode);
}

// ── FORMAT BUTTONS ────────────────────────────────────────────
fmtLaptopBtn.addEventListener("click", () => {
  selectedFormat = "laptop";
  fmtLaptopBtn.classList.add("active");
  fmtMobileBtn.classList.remove("active");
});

fmtMobileBtn.addEventListener("click", () => {
  selectedFormat = "mobile";
  fmtMobileBtn.classList.add("active");
  fmtLaptopBtn.classList.remove("active");
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
uploadZone.addEventListener("dragover", e => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

imageUpload.addEventListener("change", () => {
  if (imageUpload.files[0]) handleImageFile(imageUpload.files[0]);
});

function handleImageFile(file) {
  if (!file.type.startsWith("image/")) {
    showToast("⚠ Invalid file type. Please upload an image (JPG, PNG, WEBP).");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("⚠ Image is too large. Please use an image under 10MB.");
    return;
  }
  compressImage(file, 1024).then(compressed => {
    referenceFile = compressed;
    const url = URL.createObjectURL(compressed);
    imagePreview.src = url;
    imagePreviewWrap.style.display = "block";
    uploadZone.style.display = "none";
    settingsApplied = false;
  });
}

// ── IMAGE COMPRESSOR ──────────────────────────────────────────
function compressImage(file, maxSize = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > h && w > maxSize) { h = (h * maxSize) / w; w = maxSize; }
      else if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; }
      canvas.width  = Math.round(w);
      canvas.height = Math.round(h);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), "image/jpeg", 0.95);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

removeImageBtn.addEventListener("click", () => {
  referenceFile = null;
  imagePreview.src = "";
  imagePreviewWrap.style.display = "none";
  uploadZone.style.display = "block";
  imageUpload.value = "";
  settingsApplied = false;
});

// ── APPLY SETTINGS ────────────────────────────────────────────
applyBtn.addEventListener("click", async () => {
  if (!realtimeClient) return;
  applyBtn.textContent = "⟳ Applying…";
  applyBtn.disabled = true;
  settingsApplied = false;
  try {
    await applySettings();
    applyBtn.textContent = "✓ Applied!";
    setTimeout(() => {
      applyBtn.textContent = "⟳ Apply Settings";
      applyBtn.disabled = false;
    }, 1800);
  } catch (err) {
    console.error(err);
    showToast("⚠ Failed to apply settings: " + (err.message || err));
    applyBtn.textContent = "⟳ Apply Settings";
    applyBtn.disabled = false;
  }
});

async function applySettings() {
  const prompt  = promptInput.value.trim();
  const enhance = enhanceToggle.checked;
  const payload = { enhance };

  if (prompt) payload.prompt = prompt;

  // Send image only once per session
  if (referenceFile && !settingsApplied) {
    payload.image = referenceFile;
    if (!prompt) {
      payload.prompt = "Transform my face and body to look exactly like the person in the reference image. Keep all objects, phones, cups and items I hold completely unchanged and clearly visible. Only transform my face, skin, hair and body to match the reference person. Do not blur or remove any objects in the scene.";
    }
  }

  await realtimeClient.set(payload);
  settingsApplied = true;
}

// ── OPEN OUTPUT TAB ───────────────────────────────────────────
function openOutputTab() {
  // Pass the selected format as a URL parameter to output.html
  const url = "output.html?format=" + selectedFormat;
  outputTab = window.open(url, "lucy_output");
  return outputTab;
}

// ── START ─────────────────────────────────────────────────────
startBtn.addEventListener("click", startStream);
stopBtn.addEventListener("click", stopStream);

async function startStream() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showToast("⚠ Please enter your Decart API key first.");
    apiKeyInput.focus();
    return;
  }

  startBtn.disabled = true;
  setStatus("STARTING…", "connecting");
  settingsApplied = false;

  // Open the output tab immediately — passes format via URL param
  openOutputTab();

  try {
    const model = models.realtime("lucy-2.1");

    // Maximum quality camera
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        frameRate: { ideal: 30, min: 24 },
        width:     { ideal: 1920, min: 1280 },
        height:    { ideal: 1080, min: 720 },
        facingMode: "user",
      },
      audio: false,
    }).catch(err => {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        throw new Error("Camera access denied. Please allow camera permissions and try again.");
      }
      if (err.name === "NotFoundError") {
        throw new Error("No camera found. Please connect a webcam and try again.");
      }
      throw err;
    });

    inputVideo.srcObject = localStream;
    inputPlaceholder.style.display = "none";
    inputVideo.style.display = "block";

    setStatus("CONNECTING…", "connecting");

    const client = createDecartClient({ apiKey });

    realtimeClient = await client.realtime.connect(localStream, {
      model,
      onRemoteStream: (transformedStream) => {
        // Keep a reference in main window
        outputVideo.srcObject = transformedStream;
        outputPlaceholder.style.display = "none";
        outputVideo.style.display = "block";

        // Store on window so output tab can access via window.opener
        window.lucyOutputStream = transformedStream;

        // Tell output tab stream is ready via BroadcastChannel
        channel.postMessage({ type: "stream_ready" });

        // Directly inject stream into output tab
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
        } catch (e) {
          console.warn("Direct tab injection failed, fallback via opener:", e);
        }
      },
    });

    // ── Events ──
    realtimeClient.on("connectionChange", (state) => {
      const s = (state || "").toLowerCase();
      if (s === "connected" || s === "generating") {
        setStatus("LIVE · " + s.toUpperCase(), "live");
      } else if (s === "connecting" || s === "reconnecting") {
        setStatus(s.toUpperCase() + "…", "connecting");
      } else if (s === "disconnected") {
        setStatus("DISCONNECTED", "");
        handleDisconnect();
      } else {
        setStatus(s.toUpperCase(), "");
      }
    });

    realtimeClient.on("generationTick", ({ seconds }) => {
      billingSecs.textContent = seconds;
      billingCounter.style.display = "block";
    });

    realtimeClient.on("error", (err) => {
      console.error("Decart error:", err);
      const msg = err?.message || JSON.stringify(err) || "Unknown error";
      if (!msg.toLowerCase().includes("image send timed out")) {
        showToast("⚠ Stream error: " + msg);
      }
      if (msg.toLowerCase().includes("api") || msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("key")) {
        showToast("⚠ Invalid API key or authentication error. Check your Decart API key.");
      }
    });

    // Wait for connection to fully stabilise before sending settings
    await new Promise(r => setTimeout(r, 1000));

    const prompt  = promptInput.value.trim();
    const enhance = enhanceToggle.checked;
    if (prompt || referenceFile) {
      await applySettings();
    } else {
      await realtimeClient.set({
        prompt: "Transform my face and body realistically with enhanced lighting and clarity. Keep all objects, items and background clearly visible and unchanged.",
        enhance,
      });
      settingsApplied = true;
    }

    isConnected = true;
    stopBtn.disabled  = false;
    applyBtn.disabled = false;
    setStatus("LIVE", "live");

  } catch (err) {
    console.error("Start error:", err);
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
    try { realtimeClient.close?.(); } catch (_) {}
    realtimeClient = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Notify output tab that stream stopped
  channel.postMessage({ type: "stream_stopped" });
  window.lucyOutputStream = null;

  // Close output tab
  try {
    if (outputTab && !outputTab.closed) {
      outputTab.close();
      outputTab = null;
    }
  } catch (e) {}

  inputVideo.srcObject  = null;
  outputVideo.srcObject = null;
  inputVideo.style.display  = "none";
  outputVideo.style.display = "none";
  inputPlaceholder.style.display  = "";
  outputPlaceholder.style.display = "";
  billingCounter.style.display = "none";
  isConnected     = false;
  settingsApplied = false;

  startBtn.disabled = false;
  stopBtn.disabled  = true;
  applyBtn.disabled = true;
  setStatus("IDLE", "");
  if (!silent) showToast("✓ Stream stopped. Billing ended.");
}

function handleDisconnect() {
  if (isConnected) {
    isConnected = false;
    stopStream(true);
    showToast("⚠ Stream disconnected unexpectedly. Click Start to reconnect.");
  }
}

// ── KEYBOARD SHORTCUT Q ───────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "q" || e.key === "Q") {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (isConnected) stopStream();
  }
});

// ── INITIAL UI STATE ──────────────────────────────────────────
inputVideo.style.display  = "none";
outputVideo.style.display = "none";
stopBtn.disabled  = true;
applyBtn.disabled = true;
