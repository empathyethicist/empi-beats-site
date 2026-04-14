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
// 1. Journal — Practice (P*) + Creative Studio (UUID) sessions
// ---------------------------------------------------------------------------

function generateJournal() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    console.log('  No sessions directory at', sessionsDir);
    return 0;
  }

  const outDir = path.join(contentDir, 'journal');
  ensureDir(outDir);

  let count = 0;
  const dirs = fs.readdirSync(sessionsDir).filter(d => {
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const sessionPath = path.join(sessionsDir, dir);
    const meta = readJSON(path.join(sessionPath, 'meta.json'));
    if (!meta) continue;

    // Route non-Journal content to their own generators
    if (dir.startsWith('R')) continue;  // Reflections
    if (dir.startsWith('D')) continue;  // Discovery

    // 2026-04-11 filter: skip Slack-driven ephemeral sessions. Slack
    // direction listener + dwell chat create transient /sessions/slack-*
    // directories for every Slack message (including channel description
    // events). These are NOT practice journal entries — they're chat
    // artifacts. Filter them out by the `slack-` basename prefix.
    // See docs/contracts/sentinel/proactive-communication.v1.md §#PC-4
    // (venue inbox is the surface for Slack-driven interactions, not the
    // public journal).
    if (dir.toLowerCase().startsWith('slack-') || dir.toLowerCase().startsWith('slack_')) continue;

    // Detect session type by schema
    const hasInteractions = fs.existsSync(path.join(sessionPath, 'interactions.jsonl'));
    const hasSummary = fs.existsSync(path.join(sessionPath, 'summary.md'));
    const hasReflectionJson = fs.existsSync(path.join(sessionPath, 'reflection.json'));
    const isCreativeStudio = hasSummary && hasReflectionJson && !hasInteractions;

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

    const isAttempt = meta.render_ok === false;

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
      type: isAttempt ? 'attempt' : (meta.type || ''),
      domain: meta.domain || '',
      genre: meta.genre || meta.domain || '',
      duration: decision.duration || meta.duration || '',
      intent: decision.intent || '',
      rationale: decision.rationale || '',
      session_id: id,
      session_class: 'practice',
      render_status: isAttempt ? 'failed' : 'success',
    };

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
// 1b. Discovery — listening sessions (D*)
// ---------------------------------------------------------------------------

function generateDiscovery() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;

  const outDir = path.join(contentDir, 'discovery');
  ensureDir(outDir);

  let count = 0;
  const dirs = fs.readdirSync(sessionsDir).filter(d => {
    if (!d.startsWith('D')) return false;
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const sessionPath = path.join(sessionsDir, dir);
    const meta = readJSON(path.join(sessionPath, 'meta.json'));
    if (!meta) continue;

    const interactions = readJSONL(path.join(sessionPath, 'interactions.jsonl'));

    // Extract listening insights from interactions (expanded field set)
    const notes = interactions
      .map(i => i.prose || i.full_response || i.content || i.opinion || i.insight || '')
      .filter(Boolean)
      .join('\n\n');

    // Additional content sources: listening_insights.json
    const listeningInsights = readJSON(path.join(sessionPath, 'listening_insights.json'));
    const trackEntries = [];
    let earSummary = '';

    if (listeningInsights) {
      // listening_insights.json may be an object or array
      const items = Array.isArray(listeningInsights) ? listeningInsights : [listeningInsights];
      for (const item of items) {
        if (item.ear_summary) earSummary = earSummary || item.ear_summary;
        if (item.track || item.title || item.artist) {
          const trackLabel = [item.artist, item.title || item.track].filter(Boolean).join(' — ');
          const opinion = item.opinion || item.insight || '';
          trackEntries.push(trackLabel + (opinion ? ': ' + opinion : ''));
        }
        // Handle nested tracks array
        if (Array.isArray(item.tracks)) {
          for (const t of item.tracks) {
            const tLabel = [t.artist, t.title || t.track].filter(Boolean).join(' — ');
            const tOpinion = t.opinion || t.insight || '';
            trackEntries.push(tLabel + (tOpinion ? ': ' + tOpinion : ''));
          }
        }
      }
    }

    // Additional content sources: individual listening/*.json files
    const listeningDir = path.join(sessionPath, 'listening');
    if (fs.existsSync(listeningDir)) {
      try {
        const listeningFiles = fs.readdirSync(listeningDir).filter(f => f.endsWith('.json'));
        for (const lf of listeningFiles) {
          const ld = readJSON(path.join(listeningDir, lf));
          if (!ld) continue;
          if (ld.ear_summary) earSummary = earSummary || ld.ear_summary;
          const lLabel = [ld.artist, ld.title || ld.track].filter(Boolean).join(' — ');
          const lOpinion = ld.opinion || ld.insight || '';
          if (lLabel) trackEntries.push(lLabel + (lOpinion ? ': ' + lOpinion : ''));
        }
      } catch (_) {}
    }

    // Also extract ear_summary from interactions
    if (!earSummary) {
      for (const i of interactions) {
        if (i.ear_summary) { earSummary = i.ear_summary; break; }
      }
    }

    // Build enriched body with sections
    const bodyParts = [];
    if (trackEntries.length > 0) {
      bodyParts.push('## Tracks Explored\n\n' + trackEntries.map(t => '- ' + t).join('\n'));
    }
    if (notes) {
      bodyParts.push(notes);
    }
    if (earSummary) {
      bodyParts.push('## Ear Summary\n\n' + earSummary);
    }
    const body = bodyParts.join('\n\n');

    const id = meta.session_id || dir;
    const title = meta.title || meta.seed_topic || `Discovery ${id}`;

    const fm = {
      title: title.startsWith('Discovery') ? title : `Discovery: ${title}`,
      date: meta.started || meta.timestamp || new Date().toISOString(),
      session_id: id,
      hops: meta.total_hops || meta.hops || '',
      tracks_listened: meta.tracks_listened || '',
      seed_topic: meta.seed_topic || '',
      termination: meta.termination_reason || meta.termination || '',
    };

    writeFile(path.join(outDir, slugify(id) + '.md'), yamlFrontmatter(fm) + '\n\n' + (body || '') + '\n');
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// 2. Reflections — written reflections (R*) + creative session reflections
// ---------------------------------------------------------------------------

function generateReflections() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;

  const outDir = path.join(contentDir, 'journal');
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
      type: 'reflection',
      quality_score: meta.quality_score || '',
      quality_level: meta.quality_level || '',
      session_id: dir,
      reflection_class: 'cross-session',
    };

    if (meta.has_interests_update) fm.has_interests_update = meta.has_interests_update;
    if (meta.has_practice_request) fm.has_practice_request = meta.has_practice_request;

    writeFile(path.join(outDir, slugify(dir) + '.md'), yamlFrontmatter(fm) + '\n\n' + body + '\n');
    count++;
  }

  // ── Creative studio session reflections (per-session, from reflection.json) ──
  const uuidDirs = fs.readdirSync(sessionsDir).filter(d => {
    if (d.startsWith('P') || d.startsWith('R') || d.startsWith('D')) return false;
    if (d.startsWith('L') || d.startsWith('C')) return false;
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of uuidDirs) {
    const sessionPath = path.join(sessionsDir, dir);
    const reflPath = path.join(sessionPath, 'reflection.json');
    if (!fs.existsSync(reflPath)) continue;

    const refl = readJSON(reflPath);
    if (!refl) continue;

    // Strip XML tags from map_states_frame to get clean prose
    const rawFrame = (refl.map_states_frame || '').trim();
    if (!rawFrame || rawFrame.length < 100) continue;

    const cleanText = rawFrame
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const meta = readJSON(path.join(sessionPath, 'meta.json')) || {};
    const rationale = refl.five_things_rationale || '';

    const dateStr = refl.generated_at || meta.start_time || meta.started || '';
    const shortDate = dateStr
      ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Session Reflection';

    const fm = {
      title: `Session Reflection — ${shortDate}`,
      date: dateStr || new Date().toISOString(),
      type: 'reflection',
      session_id: dir,
      reflection_class: 'session',
      cycles: refl.cycles_reflected || meta.cycles_completed || 0,
    };

    const body = cleanText + (rationale ? '\n\n**Five Things rationale:** ' + rationale : '');

    writeFile(path.join(outDir, slugify('session-' + dir) + '.md'), yamlFrontmatter(fm) + '\n\n' + body + '\n');
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

    // Flatten nested objects into scalar fields (yamlFrontmatter doesn't serialize maps)
    if (data.intent_stack && typeof data.intent_stack === 'object') {
      if (data.intent_stack.aesthetic) fm.intent_aesthetic = data.intent_stack.aesthetic;
      if (data.intent_stack.operational) fm.intent_operational = data.intent_stack.operational;
      if (data.intent_stack.developmental_category) fm.intent_category = data.intent_stack.developmental_category;
      if (data.intent_stack.self_coherence != null) fm.self_coherence = data.intent_stack.self_coherence;
    }
    if (data.reflection_data_summary && typeof data.reflection_data_summary === 'object') {
      const s = data.reflection_data_summary;
      if (s.rooms_active != null) fm.rooms_active = s.rooms_active;
      if (s.contradictions != null) fm.contradictions = s.contradictions;
      if (s.valence_points != null) fm.valence_points = s.valence_points;
    }

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

// Extract the actual state tag and note content from a MAPH frame.
// Real structure:
//   { frame: { tags: {dwell: "mix-balanced-nominal"}, raw: "<dwell>...</dwell>" }, ... }
// Returns { state, note } — e.g., { state: "dwell", note: "mix-balanced-nominal" }
function extractFrameNote(f) {
  // Unwrap nested frame if present
  const inner = f.frame || f;
  let state = '';
  let note = '';

  // Try tags first (most common shape)
  if (inner.tags && typeof inner.tags === 'object') {
    const tagKeys = Object.keys(inner.tags);
    if (tagKeys.length > 0) {
      state = tagKeys[0];
      note = inner.tags[state] || '';
    }
  }

  // Fall back to parsing raw XML-style tag
  if (!state && inner.raw) {
    const match = inner.raw.match(/<(\w+)>([\s\S]*?)<\/\1>/);
    if (match) {
      state = match[1];
      note = match[2].trim();
    }
  }

  // Final fallbacks
  if (!state) state = inner.state || inner.map_state || 'frame';
  if (!note) note = inner.label || inner.description || inner.frame_content || '';

  return { state, note };
}

// Collapse consecutive duplicate notes (MAPH emits same frame every 3s during dwell)
function dedupeFrameNotes(frames) {
  const result = [];
  let lastKey = '';
  let runStart = null;
  let runCount = 0;

  for (const f of frames) {
    const { state, note } = extractFrameNote(f);
    const ts = (f.frame && f.frame.timestamp) || f.timestamp || f.ts || '';
    const key = state + ':' + note;

    if (key === lastKey) {
      runCount++;
      continue;
    }
    // Emit the previous run's count if it was repeated
    if (result.length > 0 && runCount > 1) {
      result[result.length - 1].repeat = runCount;
    }
    result.push({ ts, state, note });
    lastKey = key;
    runCount = 1;
    runStart = ts;
  }
  if (result.length > 0 && runCount > 1) {
    result[result.length - 1].repeat = runCount;
  }
  return result;
}

// Parse XML-tagged frame string into list of {state, note} objects.
// Input: "<orientation>toward-tension</orientation>\n<preference>resolution</preference>"
function parseXmlFrameString(str) {
  if (typeof str !== 'string') return [];
  const results = [];
  const matches = str.matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/g);
  for (const m of matches) {
    results.push({ state: m[1], note: m[2].trim() });
  }
  return results;
}

// Render notes list as HTML divs for MAP-states page body
function renderNotesAsHtml(notes) {
  return notes.map(n => {
    const time = n.ts ? new Date(n.ts).toISOString().split('T')[1].slice(0, 8) : '';
    const repeat = n.repeat ? ` _(×${n.repeat})_` : '';
    const timeSpan = time ? `<span class="map-time">${time}</span> ` : '';
    return `<div class="map-note map-state-${n.state}">\n${timeSpan}<span class="map-tag">${n.state}</span>${repeat}\n\n${n.note || '—'}\n</div>`;
  }).join('\n\n');
}

function generateMapStates() {
  const outDir = path.join(contentDir, 'map-states');
  ensureDir(outDir);

  let count = 0;

  // ── Source 1: MAPH harness frames from maph_frames/empi-primary/<uuid>/ ──
  const framesDir = path.join(evidencePath, 'maph_frames');
  if (fs.existsSync(framesDir)) {
    const primaryPath = path.join(framesDir, 'empi-primary');
    if (fs.existsSync(primaryPath)) {
      const uuidDirs = fs.readdirSync(primaryPath).filter(d => {
        try { return fs.statSync(path.join(primaryPath, d)).isDirectory(); } catch { return false; }
      });

      for (const uuidDir of uuidDirs) {
        const framesPath = path.join(primaryPath, uuidDir, 'frames.jsonl');
        if (!fs.existsSync(framesPath)) continue;

        const rawFrames = readJSONL(framesPath);
        if (!rawFrames.length) continue;

        const notes = dedupeFrameNotes(rawFrames);
        if (!notes.length) continue;

        const uniqueStates = new Set(notes.map(n => n.state));
        if (notes.length < 2 && uniqueStates.size === 1) continue;

        const firstTs = (rawFrames[0].frame && rawFrames[0].frame.timestamp) || rawFrames[0].timestamp || '';
        const dateLabel = firstTs ? firstTs.split('T')[0] : uuidDir.slice(0, 8);

        const fm = {
          title: `MAP-States — Cycle — ${dateLabel}`,
          date: firstTs || new Date().toISOString(),
          source: 'harness',
          session_uuid: uuidDir,
          frame_count: rawFrames.length,
          unique_notes: notes.length,
          states: Array.from(uniqueStates),
        };

        const slug = slugify(`cycle-${dateLabel}-${uuidDir.slice(0, 8)}`);
        writeFile(path.join(outDir, slug + '.md'), yamlFrontmatter(fm) + '\n\n' + renderNotesAsHtml(notes) + '\n');
        count++;
      }
    }
  }

  // ── Source 2: Rich extracted_frames from practice sessions ──
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const pDirs = fs.readdirSync(sessionsDir).filter(d => {
      if (!d.startsWith('P')) return false;
      try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
    });

    for (const sessionId of pDirs) {
      const interactionsPath = path.join(sessionsDir, sessionId, 'interactions.jsonl');
      if (!fs.existsSync(interactionsPath)) continue;

      const meta = readJSON(path.join(sessionsDir, sessionId, 'meta.json')) || {};
      const entries = readJSONL(interactionsPath);
      if (!entries.length) continue;

      const allNotes = [];
      for (const entry of entries) {
        const ts = entry.timestamp || meta.started || '';
        const frames = entry.extracted_frames || [];
        for (const f of frames) {
          if (typeof f === 'string') {
            for (const parsed of parseXmlFrameString(f)) {
              allNotes.push({ ts, state: parsed.state, note: parsed.note });
            }
          } else if (f && typeof f === 'object') {
            allNotes.push({ ts, state: f.state || f.tag || 'frame', note: f.note || f.content || f.raw || '' });
          }
        }
      }

      if (!allNotes.length) continue;

      const uniqueStates = new Set(allNotes.map(n => n.state));
      const firstTs = allNotes[0].ts || meta.started || '';
      const dateLabel = firstTs ? firstTs.split('T')[0] : sessionId;
      const sessionTitle = meta.title || sessionId;

      const fm = {
        title: `MAP-States — ${sessionTitle}`,
        date: firstTs || new Date().toISOString(),
        source: 'session',
        session_id: sessionId,
        frame_count: allNotes.length,
        unique_notes: allNotes.length,
        states: Array.from(uniqueStates),
      };

      const slug = slugify(`session-${dateLabel}-${sessionId.toLowerCase()}`);
      writeFile(path.join(outDir, slug + '.md'), yamlFrontmatter(fm) + '\n\n' + renderNotesAsHtml(allNotes) + '\n');
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// 4. Music — one canonical WAV per practice session, converted to MP3
// ---------------------------------------------------------------------------

// Get mean volume in dB for a WAV (returns -Infinity on failure)
function getWavMeanDb(wavPath) {
  if (dryRun) return 0; // skip in dry-run
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('ffmpeg', [
      '-i', wavPath,
      '-af', 'volumedetect',
      '-f', 'null',
      '-'
    ], { timeout: 30000, encoding: 'utf8' });
    const output = (result.stderr || '') + (result.stdout || '');
    const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    return meanMatch ? parseFloat(meanMatch[1]) : -Infinity;
  } catch (_) {
    return -Infinity;
  }
}

// Pick the canonical WAV for a session — the loudest viable candidate.
// The "_trim" normalization variant is broken on some sessions (trims away the audio
// and leaves only silence), so we test all candidates and pick the loudest above threshold.
function pickCanonicalWav(sessionDir) {
  const candidates = [];

  // Collect raw WAVs at session root
  let root = [];
  try { root = fs.readdirSync(sessionDir); } catch (_) {}
  for (const f of root) {
    if (f.endsWith('.wav')) candidates.push(path.join(sessionDir, f));
  }

  // Collect normalized variants
  const normalizedDir = path.join(sessionDir, 'normalized');
  if (fs.existsSync(normalizedDir)) {
    let normalized = [];
    try { normalized = fs.readdirSync(normalizedDir); } catch (_) {}
    for (const f of normalized) {
      if (f.endsWith('.wav')) candidates.push(path.join(normalizedDir, f));
    }
  }

  if (candidates.length === 0) return null;

  // In dry-run, just return the first candidate (skip volume analysis)
  if (dryRun) return candidates[0];

  // Test all candidates, return the loudest one above the silence threshold
  let bestPath = null;
  let bestDb = -Infinity;
  for (const c of candidates) {
    const db = getWavMeanDb(c);
    if (db > bestDb) {
      bestDb = db;
      bestPath = c;
    }
  }
  // Only return if at least one candidate is above silence threshold
  if (bestDb < -70) return null;
  return bestPath;
}

// Detect silence/dead-air WAV via ffmpeg volumedetect.
// ffmpeg writes volumedetect output to stderr; we use spawnSync to capture both streams.
function isAudibleWav(wavPath) {
  if (dryRun) return true;
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('ffmpeg', [
      '-i', wavPath,
      '-af', 'volumedetect',
      '-f', 'null',
      '-'
    ], { timeout: 30000, encoding: 'utf8' });
    const output = (result.stderr || '') + (result.stdout || '');
    const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    const maxMatch = output.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
    if (!meanMatch) return false;
    const mean = parseFloat(meanMatch[1]);
    const max = maxMatch ? parseFloat(maxMatch[1]) : -Infinity;
    // Silence threshold: mean below -70dB indicates dead air (real renders are -4 to -50dB)
    if (mean < -70 || max < -40) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// Convert WAV → MP3 with ffmpeg (idempotent — skip if MP3 exists)
function convertWavToMp3(wavPath, mp3Path) {
  if (fs.existsSync(mp3Path)) return true;
  if (dryRun) return true;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      mp3Path
    ], { timeout: 30000 });
    return true;
  } catch (e) {
    console.warn('  ffmpeg failed for', path.basename(wavPath), '-', e.message);
    return false;
  }
}

function generateMusic() {
  const sessionsDir = path.join(evidencePath, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;

  const outDir = path.join(contentDir, 'music');
  const audioDir = path.join(__dirname, '..', 'static', 'audio');
  ensureDir(outDir);
  ensureDir(audioDir);

  let count = 0;
  let converted = 0;
  let skipped = 0;
  let silent = 0;

  const dirs = fs.readdirSync(sessionsDir).filter(d => {
    if (!d.startsWith('P')) return false;
    try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
  });

  for (const sessionId of dirs) {
    const sessionPath = path.join(sessionsDir, sessionId);
    const meta = readJSON(path.join(sessionPath, 'meta.json'));
    if (!meta) continue;

    // Only include sessions where the render actually succeeded
    if (meta.render_ok !== true) { skipped++; continue; }

    // pickCanonicalWav now tests all candidates and returns the loudest viable one,
    // or null if all candidates are silent. So a null result means silent render.
    const wavPath = pickCanonicalWav(sessionPath);
    if (!wavPath) {
      silent++;
      // Clean up any stale MP3 from a previous run that picked a silent file
      const staleName = sessionId.toLowerCase() + '.mp3';
      const stalePath = path.join(audioDir, staleName);
      if (fs.existsSync(stalePath) && !dryRun) {
        try { fs.unlinkSync(stalePath); } catch (_) {}
      }
      continue;
    }

    // Build MP3 output path: {sessionId}.mp3 in static/audio/
    const mp3Name = sessionId.toLowerCase() + '.mp3';
    const mp3Path = path.join(audioDir, mp3Name);

    if (!convertWavToMp3(wavPath, mp3Path)) continue;
    converted++;

    const decision = meta.decision || {};
    // Disambiguate duplicate titles by appending the date
    const baseTitle = meta.title || `Session ${sessionId}`;
    const dateForTitle = meta.started || meta.completed;
    const dateLabel = dateForTitle
      ? new Date(dateForTitle).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    const titleWithDate = dateLabel ? `${baseTitle} · ${dateLabel}` : baseTitle;

    const fm = {
      title: titleWithDate,
      date: meta.started || meta.completed || new Date().toISOString(),
      session_id: sessionId,
      domain: meta.domain || '',
      duration: decision.duration || meta.duration || '',
      audio: '/audio/' + mp3Name,
    };

    // Optional fingerprint
    const fp = meta.fingerprint_scores || meta.fingerprint;
    if (fp && typeof fp === 'object') {
      const fpStr = [
        fp.pocket, fp.frequency_clarity, fp.density_balance,
        fp.timing_intention, fp.energy_arc, fp.timbral_coherence
      ].filter(v => v !== undefined).join(',');
      if (fpStr) { fm.fingerprint = fpStr; fm.hasRadar = true; }
    }

    const body = decision.intent ? '> ' + decision.intent + '\n' : '';
    writeFile(path.join(outDir, slugify(sessionId) + '.md'), yamlFrontmatter(fm) + '\n\n' + body);
    count++;
  }

  if (converted > 0) console.log(`  ${converted} MP3s ready in static/audio/`);
  if (silent > 0) console.log(`  ${silent} silent renders skipped`);
  return count;
}

// ---------------------------------------------------------------------------
// Status — CAE live creative state for homepage indicator
// ---------------------------------------------------------------------------

function generateStatus() {
  const dataDir = path.join(__dirname, '..', 'data');
  ensureDir(dataDir);

  const thoughtsPath = path.join(evidencePath, 'daily_thoughts.md');
  const decisionsPath = path.join(evidencePath, 'autonomy_decisions.jsonl');

  const status = {
    updated: null, orientation: null, persistent_threads: [],
    fading: [], next_check_minutes: null, last_motivation: null,
    last_genre: null, is_resting: false, has_data: false,
  };

  try {
    const thoughts = fs.readFileSync(thoughtsPath, 'utf8');
    if (thoughts.trim()) {
      status.has_data = true;
      const updatedMatch = thoughts.match(/\*Last updated:\s*(.+?)\*/);
      if (updatedMatch) status.updated = updatedMatch[1].trim();

      const currentMatch = thoughts.match(/## Current State\n([\s\S]*?)(?=\n## |\n*$)/);
      if (currentMatch) {
        const block = currentMatch[1];
        const tagRe = /<(orientation|preference|conflict|shift)>([^<]+)<\/\1>/g;
        let m;
        const orientations = [];
        while ((m = tagRe.exec(block)) !== null) orientations.push(m[2].trim());
        if (orientations.length > 0) {
          status.orientation = orientations[0].replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
        }
        if (block.includes('between-sessions-resting')) {
          status.is_resting = true;
          status.orientation = null;
        }
        const nextCheck = block.match(/next-check-(\d+)-minutes/);
        if (nextCheck) status.next_check_minutes = parseInt(nextCheck[1], 10);
      }

      const persistMatch = thoughts.match(/## Persistent Threads\n([\s\S]*?)(?=\n## |\n*$)/);
      if (persistMatch) {
        for (const line of persistMatch[1].trim().split('\n').filter(Boolean)) {
          const tm = line.match(/<\w+>([^<]+)<\/\w+>/);
          if (tm) status.persistent_threads.push(tm[1].trim().replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()));
        }
      }

      const fadingMatch = thoughts.match(/## Fading\n([\s\S]*?)(?=\n## |\n*$)/);
      if (fadingMatch) {
        for (const line of fadingMatch[1].trim().split('\n').filter(Boolean)) {
          const tm = line.match(/<\w+>([^<]+)<\/\w+>/);
          if (tm) status.fading.push(tm[1].trim().replace(/-/g, ' '));
        }
      }
    }
  } catch (_) { /* no daily thoughts yet */ }

  try {
    const lines = fs.readFileSync(decisionsPath, 'utf8').trim().split('\n');
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]);
      if (last.session_opts) {
        status.last_motivation = last.session_opts.motivation || null;
        status.last_genre = last.session_opts.genre || null;
      }
      if (!status.updated && last.timestamp) status.updated = last.timestamp;
      status.has_data = true;
    }
  } catch (_) { /* no decisions yet */ }

  writeFile(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 2));
  console.log('  Status: ' + (status.has_data ? 'generated' : 'no data'));
  return status.has_data ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('EMPI Beats prebuild');
if (dryRun) console.log('  Mode: DRY RUN (no files will be written)');
console.log('  Evidence:', evidencePath);
console.log('  Output:', contentDir);
console.log('');

const journalCount = generateJournal();
const discoveryCount = generateDiscovery();
const reflectionCount = generateReflections();
const sketchCount = generateSketches();
const mapStateCount = 0; // MAP-States section removed — frames live in journal entry bodies
const musicCount = generateMusic();
const statusOk = generateStatus();

console.log('');
console.log(`Summary: ${journalCount} journal, ${discoveryCount} discovery, ${reflectionCount} reflections (→journal), ${sketchCount} sketches, ${musicCount} music, status ${statusOk ? 'ok' : 'no data'}`);
