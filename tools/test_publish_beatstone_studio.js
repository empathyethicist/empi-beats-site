const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildBeatstoneStudioMarkdown,
  buildBeatstoneStudioHtml,
  publishBeatstoneStudio,
  unwrapPanel,
} = require('./publish_beatstone_studio');

// A minimal empi_beatstone_studio_panel_v1 packet (as the empi-house summary
// reader emits with --studio-panel).
function samplePanel() {
  return {
    schema: 'empi_beatstone_studio_panel_v1',
    surface: 'empibeats.com/studio',
    panel_id: 'beatstone-studio-panel:1:0:0',
    generated_at: '2026-06-12T00:00:00.000Z',
    status: 'beatstone_studio_panel_ready',
    entries: [
      {
        evidence_id: 'beatstone-fixture-1',
        beatstone_slice: 'measure_and_discard_core',
        source_channel: 'manual_local_file',
        fingerprint_status: 'full_mix_chromaprint_computed',
        measurement_status: 'essentia_measurement_completed',
        discard_status: 'all_transient_audio_deleted',
        chromaprint_fingerprint: 'chromaprint:fixture-canon-entry-aaaaaaaa',
        fingerprint_duration: 184,
        structural_sfv_summary: {
          source: 'slice1_measurement_stage',
          creative_character_stems: ['drums', 'bass'],
          microtiming_stems: ['drums'],
          evaluation_dimension_keys: ['pocket', 'frequency_separation'],
        },
        storage_contract: { metadata_only: true, audio_payload_stored: false },
        non_claims: { founder_valence_captured: false },
      },
    ],
    summary: {
      entry_count: 1,
      invalid_frame_count: 0,
      invalid_summary_count: 0,
      metadata_only: true,
      audio_payload_stored_count: 0,
    },
    boundary_metadata: {
      studio_read_view_only: true,
      ingestion_owner: 'Heartie',
      storage_owner: 'Falkner',
      measurement_owner: 'Essentia',
      audio_operation: false,
    },
  };
}

test('beatstone studio markdown is a read-view with no audio claims', () => {
  const md = buildBeatstoneStudioMarkdown(samplePanel());
  assert.match(md, /beatstone_studio: true/);
  assert.match(md, /studio_read_view_only: true/);
  assert.match(md, /Audio rendered: false/);
  assert.match(md, /Founder valence captured: false/);
  assert.match(md, /Triangulation: false/);
  assert.doesNotMatch(md, /<audio/i);
  // The metadata-only canon entry renders.
  assert.match(md, /measure_and_discard_core/);
});

test('beatstone studio HTML renders the canon table without an audio player', () => {
  const html = buildBeatstoneStudioHtml(samplePanel());
  assert.match(html, /Beatstone — Canon Reference Corpus/);
  assert.match(html, /Read view only/);
  assert.match(html, /Heartie ingestion/);
  assert.doesNotMatch(html, /<audio/i);
  // Fingerprint is truncated for display (24 chars), not shown raw/full.
  assert.match(html, /chromaprint:fixture-cano…/);
  assert.doesNotMatch(html, /fixture-canon-entry-aaaaaaaa/);
});

test('publish writes the /studio/beatstone content + dist pages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'empi-beatstone-studio-'));
  const panelPath = path.join(tmp, 'panel.json');
  const contentRoot = path.join(tmp, 'content');
  const distRoot = path.join(tmp, 'public');
  fs.writeFileSync(panelPath, JSON.stringify(samplePanel(), null, 2));

  const result = publishBeatstoneStudio(panelPath, contentRoot, distRoot);
  assert.equal(result.schema, 'empi_beatstone_studio_publish_result_v1');
  assert.equal(result.surface, 'empibeats.com/studio');
  assert.equal(result.url_path, '/studio/beatstone/');
  assert.equal(result.entry_count, 1);
  assert.equal(result.audio_rendered, false);
  assert.equal(result.mutates_beatstone, false);
  assert.equal(fs.existsSync(result.content_path), true);
  assert.equal(fs.existsSync(result.dist_path), true);
});

test('publish rejects a non-Beatstone panel packet', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'empi-beatstone-studio-bad-'));
  const panelPath = path.join(tmp, 'panel.json');
  fs.writeFileSync(panelPath, JSON.stringify({ schema: 'something_else' }));
  assert.throws(() => publishBeatstoneStudio(panelPath, path.join(tmp, 'c'), path.join(tmp, 'p')), /empi_beatstone_studio_panel_v1/);
});

test('an empty corpus publishes a valid empty read view', () => {
  const empty = { ...samplePanel(), status: 'beatstone_studio_panel_empty', entries: [], summary: { entry_count: 0, invalid_frame_count: 0, invalid_summary_count: 0, metadata_only: true } };
  const md = buildBeatstoneStudioMarkdown(empty);
  assert.match(md, /No canon entries ingested yet/);
  const html = buildBeatstoneStudioHtml(empty);
  assert.match(html, /No canon entries ingested yet/);
});
