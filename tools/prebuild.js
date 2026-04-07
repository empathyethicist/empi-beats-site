#!/usr/bin/env node
/**
 * prebuild.js — Transform VPS evidence JSON into Hugo-compatible markdown.
 *
 * Usage: node tools/prebuild.js [--dry-run] [evidence_path]
 * Default path: /opt/empi/evidence
 *
 * Scans sessions/meta.json, reflections (.json+.png pairs), MAP frames
 * (nested empi-primary/<uuid>/frames.jsonl), and best_render_archive/highlights
 * to generate Hugo content pages with YAML frontmatter.
 */

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const evidencePath = process.argv.filter(a => !a.startsWith('--'))[2] || '/opt/empi/evidence';
const contentDir = path.join(__dirname, '..', 'content');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function readJSONL(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function yamlFrontmatter(obj) {
  let lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach(item => lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`));
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

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function writeFile(filepath, content) {
  if (dryRun) {
    console.log('[DRY RUN] Would write:', path.basename(filepath));
    return;
  }
  fs.writeFileSync(filepath, content);
}

function copyFile(src, dest) {
  if (dryRun) {
    console.log('[DRY RUN] Would copy:', path.basename(src), '→', path.basename(dest));
    return;
  }
  fs.copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// 1. Sessions — scan sessions/*/meta.json directly
// ---------------------------------------------------------------------------

function generateSessions() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    console.log('  No sessions directory at', sessionsDir);
    return 0;
  }

  const outDir = path.join(contentDir, 'sessions');
  ensureDir(outDir);

  let count = 0;
  const dirs = fs.readdirSync(sessionsDir).filter(d => {
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const sessionPath = path.join(sessionsDir, dir);
    const meta = readJSON(path.join(sessionPath, 'meta.json'));
    if (!meta) continue;

    // Detect session type by schema
    const hasInteractions = fs.existsSync(path.join(sessionPath, 'interactions.jsonl'));
    const hasSummary = fs.existsSync(path.join(sessionPath, 'summary.md'));
    const hasReflectionMd = fs.existsSync(path.join(sessionPath, 'reflection.md'));
    const hasReflectionJson = fs.existsSync(path.join(sessionPath, 'reflection.json'));
    const isWrittenReflection = dir.startsWith('R') && hasReflectionMd;
    const isCreativeStudio = hasSummary && hasReflectionJson && !hasInteractions;

    // Route written reflections to generateReflections() — skip here
    if (isWrittenReflection) continue;

    // ── Creative Studio session (UUID-named) ──────────────────────────────
    if (isCreativeStudio) {
      const refl = readJSON(path.join(sessionPath, 'reflection.json')) || {};
      const fiveThings = refl.five_things || {};
      const scores = Object.values(fiveThings);
      const allZero = scores.length > 0 && scores.every(v => v === 0 || v === null || v === undefined);
      const hasOutput = (refl.cycles_reflected || 0) > 0 && !allZero;

      // Filter out learning sessions (no output, all-zero scores)
      if (!hasOutput) continue;

      // Synthetic title from date + type
      const startTime = meta.start_time || meta.started || refl.generated_at;
      const dateStr = startTime
        ? new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'Unknown Date';
      const sessionType = (meta.type || 'session').replace(/_/g, ' ');
      const syntheticTitle = `Creative Session — ${dateStr}, ${sessionType}`;

      // Body from reflection + summary
      const mapStatesFrame = (refl.map_states_frame || '').replace(/<[^>]+>/g, '').trim();
      const rationale = refl.five_things_rationale || '';
      let summaryMd = '';
      try { summaryMd = fs.readFileSync(path.join(sessionPath, 'summary.md'), 'utf8'); } catch (_) {}

      const bodyParts = [];
      if (mapStatesFrame) bodyParts.push('## Reflection\n\n' + mapStatesFrame);
      if (rationale) bodyParts.push('## Five Things\n\n' + rationale);
      if (summaryMd) bodyParts.push('## Summary\n\n' + summaryMd);
      const body = bodyParts.join('\n\n');

      const fm = {
        title: syntheticTitle,
        date: startTime || new Date().toISOString(),
        type: meta.type || '',
        cycles: meta.cycles_completed || 0,
        duration_ms: meta.duration_ms || 0,
        session_id: meta.session_id || dir,
        session_class: 'creative',
      };

      writeFile(path.join(outDir, slugify(dir) + '.md'), yamlFrontmatter(fm) + '\n\n' + body + '\n');
      count++;
      continue;
    }

    // ── NRT Practice session (P*-named) ───────────────────────────────────
    const id = meta.session_id || dir;
    const decision = meta.decision || {};

    // Extract journal/prose from interactions
    const interactions = readJSONL(path.join(sessionPath, 'interactions.jsonl'));
    const journal = interactions
      .map(i => i.prose || i.full_response || '')
      .filter(Boolean)
      .join('\n\n');

    // Build fingerprint string if available
    let fingerprint = '';
    const fp = meta.fingerprint_scores || meta.fingerprint;
    if (fp && typeof fp === 'object') {
      fingerprint = [
        fp.pocket, fp.frequency_clarity || fp.freq_clarity,
        fp.density_balance || fp.density_bal,
        fp.timing_intention || fp.timing_int,
        fp.energy_arc, fp.timbral_coherence || fp.timbral_coh
      ].filter(v => v !== undefined).join(',');
    }

    // Audio path
    let audio = '';
    if (meta.wav_filename) {
      audio = '/audio/' + path.basename(meta.wav_filename);
    } else if (meta.audio_file) {
      audio = '/audio/' + path.basename(meta.audio_file);
    }

    const fm = {
      title: meta.title || `Session ${id}`,
      date: meta.started || meta.timestamp || new Date().toISOString(),
      type: meta.type || '',
      domain: meta.domain || '',
      genre: meta.genre || meta.domain || '',
      duration: decision.duration || meta.duration || '',
      intent: decision.intent || '',
      rationale: decision.rationale || '',
      session_id: id,
      session_class: 'practice',
    };

    // Only set render_status when known — let template skip the badge otherwise
    if (meta.render_ok === true) fm.render_status = 'success';
    else if (meta.render_ok === false) fm.render_status = 'failed';

    if (fingerprint) { fm.fingerprint = fingerprint; fm.hasRadar = true; }
    if (audio) fm.audio = audio;
    if (meta.completed) fm.completed = meta.completed;
    if (meta.intent_stack) fm.intent_stack = meta.intent_stack;

    writeFile(path.join(outDir, slugify(id) + '.md'), yamlFrontmatter(fm) + '\n\n' + (journal || '') + '\n');
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// 2. Reflections — written reflections from sessions/R*/reflection.md
// ---------------------------------------------------------------------------

function generateReflections() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;

  const outDir = path.join(contentDir, 'reflections');
  ensureDir(outDir);

  let count = 0;
  const dirs = fs.readdirSync(sessionsDir).filter(d => {
    if (!d.startsWith('R')) return false;
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const sessionPath = path.join(sessionsDir, dir);
    const meta = readJSON(path.join(sessionPath, 'meta.json'));
    const reflectionMdPath = path.join(sessionPath, 'reflection.md');
    if (!meta || !fs.existsSync(reflectionMdPath)) continue;

    let body = '';
    try { body = fs.readFileSync(reflectionMdPath, 'utf8'); } catch (_) {}

    const fm = {
      title: meta.title || `Reflection ${dir}`,
      date: meta.started || meta.created || meta.completed || new Date().toISOString(),
      quality_score: meta.quality_score || '',
      quality_level: meta.quality_level || '',
      session_id: dir,
    };

    if (meta.has_interests_update) fm.has_interests_update = meta.has_interests_update;
    if (meta.has_practice_request) fm.has_practice_request = meta.has_practice_request;

    writeFile(path.join(outDir, slugify(dir) + '.md'), yamlFrontmatter(fm) + '\n\n' + body + '\n');
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// 2b. Sketches — p5.js visual drawings from legacy reflections dir
// ---------------------------------------------------------------------------

function generateSketches() {
  const sketchesDir = path.join(evidencePath, 'reflections');
  if (!fs.existsSync(sketchesDir)) return 0;

  const outDir = path.join(contentDir, 'sketches');
  ensureDir(outDir);

  const imgDir = path.join(__dirname, '..', 'static', 'img', 'sketches');
  ensureDir(imgDir);

  let count = 0;
  const files = fs.readdirSync(sketchesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const data = readJSON(path.join(sketchesDir, file));
    if (!data) continue;

    const id = data.session_id || path.basename(file, '.json');

    // Strip legacy "Garden Reflection" prefix — it's not canon
    const origTitle = (data.title || '').trim();
    const cleanTitle = origTitle
      .replace(/^Garden Reflection\s*/i, '')
      .replace(/^Reflection\s+/i, '')
      .trim() || id;

    const fm = {
      title: `Sketch ${cleanTitle}`,
      date: data.created || data.timestamp || new Date().toISOString(),
      session_id: id,
    };

    if (data.intent_stack) fm.intent_stack = data.intent_stack;
    if (data.reflection_data_summary) fm.data_summary = data.reflection_data_summary;

    // Copy PNG to site static/img/sketches/
    const pngName = path.basename(file, '.json') + '.png';
    const pngPath = path.join(sketchesDir, pngName);
    if (fs.existsSync(pngPath)) {
      copyFile(pngPath, path.join(imgDir, pngName));
      fm.image = '/img/sketches/' + pngName;
    }

    writeFile(path.join(outDir, slugify(id) + '.md'), yamlFrontmatter(fm) + '\n');
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// 3. MAP-States — nested maph_frames/<agent>/<uuid>/frames.jsonl
// ---------------------------------------------------------------------------

function generateMapStates() {
  const framesDir = path.join(evidencePath, 'maph_frames');
  if (!fs.existsSync(framesDir)) {
    console.log('  No maph_frames directory at', framesDir);
    return 0;
  }

  const outDir = path.join(contentDir, 'map-states');
  ensureDir(outDir);

  let count = 0;

  // Walk agent directories (empi-primary, producer-primary, bouncer-front-door, etc.)
  const agentDirs = fs.readdirSync(framesDir).filter(d => {
    try { return fs.statSync(path.join(framesDir, d)).isDirectory(); } catch { return false; }
  });

  for (const agentDir of agentDirs) {
    const agentPath = path.join(framesDir, agentDir);

    // Handle direct .jsonl files at agent level
    const directFiles = fs.readdirSync(agentPath).filter(f => f.endsWith('.jsonl'));
    for (const file of directFiles) {
      const frames = readJSONL(path.join(agentPath, file));
      if (!frames.length) continue;

      const dateStr = path.basename(file, '.jsonl');
      const normalized = frames.map(f => ({
        ts: f.timestamp || f.ts || '',
        state: f.state || f.map_state || 'transition',
        label: f.label || f.description || ''
      }));

      const fm = {
        title: `MAP-States — ${agentDir} — ${dateStr}`,
        date: frames[0].timestamp || frames[0].ts || dateStr,
        agent: agentDir,
        frame_count: frames.length,
        hasSwimlane: true,
        frames_json: JSON.stringify(normalized),
      };

      const slug = slugify(`${agentDir}-${dateStr}`);
      const content = yamlFrontmatter(fm) + '\n\nCognitive state timeline for this session.\n';
      writeFile(path.join(outDir, slug + '.md'), content);
      count++;
    }

    // Walk UUID subdirs
    const uuidDirs = fs.readdirSync(agentPath).filter(d => {
      try { return fs.statSync(path.join(agentPath, d)).isDirectory(); } catch { return false; }
    });

    for (const uuidDir of uuidDirs) {
      const framesPath = path.join(agentPath, uuidDir, 'frames.jsonl');
      if (!fs.existsSync(framesPath)) continue;

      const frames = readJSONL(framesPath);
      if (!frames.length) continue;

      // Extract date from first frame timestamp or use UUID
      const firstTs = frames[0].timestamp || frames[0].ts || '';
      const dateLabel = firstTs ? firstTs.split('T')[0] : uuidDir.slice(0, 8);

      const normalized = frames.map(f => ({
        ts: f.timestamp || f.ts || '',
        state: f.state || f.map_state || 'transition',
        label: f.label || f.description || ''
      }));

      const fm = {
        title: `MAP-States — ${agentDir} — ${dateLabel}`,
        date: firstTs || new Date().toISOString(),
        agent: agentDir,
        session_uuid: uuidDir,
        frame_count: frames.length,
        hasSwimlane: true,
        frames_json: JSON.stringify(normalized),
      };

      const slug = slugify(`${agentDir}-${uuidDir}`);
      const content = yamlFrontmatter(fm) + '\n\nCognitive state timeline for this session.\n';
      writeFile(path.join(outDir, slug + '.md'), content);
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// 4. Music from best_render_archive.json + highlights
// ---------------------------------------------------------------------------

function generateMusic() {
  const archivePath = path.join(evidencePath, 'best_render_archive.json');
  const highlightsDir = path.join(evidencePath, 'highlights');
  const archive = readJSON(archivePath) || [];

  // Also scan highlights dir for individual track JSON
  let tracks = Array.isArray(archive) ? [...archive] : [];
  if (fs.existsSync(highlightsDir)) {
    const hFiles = fs.readdirSync(highlightsDir).filter(f => f.endsWith('.json'));
    for (const f of hFiles) {
      const t = readJSON(path.join(highlightsDir, f));
      if (t) tracks.push(t);
    }
  }

  if (!tracks.length) {
    return 0;
  }

  const outDir = path.join(contentDir, 'music');
  ensureDir(outDir);

  // Deduplicate by session_id
  const seen = new Set();
  let count = 0;

  for (const track of tracks) {
    // Quality gate: only publish best renders (spec: quality >= 0.65)
    if (typeof track.aggregate_quality === 'number' && track.aggregate_quality < 0.65) continue;
    const id = track.session_id || track.id || track.descriptor || `track-${count}`;
    if (seen.has(id)) continue;
    seen.add(id);

    let audio = '';
    if (track.audio_file) audio = '/audio/' + path.basename(track.audio_file);

    let fingerprint = '';
    if (track.fingerprint && typeof track.fingerprint === 'object') {
      const fp = track.fingerprint;
      fingerprint = [
        fp.pocket, fp.frequency_clarity || fp.freq_clarity,
        fp.density_balance || fp.density_bal,
        fp.timing_intention || fp.timing_int,
        fp.energy_arc, fp.timbral_coherence || fp.timbral_coh
      ].join(',');
    }

    const fm = {
      title: track.title || track.descriptor || `Track ${id}`,
      date: track.timestamp || track.date || new Date().toISOString(),
      genre: track.genre || '',
      quality_score: track.quality_score || track.score || '',
    };

    if (audio) fm.audio = audio;
    if (fingerprint) fm.fingerprint = fingerprint;

    const body = track.description || track.notes || '';
    const content = yamlFrontmatter(fm) + '\n\n' + body + '\n';
    writeFile(path.join(outDir, slugify(id) + '.md'), content);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('EMPI Beats prebuild');
if (dryRun) console.log('  Mode: DRY RUN (no files will be written)');
console.log('  Evidence:', evidencePath);
console.log('  Output:', contentDir);
console.log('');

const sessionCount = generateSessions();
const reflectionCount = generateReflections();
const sketchCount = generateSketches();
const mapStateCount = generateMapStates();
const musicCount = generateMusic();

console.log('');
console.log(`Summary: ${sessionCount} sessions, ${reflectionCount} reflections, ${sketchCount} sketches, ${mapStateCount} MAP-states, ${musicCount} music`);
