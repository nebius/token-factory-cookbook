#!/usr/bin/env node
/** Print every model your Nebius account can serve that accepts image input. */

const API_KEY = process.env.NEBIUS_API_KEY;
const BASE_URL = (process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, '');
const CONFIGURED = process.env.NEBIUS_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash';

if (!API_KEY) {
  console.error('NEBIUS_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const res = await fetch(`${BASE_URL}/models?verbose=true`, {
  headers: { authorization: `Bearer ${API_KEY}` },
});

if (!res.ok) {
  console.error(`Request failed: HTTP ${res.status} — ${await res.text()}`);
  process.exit(1);
}

const { data = [] } = await res.json();
const vision = data.filter((m) => (m.architecture?.modality ?? '').split('->')[0].includes('image'));

if (vision.length === 0) {
  console.log('No image-input models are available on this account.');
} else {
  console.log(`Vision models (${vision.length}):\n`);
  for (const m of vision.sort((a, b) => a.id.localeCompare(b.id))) {
    const inPrice = Number(m.pricing?.prompt ?? 0) * 1e6;
    const outPrice = Number(m.pricing?.completion ?? 0) * 1e6;
    console.log(`  ${m.id}`);
    console.log(`    modality ${m.architecture?.modality}  ·  context ${m.context_length ?? '?'}  ·  $${inPrice.toFixed(2)}/$${outPrice.toFixed(2)} per M tokens`);
  }
}

const configured = data.find((m) => m.id === CONFIGURED);
console.log('');
if (!configured) {
  console.log(`⚠ Configured model "${CONFIGURED}" is not in this account's catalog.`);
} else if (!vision.includes(configured)) {
  console.log(`⚠ Configured model "${CONFIGURED}" exists but its modality is "${configured.architecture?.modality}" — it may reject image input.`);
} else {
  console.log(`✓ Configured model "${CONFIGURED}" accepts image input.`);
}
