#!/usr/bin/env node
'use strict';

/**
 * publish_beatstone_studio.js — renders the Beatstone Studio read view onto
 * `empibeats.com/studio`.
 *
 * The Studio at empibeats.com/studio is a READ VIEW onto Beatstone (Beatstone
 * spec section 9): it presents the canon corpus, never owns the pipeline.
 * Heartie owns ingestion, Falkner owns storage, Essentia owns measurement.
 *
 * Input: an `empi_beatstone_studio_panel_v1` packet, emitted by the
 * empi-house Beatstone summary reader
 * (`server/tools/beatstone_falkner_summary_reader.js --studio-panel`). The
 * packet is metadata-only — no audio, no Founder valence, no MusicBrainz
 * resolution, no triangulation. This publisher renders it into a Hugo page
 * and a static HTML page, preserving every boundary as an explicit non-claim.
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function yamlFrontmatter(obj) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && (value.includes(':') || value.includes('"') || value.includes('\n'))) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function shortFingerprint(value) {
  const str = String(value || '');
  return str.length > 24 ? `${str.slice(0, 24)}…` : str;
}

function entryLine(entry) {
  const sfv = entry.structural_sfv_summary || {};
  const stems = (sfv.creative_character_stems || []).join('/') || '—';
  const dims = (sfv.evaluation_dimension_keys || []).length;
  return `- \`${shortFingerprint(entry.chromaprint_fingerprint)}\` `
    + `(${entry.beatstone_slice || 'measure_and_discard_core'}) — `
    + `fingerprint ${entry.fingerprint_status || '—'}, measurement ${entry.measurement_status || '—'}, `
    + `discard ${entry.discard_status || '—'}; stems ${stems}; ${dims} measured dims`;
}

function buildBeatstoneStudioMarkdown(panel) {
  const entries = Array.isArray(panel.entries) ? panel.entries : [];
  const summary = panel.summary || {};
  const body = [
    '## What This Is',
    '',
    'A read view onto **Beatstone**, the Founder-curated canon reference corpus for EMPI Beats.',
    'Beatstone moves EMPI\'s signature from relative-to-self to relative-to-canon. The Studio',
    'presents the corpus; it does not own the pipeline.',
    '',
    `Status: \`${panel.status || 'beatstone_studio_panel_empty'}\` — ${summary.entry_count || 0} canon entries `
      + `(${summary.invalid_frame_count || 0} invalid frames, ${summary.invalid_summary_count || 0} invalid summaries).`,
    '',
    '## Canon Entries (metadata only)',
    '',
    entries.length ? entries.map(entryLine).join('\n') : '- No canon entries ingested yet.',
    '',
    '## Ownership',
    '',
    '- Ingestion owner: **Heartie**',
    '- Storage owner: **Falkner**',
    '- Measurement owner: **Essentia**',
    '- This surface: **read view only**',
    '',
    '## Boundaries',
    '',
    '- Audio operation: false',
    '- Audio rendered: false',
    '- Audio inspected: false',
    '- Mutates Beatstone: false',
    '- Founder valence captured: false',
    '- MusicBrainz resolution: false',
    '- Triangulation: false',
  ].join('\n');

  const fm = {
    title: 'Beatstone — Canon Reference Corpus',
    description: 'Read view onto the Founder-curated Beatstone canon corpus for EMPI Beats.',
    date: new Date().toISOString(),
    beatstone_studio: true,
    studio_read_view_only: true,
    audio_rendered: false,
    audio_inspected: false,
    mutates_beatstone: false,
    founder_valence_capture: false,
    musicbrainz_resolution: false,
    triangulation: false,
    hide_from_home: true,
    noindex: true,
  };
  return `${yamlFrontmatter(fm)}\n\n${body}\n`;
}

function buildBeatstoneStudioHtml(panel) {
  const entries = Array.isArray(panel.entries) ? panel.entries : [];
  const summary = panel.summary || {};
  const rows = entries.map((entry) => {
    const sfv = entry.structural_sfv_summary || {};
    const stems = escapeHtml((sfv.creative_character_stems || []).join(', ') || '—');
    return `<tr>
      <td><code>${escapeHtml(shortFingerprint(entry.chromaprint_fingerprint))}</code></td>
      <td>${escapeHtml(entry.beatstone_slice || 'measure_and_discard_core')}</td>
      <td>${escapeHtml(entry.fingerprint_status || '—')}</td>
      <td>${escapeHtml(entry.measurement_status || '—')}</td>
      <td>${escapeHtml(entry.discard_status || '—')}</td>
      <td>${stems}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Beatstone — Canon Reference Corpus</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="container">
    <article class="single session-detail container">
      <header>
        <h1>Beatstone — Canon Reference Corpus</h1>
        <div class="session-meta">
          <span class="badge badge-stage">Read view only</span>
          <span class="badge badge-stage">No audio</span>
          <span class="badge badge-stage">Metadata only</span>
        </div>
      </header>
      <p class="link-journal"><a href="/studio/">Back to studio</a></p>
      <p>Status: <strong>${escapeHtml(panel.status || 'beatstone_studio_panel_empty')}</strong> —
        ${escapeHtml(summary.entry_count || 0)} canon entries.</p>
      <section class="studio-terminal" aria-label="Beatstone canon entries">
        <div class="studio-terminal-head"><span>Canon Entries</span><span>${entries.length} entries</span></div>
        <table>
          <thead><tr><th>Fingerprint</th><th>Slice</th><th>Fingerprint</th><th>Measurement</th><th>Discard</th><th>Stems</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No canon entries ingested yet.</td></tr>'}</tbody>
        </table>
      </section>
      <section aria-label="Ownership and boundaries">
        <p><strong>Ownership:</strong> Heartie ingestion · Falkner storage · Essentia measurement · Studio read view only.</p>
        <p><strong>Boundaries:</strong> no audio operation, no Founder valence capture, no MusicBrainz resolution, no triangulation, no Beatstone mutation.</p>
      </section>
    </article>
  </main>
</body>
</html>`;
}

// The summary reader's --studio-panel emits a wrapper
// `{ ok, status, panel: {...}, validation, source_status }`; accept either the
// wrapped form or a bare panel packet.
function unwrapPanel(raw) {
  if (raw && raw.schema === 'empi_beatstone_studio_panel_v1') return raw;
  if (raw && raw.panel && raw.panel.schema === 'empi_beatstone_studio_panel_v1') return raw.panel;
  return raw;
}

function publishBeatstoneStudio(panelPath, contentRoot, distRoot) {
  const panel = unwrapPanel(readJson(panelPath));
  if (!panel || panel.schema !== 'empi_beatstone_studio_panel_v1') {
    throw new Error(`expected empi_beatstone_studio_panel_v1, got ${panel && panel.schema}`);
  }
  const studioContentDir = path.join(contentRoot, 'studio');
  const studioDistDir = path.join(distRoot, 'studio', 'beatstone');
  ensureDir(studioContentDir);
  ensureDir(studioDistDir);
  const contentPath = path.join(studioContentDir, 'beatstone.md');
  const distPath = path.join(studioDistDir, 'index.html');
  fs.writeFileSync(contentPath, buildBeatstoneStudioMarkdown(panel), 'utf8');
  fs.writeFileSync(distPath, buildBeatstoneStudioHtml(panel), 'utf8');
  return {
    schema: 'empi_beatstone_studio_publish_result_v1',
    surface: 'empibeats.com/studio',
    panel_id: panel.panel_id || null,
    entry_count: (panel.summary && panel.summary.entry_count) || 0,
    content_path: contentPath,
    dist_path: distPath,
    url_path: '/studio/beatstone/',
    audio_rendered: false,
    audio_inspected: false,
    mutates_beatstone: false,
    founder_valence_capture: false,
    musicbrainz_resolution: false,
    triangulation: false,
  };
}

function main() {
  const panelPath = process.argv[2];
  const contentRoot = process.argv[3] || path.join(__dirname, '..', 'content');
  const distRoot = process.argv[4] || path.join(__dirname, '..', 'public');
  if (!panelPath) {
    console.error('Usage: node tools/publish_beatstone_studio.js <studio_panel_json> [content_root] [dist_root]');
    process.exit(2);
  }
  const result = publishBeatstoneStudio(panelPath, contentRoot, distRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  unwrapPanel,
  buildBeatstoneStudioMarkdown,
  buildBeatstoneStudioHtml,
  publishBeatstoneStudio,
};
