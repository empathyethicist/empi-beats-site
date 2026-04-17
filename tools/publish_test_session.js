#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const sessionId = process.argv[2];
const evidencePath = process.argv[3] || '/opt/empi/evidence';
const distDir = process.argv[4] || '/opt/empi/empi-beats-site-dist';
const contentDir = path.join(__dirname, '..', 'content');
const testsContentDir = path.join(contentDir, 'tests');
const testsDistDir = path.join(distDir, 'tests');
const testsAudioDir = path.join(distDir, 'audio', 'tests');
const staticAudioDir = path.join(__dirname, '..', 'static', 'audio', 'tests');

if (!sessionId) {
  console.error('Usage: node tools/publish_test_session.js <session_id> [evidence_path] [dist_dir]');
  process.exit(2);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readJSONL(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function yamlFrontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach((item) => lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`));
    } else if (typeof v === 'object') {
      lines.push(`${k}: '${JSON.stringify(v).replace(/'/g, "''")}'`);
    } else if (typeof v === 'string' && (v.includes(':') || v.includes('"') || v.includes('\n'))) {
      lines.push(`${k}: "${v.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function getPracticeComposition(meta) {
  return (meta && meta.studio_composition)
    || (meta && meta.composition_phase_result && meta.composition_phase_result.composition)
    || null;
}

function isQaProbe(meta) {
  const composition = getPracticeComposition(meta);
  return !!(composition && composition.motivation === 'qa_probe');
}

function collectTestComponentIds(meta) {
  const ids = new Set();
  const request = meta && meta.realization_request;
  const spec = request && request.realization_spec;
  const componentIds = spec && Array.isArray(spec.component_ids) ? spec.component_ids : [];
  componentIds.forEach((id) => {
    if (id) ids.add(String(id));
  });
  return Array.from(ids);
}

function buildHumanTestLabel(meta, fallbackId) {
  const composition = getPracticeComposition(meta);
  const raw = (composition && composition.creative_direction) || meta.creative_direction || meta.title || fallbackId;
  let cleaned = String(raw || '')
    .replace(/^compose\s+(a\s+)?deterministic\s+/i, '')
    .replace(/^compose\s+/i, '')
    .replace(/\.\s*keep it nrt-safe.*$/i, '')
    .replace(/\.\s*with no .*$/i, '')
    .replace(/\.\s*no buffer playback.*$/i, '')
    .replace(/\.\s*fully nrt-safe.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/, '');
  if (!cleaned) cleaned = fallbackId;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function getWavMeanDb(wavPath) {
  try {
    const result = spawnSync('ffmpeg', [
      '-i', wavPath,
      '-af', 'volumedetect',
      '-f', 'null',
      '-',
    ], { timeout: 30000, encoding: 'utf8' });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    return meanMatch ? parseFloat(meanMatch[1]) : -Infinity;
  } catch (_) {
    return -Infinity;
  }
}

function pickCanonicalWav(sessionDir) {
  const candidates = [];
  let root = [];
  try { root = fs.readdirSync(sessionDir); } catch (_) {}
  for (const f of root) {
    if (f.endsWith('.wav')) candidates.push(path.join(sessionDir, f));
  }
  const normalizedDir = path.join(sessionDir, 'normalized');
  if (fs.existsSync(normalizedDir)) {
    let normalized = [];
    try { normalized = fs.readdirSync(normalizedDir); } catch (_) {}
    for (const f of normalized) {
      if (f.endsWith('.wav')) candidates.push(path.join(normalizedDir, f));
    }
  }
  if (candidates.length === 0) return null;
  let bestPath = null;
  let bestDb = -Infinity;
  for (const candidate of candidates) {
    const db = getWavMeanDb(candidate);
    if (db > bestDb) {
      bestDb = db;
      bestPath = candidate;
    }
  }
  if (bestDb < -70) return null;
  return bestPath;
}

function convertWavToMp3(wavPath, mp3Path) {
  ensureDir(path.dirname(mp3Path));
  if (fs.existsSync(mp3Path)) return true;
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      mp3Path,
    ], { timeout: 30000 });
    return true;
  } catch (e) {
    console.error('ffmpeg failed:', e.message);
    return false;
  }
}

function buildTestBody(meta, componentIds, label, journal) {
  const composition = getPracticeComposition(meta);
  const bodyParts = [
    '## What This Test Is',
    '',
    label,
  ];
  if (composition && composition.creative_direction) {
    bodyParts.push('', '## Full Prompt', '', composition.creative_direction);
  }
  if (componentIds.length > 0) {
    bodyParts.push('', '## Selected Components', '', componentIds.map((id) => `- ${id}`).join('\n'));
  }
  if (journal) {
    bodyParts.push('', '## Session Notes', '', journal);
  }
  return bodyParts.join('\n');
}

function buildTestPageHtml({ meta, label, audioPath, componentIds, journal, sessionSlug }) {
  const composition = getPracticeComposition(meta);
  const creativeDirection = (composition && composition.creative_direction) || '';
  const date = new Date(meta.started || meta.completed || Date.now()).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const componentItems = componentIds.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join('');
  const notesHtml = journal
    ? journal.split('\n\n').map((block) => `<p>${escapeHtml(block)}</p>`).join('\n')
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>QA Test — ${escapeHtml(label)}</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="container">
    <article class="single session-detail container">
      <header>
        <h1>${escapeHtml(label)}</h1>
        <div class="session-meta">
          <span class="badge badge-stage">QA Listening Test</span>
          ${composition && composition.genre ? `<span class="badge genre-${escapeHtml(composition.genre)}">${escapeHtml(composition.genre)}</span>` : ''}
          ${composition && composition.template_id ? `<span class="badge badge-stage">Template: ${escapeHtml(composition.template_id)}</span>` : ''}
          <time>${escapeHtml(date)}</time>
        </div>
      </header>
      <p class="link-journal"><a href="/tests/">← Back to all listening tests</a></p>
      <section class="audio-section">
        <h2>Audio</h2>
        <div class="audio-player">
          <span class="audio-title">${escapeHtml(label)}</span>
          <audio controls preload="metadata">
            <source src="${escapeHtml(audioPath)}" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
        </div>
      </section>
      ${creativeDirection ? `<section class="intent-block"><h2>Prompt</h2><blockquote class="intent">${escapeHtml(creativeDirection)}</blockquote></section>` : ''}
      ${componentIds.length ? `<section class="intent-block"><h2>Selected Components</h2><ul>${componentItems}</ul></section>` : ''}
      ${notesHtml ? `<section class="journal-section"><h2>Test Notes</h2><div class="content journal-body">${notesHtml}</div></section>` : ''}
      <p class="link-journal"><a href="/audio/tests/${escapeHtml(path.basename(audioPath))}">Open MP3 directly</a></p>
      <p class="link-journal"><small>Session: ${escapeHtml(sessionSlug)}</small></p>
    </article>
  </main>
</body>
</html>`;
}

function buildTestsIndexHtml(entries) {
  const cards = entries.map((entry) => {
    const direction = entry.creative_direction ? `<blockquote class="intent">${escapeHtml(entry.creative_direction)}</blockquote>` : '';
    return `<article class="card session-practice">
  <div class="card-header">
    <h2><a href="/tests/${entry.slug}/">${escapeHtml(entry.label)}</a></h2>
    <div class="card-meta">
      ${entry.genre ? `<span class="badge genre-${escapeHtml(entry.genre)}">${escapeHtml(entry.genre)}</span>` : ''}
      ${entry.template ? `<span class="badge badge-stage">Template: ${escapeHtml(entry.template)}</span>` : ''}
      <time>${escapeHtml(entry.date)}</time>
    </div>
  </div>
  ${direction}
  <p class="link-journal"><a href="/tests/${entry.slug}/">Open test page</a></p>
</article>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>EMPI Listening Tests</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <main class="container">
    <section class="section container">
      <h1>EMPI Listening Tests</h1>
      <div class="content">
        <p>Hidden QA listening pages for render verification.</p>
      </div>
      ${cards || '<p>No QA listening tests yet.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function writeFastTestPage(sessionMeta) {
  const sessionSlug = slugify(sessionMeta.session_id);
  const pageDir = path.join(testsDistDir, sessionSlug);
  ensureDir(pageDir);
  const composition = getPracticeComposition(sessionMeta);
  const componentIds = collectTestComponentIds(sessionMeta);
  const label = buildHumanTestLabel(sessionMeta, sessionMeta.session_id);
  const interactions = readJSONL(path.join(evidencePath, 'sessions', sessionMeta.session_id, 'interactions.jsonl'));
  const journal = interactions
    .map((i) => i.prose || i.full_response || '')
    .filter(Boolean)
    .join('\n\n');
  const audioRel = `/audio/tests/${sessionMeta.session_id.toLowerCase()}.mp3`;
  const html = buildTestPageHtml({
    meta: sessionMeta,
    label,
    audioPath: audioRel,
    componentIds,
    journal,
    sessionSlug,
  });
  fs.writeFileSync(path.join(pageDir, 'index.html'), html, 'utf8');

  ensureDir(testsContentDir);
  const body = buildTestBody(sessionMeta, componentIds, label, journal);
  const fm = {
    title: `QA Test — ${label}`,
    description: 'Hidden QA listening page for EMPI render probe verification.',
    date: sessionMeta.started || sessionMeta.completed || new Date().toISOString(),
    session_id: sessionMeta.session_id,
    genre: (composition && composition.genre) || sessionMeta.genre || sessionMeta.domain || '',
    audio: audioRel,
    render_status: 'success',
    test_label: label,
    creative_direction: (composition && composition.creative_direction) || null,
    composition_template: (composition && composition.template_id) || null,
    test_components: componentIds,
    hide_from_home: true,
    noindex: true,
  };
  fs.writeFileSync(path.join(testsContentDir, `${sessionSlug}.md`), `${yamlFrontmatter(fm)}\n\n${body}\n`, 'utf8');

  return {
    slug: sessionSlug,
    label,
    genre: (composition && composition.genre) || sessionMeta.genre || '',
    template: (composition && composition.template_id) || null,
    creative_direction: (composition && composition.creative_direction) || '',
    date: new Date(sessionMeta.started || sessionMeta.completed || Date.now()).toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

function gatherAllQaEntries() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  let dirs = [];
  try {
    dirs = fs.readdirSync(sessionsDir).filter((d) => d.startsWith('P'));
  } catch (_) {
    return [];
  }
  const entries = [];
  for (const dir of dirs) {
    const meta = readJSON(path.join(sessionsDir, dir, 'meta.json'));
    if (!meta || !isQaProbe(meta) || meta.render_ok !== true) continue;
    const composition = getPracticeComposition(meta);
    entries.push({
      slug: slugify(meta.session_id || dir),
      label: buildHumanTestLabel(meta, meta.session_id || dir),
      genre: (composition && composition.genre) || meta.genre || '',
      template: (composition && composition.template_id) || null,
      creative_direction: (composition && composition.creative_direction) || '',
      date: new Date(meta.started || meta.completed || Date.now()).toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      started_at: meta.started || meta.completed || '',
    });
  }
  entries.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  return entries;
}

function main() {
  const sessionPath = path.join(evidencePath, 'sessions', sessionId);
  const meta = readJSON(path.join(sessionPath, 'meta.json'));
  if (!meta) {
    console.error(`Missing meta.json for ${sessionId}`);
    process.exit(1);
  }
  if (!isQaProbe(meta)) {
    console.error(`${sessionId} is not a qa_probe session`);
    process.exit(1);
  }
  if (meta.render_ok !== true) {
    console.error(`${sessionId} did not render successfully`);
    process.exit(1);
  }
  const wavPath = pickCanonicalWav(sessionPath);
  if (!wavPath) {
    console.error(`No canonical WAV found for ${sessionId}`);
    process.exit(1);
  }

  ensureDir(testsAudioDir);
  ensureDir(staticAudioDir);
  const mp3Name = `${sessionId.toLowerCase()}.mp3`;
  const distMp3Path = path.join(testsAudioDir, mp3Name);
  const staticMp3Path = path.join(staticAudioDir, mp3Name);
  if (!convertWavToMp3(wavPath, distMp3Path)) process.exit(1);
  if (!fs.existsSync(staticMp3Path)) {
    fs.copyFileSync(distMp3Path, staticMp3Path);
  }

  writeFastTestPage(meta);

  const entries = gatherAllQaEntries();
  ensureDir(testsDistDir);
  fs.writeFileSync(path.join(testsDistDir, 'index.html'), buildTestsIndexHtml(entries), 'utf8');

  console.log(`Published QA test page: /tests/${slugify(sessionId)}/`);
}

main();
