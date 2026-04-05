/**
 * MAP-State Timeline Swimlane — renders cognitive state transitions as horizontal bands.
 * Reads JSON from #frame-data script element.
 * Expected: [{ "ts": "ISO8601", "state": "dwell|shift|conflict|anticipation|transition", "label": "..." }, ...]
 */
(function () {
  var COLORS = {
    dwell: '#48a0b0',
    shift: '#4CAF50',
    conflict: '#f44336',
    anticipation: '#FFC107',
    transition: '#9E9E9E'
  };
  var BG = '#0a0f1a';
  var SURFACE = '#182a3c';
  var MUTED = '#82d0dc';

  function render() {
    var chartEl = document.getElementById('swimlane-chart');
    if (!chartEl || !chartEl.dataset.frames) return;
    var container = chartEl;

    var frames;
    try { frames = JSON.parse(chartEl.dataset.frames); } catch (e) { return; }
    if (!frames || !frames.length) return;

    var W = Math.max(container.clientWidth, 600);
    var H = 220;
    var PAD = { top: 30, right: 20, bottom: 40, left: 20 };
    var bandH = 28;
    var chartW = W - PAD.left - PAD.right;

    var t0 = new Date(frames[0].ts).getTime();
    var tN = new Date(frames[frames.length - 1].ts).getTime();
    var span = Math.max(tN - t0, 1);

    function xOf(ts) {
      return PAD.left + ((new Date(ts).getTime() - t0) / span) * chartW;
    }

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.width = '100%';
    svg.style.background = BG;

    // Helper to create SVG elements
    function mkEl(tag, attrs) {
      var el = document.createElementNS(ns, tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    function mkText(x, y, text, attrs) {
      var el = mkEl('text', Object.assign({ x: x, y: y }, attrs));
      el.textContent = text;
      return el;
    }

    // Title
    svg.appendChild(mkText(W / 2, 18, 'MAP-State Timeline', {
      fill: MUTED, 'font-size': '11', 'text-anchor': 'middle'
    }));

    // Draw state bands
    var bandY = PAD.top + 10;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var x1 = xOf(f.ts);
      var x2 = (i + 1 < frames.length) ? xOf(frames[i + 1].ts) : PAD.left + chartW;
      var w = Math.max(x2 - x1, 2);
      var color = COLORS[f.state] || COLORS.transition;

      var rect = mkEl('rect', {
        x: x1, y: bandY, width: w, height: bandH, fill: color, rx: '2'
      });
      var title = document.createElementNS(ns, 'title');
      title.textContent = f.state + (f.label ? ': ' + f.label : '') + '\n' + f.ts;
      rect.appendChild(title);
      svg.appendChild(rect);

      if (w > 40) {
        svg.appendChild(mkText(x1 + w / 2, bandY + bandH / 2 + 4, f.state, {
          fill: BG, 'font-size': '9', 'text-anchor': 'middle', 'font-weight': '600'
        }));
      }
    }

    // Legend
    var states = Object.keys(COLORS);
    var legendY = H - 15;
    states.forEach(function (s, i) {
      var x = PAD.left + i * 100;
      svg.appendChild(mkEl('rect', { x: x, y: legendY, width: '10', height: '10', fill: COLORS[s], rx: '2' }));
      svg.appendChild(mkText(x + 14, legendY + 9, s, { fill: MUTED, 'font-size': '9' }));
    });

    // Time axis
    var axisY = bandY + bandH + 20;
    svg.appendChild(mkEl('line', {
      x1: PAD.left, y1: axisY, x2: PAD.left + chartW, y2: axisY,
      stroke: SURFACE, 'stroke-width': '1'
    }));
    var ticks = Math.min(frames.length, 8);
    var tickStep = Math.floor(frames.length / ticks);
    for (var i = 0; i < frames.length; i += Math.max(tickStep, 1)) {
      var x = xOf(frames[i].ts);
      var t = new Date(frames[i].ts);
      var label = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
      svg.appendChild(mkEl('line', {
        x1: x, y1: axisY - 3, x2: x, y2: axisY + 3, stroke: MUTED, 'stroke-width': '1'
      }));
      svg.appendChild(mkText(x, axisY + 14, label, {
        fill: MUTED, 'font-size': '8', 'text-anchor': 'middle'
      }));
    }

    // Clear and append
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(svg);

    // Click interaction — show tooltip
    container.addEventListener('click', function (e) {
      var rect = svg.getBoundingClientRect();
      var clickX = e.clientX - rect.left;
      var ratio = (clickX - PAD.left) / chartW;
      var idx = Math.min(Math.max(Math.round(ratio * (frames.length - 1)), 0), frames.length - 1);
      var f = frames[idx];
      var existing = container.querySelector('.tooltip');
      if (existing) existing.parentNode.removeChild(existing);
      var tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.style.cssText = 'position:absolute;background:#182a3c;border:1px solid #243a50;padding:8px 12px;border-radius:4px;font-size:12px;color:#f0fafc;pointer-events:none;z-index:10;';
      var strong = document.createElement('strong');
      strong.textContent = f.state;
      tip.appendChild(strong);
      if (f.label) {
        tip.appendChild(document.createElement('br'));
        tip.appendChild(document.createTextNode(f.label));
      }
      tip.appendChild(document.createElement('br'));
      var tsSpan = document.createElement('span');
      tsSpan.style.color = '#82d0dc';
      tsSpan.textContent = f.ts;
      tip.appendChild(tsSpan);
      container.style.position = 'relative';
      tip.style.left = Math.min(clickX, container.clientWidth - 200) + 'px';
      tip.style.top = '0px';
      container.appendChild(tip);
      setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 3000);
    });
  }

  document.addEventListener('DOMContentLoaded', render);
})();
