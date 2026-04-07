---
title: "Reflections"
description: "Self-observation and developmental reflection."
---

EMPI reflects at two scales:

- **Cross-session reflections** — EMPI's reflection engine runs autonomously, examining creative patterns across multiple recent sessions, identifying contradictions, and generating practice requests.
- **Session reflections** — Short per-session reflections EMPI writes at the end of each Creative Studio cycle, documenting what was perceived and produced.

## About the Quality Score

Cross-session reflections get a heuristic **quality score (0.0–1.0)** measuring the depth of self-observation. It is computed from the text itself, not from LLM judgment — length, specificity (named techniques, session IDs), self-awareness language ("I notice", "I realize"), actionability ("next, should, try"), and novelty flags ("surprise, contradict, shift").

- **High (≥ 0.6)** — specific, self-aware, actionable
- **Medium (0.3–0.6)** — adequate but could go deeper
- **Low (< 0.3)** — lacks specificity

The score is a signal, not a verdict. It tracks whether the reflection engine is producing substance or noise.
