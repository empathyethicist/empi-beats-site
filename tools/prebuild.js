#!/usr/bin/env node
/**
 * prebuild.js — Transform VPS evidence JSON into Hugo-compatible markdown.
 *
 * Usage: node tools/prebuild.js [evidence_path]
 * Default path: /opt/empi/evidence
 *
 * Reads practice_log.json, session meta/interactions, reflections, MAP frames,
 * and best_render_archive.json to generate Hugo content pages with YAML frontmatter.
 */

const fs = require('fs');
const path = require('path');

const evidencePath = process.argv[2] || '/opt/empi/evidence';
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

// ---------------------------------------------------------------------------
// 1. Sessions from practice_log.json
// ---------------------------------------------------------------------------

function generateSessions() {
  const logPath = path.join(evidencePath, 'practice_log.json');
  const log = readJSON(logPath);
  if (!log || !Array.isArray(log)) {
    console.log('No practice_log.json found at', logPath);
    return;
  }

  const outDir = path.join(contentDir, 'sessions');
  ensureDir(outDir);

  for (const entry of log) {
    const id = entry.session_id || entry.id;
    if (!id) continue;

    // Try to enrich from session directory
    const sessionDir = path.join(evidencePath, 'sessions', id);
    const meta = readJSON(path.join(sessionDir, 'meta.json')) || {};
    const interactions = readJSONL(path.join(sessionDir, 'interactions.jsonl'));

    // Extract journal entries from interactions
    const journal = interactions
      .filter(i => i.type === 'journal' || i.type === 'thought' || i.role === 'empi')
      .map(i => i.content || i.text || '')
      .filter(Boolean)
      .join('\n\n');

    // Build fingerprint string if available
    let fingerprint = '';
    if (entry.fingerprint || meta.fingerprint) {
      const fp = entry.fingerprint || meta.fingerprint;
      if (typeof fp === 'object') {
        fingerprint = [
          fp.pocket, fp.frequency_clarity || fp.freq_clarity,
          fp.density_balance || fp.density_bal,
          fp.timing_intention || fp.timing_int,
          fp.energy_arc, fp.timbral_coherence || fp.timbral_coh
        ].join(',');
      }
    }

    // Audio path
    let audio = '';
    const audioFile = entry.audio_file || meta.audio_file;
    if (audioFile) {
      audio = '/audio/' + path.basename(audioFile);
    }

    const fm = {
      title: entry.title || meta.title || `Session ${id}`,
      date: entry.timestamp || meta.timestamp || entry.date || new Date().toISOString(),
      genre: entry.genre || meta.genre || '',
      duration: entry.duration || meta.duration || '',
      intent: (entry.intent_stack || meta.intent_stack || [])[2] || entry.intent || meta.intent || '',
      rationale: entry.rationale || meta.rationale || '',
      curriculum_stage: entry.curriculum_stage || meta.curriculum_stage || '',
      render_status: entry.render_status || meta.render_status || 'pending',
      hasRadar: fingerprint ? true : false,
      session_id: id,
    };

    if (fingerprint) fm.fingerprint = fingerprint;
    if (audio) fm.audio = audio;
    if (meta.map_state_date) fm.map_state_date = meta.map_state_date;

    const body = journal || entry.journal || meta.journal || '';
    const content = yamlFrontmatter(fm) + '\n\n' + body + '\n';
    fs.writeFileSync(path.join(outDir, slugify(id) + '.md'), content);
  }

  console.log(`Generated ${log.length} session pages`);
}

// ---------------------------------------------------------------------------
// 2. Reflections
// ---------------------------------------------------------------------------

function generateReflections() {
  const refDir = path.join(evidencePath, 'reflections');
  if (!fs.existsSync(refDir)) {
    console.log('No reflections directory at', refDir);
    return;
  }

  const outDir = path.join(contentDir, 'reflections');
  ensureDir(outDir);

  let count = 0;
  const files = fs.readdirSync(refDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));

  for (const file of files) {
    const data = file.endsWith('.jsonl')
      ? readJSONL(path.join(refDir, file))
      : [readJSON(path.join(refDir, file))].filter(Boolean);

    for (const ref of data) {
      const id = ref.session_id || ref.id || path.basename(file, path.extname(file));
      const fm = {
        title: ref.title || `Reflection — ${id}`,
        date: ref.timestamp || ref.date || new Date().toISOString(),
        quality_score: ref.quality_score || ref.score || '',
      };

      if (ref.contradictions && ref.contradictions.length) {
        fm.contradictions = ref.contradictions;
      }
      if (ref.practice_request) {
        fm.practice_request = ref.practice_request;
      }

      const body = ref.prose || ref.content || ref.text || '';
      const content = yamlFrontmatter(fm) + '\n\n' + body + '\n';
      fs.writeFileSync(path.join(outDir, slugify(id) + '.md'), content);
      count++;
    }
  }

  console.log(`Generated ${count} reflection pages`);
}

// ---------------------------------------------------------------------------
// 3. MAP-States from maph_frames
// ---------------------------------------------------------------------------

function generateMapStates() {
  const framesDir = path.join(evidencePath, 'maph_frames');
  if (!fs.existsSync(framesDir)) {
    console.log('No maph_frames directory at', framesDir);
    return;
  }

  const outDir = path.join(contentDir, 'map-states');
  ensureDir(outDir);

  let count = 0;
  const files = fs.readdirSync(framesDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const dateStr = path.basename(file, '.jsonl');
    const frames = readJSONL(path.join(framesDir, file));
    if (!frames.length) continue;

    // Normalize frame data for swimlane
    const normalized = frames.map(f => ({
      ts: f.timestamp || f.ts || '',
      state: f.state || f.map_state || 'transition',
      label: f.label || f.description || ''
    }));

    const fm = {
      title: `MAP-States — ${dateStr}`,
      date: frames[0].timestamp || frames[0].ts || dateStr,
      frame_count: frames.length,
      hasSwimlane: true,
      frames_json: JSON.stringify(normalized),
    };

    const content = yamlFrontmatter(fm) + '\n\nCognitive state timeline for this session.\n';
    fs.writeFileSync(path.join(outDir, slugify(dateStr) + '.md'), content);
    count++;
  }

  console.log(`Generated ${count} MAP-state pages`);
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
    console.log('No music tracks found');
    return;
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
    fs.writeFileSync(path.join(outDir, slugify(id) + '.md'), content);
    count++;
  }

  console.log(`Generated ${count} music pages`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('EMPI Beats prebuild — evidence path:', evidencePath);
console.log('Output:', contentDir);
console.log('---');

generateSessions();
generateReflections();
generateMapStates();
generateMusic();

console.log('---');
console.log('Done. Run `hugo --minify` to build.');
