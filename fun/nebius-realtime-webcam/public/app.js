const $ = (id) => document.getElementById(id);

const video = $('video');
const canvas = $('canvas');
const badge = $('badge');
const responseEl = $('response');
const thinkingEl = $('thinking');
const statsEl = $('stats');
const toggleBtn = $('toggle');
const modelName = $('modelName');
const headerStatus = $('headerStatus');
const modelNote = $('modelNote');
const logEl = $('log');
const logEmpty = $('logEmpty');
const captureSpec = $('captureSpec');

const counters = { frames: 0, tokens: 0, errors: 0 };
const ttfts = []; // every first-token time this session, for the median readout

/** The meters saturate here; past this the loop stopped feeling realtime anyway. */
const METER_CEILING_MS = 2500;

let stream = null;
let running = false;
let inFlight = null; // AbortController for the request currently open
let lastEntry = null; // { text, count, li } so a repeated answer doesn't spam the log

function setBadge(state, label) {
  badge.className = `badge ${state}`;
  badge.textContent = label;
  headerStatus.className = `header-status ${state}`;
  headerStatus.textContent = label;
}

function setResponse(text, isError = false) {
  responseEl.textContent = text;
  responseEl.classList.toggle('error', isError);
  responseEl.classList.remove('muted');
}

function setThinking(text) {
  thinkingEl.textContent = text;
  thinkingEl.hidden = !text;
}

function setMeter(barId, valueId, ms) {
  const bar = $(barId);
  const value = $(valueId);
  if (ms == null) {
    bar.style.setProperty('--bar-scale', '0');
    value.textContent = '–';
    return;
  }
  bar.style.setProperty('--bar-scale', String(Math.min(1, ms / METER_CEILING_MS).toFixed(3)));
  value.textContent = `${ms} ms`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function bumpCounters() {
  $('frameCount').textContent = counters.frames;
  $('tokenCount').textContent = counters.tokens;
  $('errorCount').textContent = counters.errors;
  const mid = median(ttfts);
  $('medianTtft').textContent = mid == null ? '–' : `${mid}`;
}

/** Keep the plate header honest about what is actually being uploaded. */
function updateCaptureSpec() {
  captureSpec.textContent = `${$('frameWidth').value} px · q ${$('quality').value}`;
}

/**
 * On a loop the model often repeats itself verbatim. Collapsing runs into a
 * "xN" badge keeps the history readable instead of fifty identical rows.
 */
function addLogEntry(text, latencyMs, isError) {
  logEmpty.hidden = true;

  if (!isError && lastEntry && lastEntry.text === text) {
    lastEntry.count += 1;
    lastEntry.li.querySelector('.repeat').textContent = `×${lastEntry.count}`;
    lastEntry.li.querySelector('.ms').textContent = latencyMs == null ? '' : `${latencyMs} ms`;
    return;
  }

  const li = document.createElement('li');
  if (isError) li.classList.add('error');
  li.innerHTML =
    '<time></time><span class="text"></span><span class="repeat"></span><span class="ms"></span>';
  li.querySelector('time').textContent = new Date().toLocaleTimeString([], { hour12: false });
  li.querySelector('.text').textContent = text;
  li.querySelector('.ms').textContent = latencyMs == null ? '' : `${latencyMs} ms`;
  logEl.prepend(li);
  while (logEl.children.length > 50) logEl.lastElementChild.remove();

  lastEntry = isError ? null : { text, count: 1, li };
}

async function initCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: 16 / 9 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    toggleBtn.disabled = false;
    setResponse('Camera ready. Press start.');
  } catch (err) {
    setBadge('error', 'no camera');
    setResponse(
      `Could not access the camera: ${err.name} — ${err.message}\n` +
        'The page must be served over localhost or HTTPS, and permission must be granted.',
      true,
    );
  }
}

async function loadModel() {
  try {
    const res = await fetch('/api/model');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);

    modelName.textContent = data.model;

    if (!data.exists) {
      showNote(`“${data.model}” isn’t in your account’s model list. Set NEBIUS_MODEL in .env to one that is.`);
    } else if (!data.isVision) {
      showNote(`“${data.model}” exists but isn’t listed as accepting image input, so webcam frames may be rejected.`);
    }
  } catch (err) {
    modelName.textContent = 'unknown';
    showNote(`Could not confirm the model: ${err.message}`);
  }
}

function showNote(text) {
  modelNote.textContent = text;
  modelNote.hidden = false;
}

/** Draw the current video frame to the canvas, scaled down, as a JPEG data URL. */
function captureFrame() {
  if (!video.videoWidth) return null;

  const targetWidth = Number($('frameWidth').value);
  const scale = Math.min(1, targetWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', Number($('quality').value));
}

/** Yield each `data:` payload from an SSE response body as it arrives. */
async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload);
        } catch {
          /* ignore a malformed frame rather than killing the loop */
        }
      }
    }
  }
}

async function analyzeOnce() {
  const image = captureFrame();
  if (!image) return;

  inFlight = new AbortController();
  let text = '';
  let thoughts = '';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: inFlight.signal,
      body: JSON.stringify({
        image,
        prompt: $('prompt').value,
        maxTokens: Number($('maxTokens').value),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    }

    responseEl.classList.add('streaming');
    responseEl.classList.remove('error', 'muted');
    responseEl.textContent = '';
    statsEl.textContent = 'streaming';
    setThinking('');

    for await (const event of sseEvents(res)) {
      if (event.error) throw new Error(event.error.message);

      if (event.reasoning) {
        // Only surfaces for models that insist on thinking; keeps the panel
        // alive instead of showing a frozen empty box.
        thoughts = (thoughts + event.reasoning).slice(-400);
        setThinking(thoughts);
      }

      if (event.delta) {
        text += event.delta;
        responseEl.textContent = text;
        setThinking('');
      }

      if (event.done) {
        const truncated = event.finishReason === 'length';
        const total = event.usage?.total_tokens ?? null;

        counters.frames += 1;
        counters.tokens += total ?? 0;
        if (event.firstTokenMs != null) ttfts.push(event.firstTokenMs);

        const fallback = truncated ? '(cut off — raise max tokens)' : '(no text returned)';
        const display = text.trim() ? `${text.trim()}${truncated ? '…' : ''}` : fallback;

        responseEl.textContent = display;
        responseEl.classList.toggle('muted', !text.trim());
        statsEl.textContent = total != null ? `${total} tokens · ${event.finishReason}` : event.finishReason;

        setMeter('ttftBar', 'ttftValue', event.firstTokenMs);
        setMeter('totalBar', 'totalValue', event.latencyMs);

        addLogEntry(display, event.latencyMs, false);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // user pressed Stop mid-request
    counters.errors += 1;
    setResponse(err.message, true);
    setBadge('error', 'error');
    statsEl.textContent = 'failed';
    addLogEntry(err.message, null, true);
  } finally {
    responseEl.classList.remove('streaming');
    setThinking('');
    inFlight = null;
    bumpCounters();
  }
}

/**
 * One request at a time: wait for the response, then wait the interval.
 * A fixed setInterval would stack requests whenever the model is slower
 * than the tick, which is most of the time on a hosted endpoint.
 */
async function loop() {
  while (running) {
    await analyzeOnce();
    if (!running) break;
    if (badge.className.includes('error')) setBadge('live', 'live');
    const gap = Number($('interval').value);
    if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
  }
}

function start() {
  if (!stream) return;
  running = true;
  lastEntry = null;
  toggleBtn.textContent = 'Stop';
  toggleBtn.classList.add('running');
  setBadge('live', 'live');
  setResponse('Waiting for the first token…');
  loop();
}

function stop() {
  running = false;
  inFlight?.abort();
  toggleBtn.textContent = 'Start';
  toggleBtn.classList.remove('running');
  setBadge('idle', 'idle');
  statsEl.textContent = 'stopped';
  setThinking('');
}

toggleBtn.addEventListener('click', () => (running ? stop() : start()));

for (const button of document.querySelectorAll('.presets button')) {
  button.addEventListener('click', () => {
    $('prompt').value = button.dataset.prompt;
  });
}

for (const id of ['frameWidth', 'quality']) {
  $(id).addEventListener('change', updateCaptureSpec);
}

/* Theme. Remembered per browser, and harmless if storage is unavailable. */
const themeToggle = $('themeToggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'dark' ? 'D' : 'N';
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* private mode, blocked storage: the toggle still works for this session */
  }
}

themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

try {
  const saved = localStorage.getItem('theme');
  if (saved) applyTheme(saved);
  else if (matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
} catch {
  /* leave the default light theme in place */
}

/**
 * The plate holds the camera's 16:9, so its size is bound by the available
 * height. Size its grid column to match, otherwise the card stays as wide as
 * the page and the video floats in a field of empty grid.
 */
const stage = document.querySelector('.stage');
const figureBody = document.querySelector('.figure-body');
const app = document.querySelector('.app');
const stacked = matchMedia('(max-width: 860px), (max-height: 560px)');

function fitCameraColumn() {
  if (stacked.matches) {
    stage.style.removeProperty('--cam-col');
    document.documentElement.style.removeProperty('--app-w');
    return;
  }

  const style = getComputedStyle(figureBody);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const plateHeight = figureBody.clientHeight - padY;
  if (plateHeight <= 0) return;

  // +2 for the card's own left and right border.
  const column = `${Math.round((plateHeight * 16) / 9 + padX + 2)}px`;
  if (column === stage.style.getPropertyValue('--cam-col')) return; // settled

  const appStyle = getComputedStyle(app);
  const beside =
    parseFloat(appStyle.paddingLeft) +
    parseFloat(appStyle.paddingRight) +
    parseFloat(getComputedStyle(stage).columnGap) +
    stage.lastElementChild.getBoundingClientRect().width;

  stage.style.setProperty('--cam-col', column);
  document.documentElement.style.setProperty('--app-w', `${Math.round(parseFloat(column) + beside)}px`);
}

// Each write resizes the body, which re-fires this; the early return above ends
// the chain once the number stops moving, usually after two passes.
new ResizeObserver(fitCameraColumn).observe(figureBody);
stacked.addEventListener('change', fitCameraColumn);
addEventListener('resize', fitCameraColumn);

window.addEventListener('beforeunload', () => {
  running = false;
  inFlight?.abort();
  stream?.getTracks().forEach((track) => track.stop());
});

updateCaptureSpec();
bumpCounters();
loadModel();
initCamera();
