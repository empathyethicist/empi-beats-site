---
title: Session session_001
date: "2026-02-20T20:06:45.783Z"
type: 
domain: 
genre: 
duration: 
intent: 
rationale: 
render_status: pending
condition: B
model: mistral-small-latest
hasRadar: false
session_id: session_001
---

Here's a SuperCollider pattern that creates a rhythmic sequence using filtered noise with evolving density:

```supercollider
// 1. Define SynthDef for filtered noise
SynthDef(\noiseRhythm, { |freq = 440, amp = 0.5, dur = 1, cutoff = 1000, resonance = 0.5|
    var env = EnvGen.ar(Env.perc(0.01, dur), doneAction: 2);
    var noise = WhiteNoise.ar(amp);
    var filtered = MoogFF.ar(noise, freq, cutoff, resonance);
    var rhythmic = filtered * env;
    Out.ar(0, rhythmic ! 2);
}).store;

// 2. Create pattern with evolving density
p = Pbind(
    \instrument, \noiseRhythm,
    \dur, Pseq([0.125, 0.25, 0.125, 0.5, 0.25, 0.125], inf), // varying note durations
    \amp, 0.6,
    \cutoff, Pwhite(500, 2000), // random cutoff frequencies
    \resonance, Pwhite(0.3, 0.8), // random resonance values
    \degree, Pseq([0, 2, 4, 5, 7, 9, 11], inf) // melodic sequence
);

// 3. Add density evolution using Pfunc
p = Pbind(
    \instrument, \noiseRhythm,
    \dur, Pfunc({ |ev|
        var densities = [0.125, 0.25, 0.125, 0.5, 0.25, 0.125];
        var currentDensity = densities.wrap(ev['counter'] % densities.size);
        currentDensity * (1.0 - 0.2 * (ev['counter'] % 16 / 16.0)).round(0.0625);
    }),
    \amp, 0.6,
    \cutoff, Pwhite(500, 2000),
    \resonance, Pwhite(0.3, 0.8),
    \degree, Pseq([0, 2, 4, 5, 7, 9, 11], inf)
);

// 4. Render via NRT
p.asScore(16).recordNRT(
    outputFilePath: "~/output.wav".standardizePath,
    headerFormat: "WAV",
    sampleFormat: "int16",
    sampleRate: 44100,
    duration: 16
);
```

<frame>
  <orientation> rhythmic noise pattern with evolving density
  <preference> filtered white noise with Moog filter
  <uncertain> optimal cutoff and resonance values
  <shift> density evolution over time
  <conflict> between rhythmic consistency and random variation
</frame>
