/**
 * Fingerprint Radar Chart — renders a 6-axis SVG radar for producer judge scores.
 * Reads data-scores attribute (comma-separated, 0-100).
 * Axes: Pocket, Frequency Clarity, Density Balance, Timing Intention, Energy Arc, Timbral Coherence.
 */
(function () {
  var AXES = [
    'Pocket', 'Freq Clarity', 'Density Bal',
    'Timing Int', 'Energy Arc', 'Timbral Coh'
  ];
  var ACCENT = '#d49050';
  var MUTED = '#82d0dc';
  var GRID = '#243a50';

  function polarToXY(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function buildChart(el) {
    var raw = el.getAttribute('data-scores');
    if (!raw) return;
    var scores = raw.split(',').map(Number);
    if (scores.length !== 6) return;

    var size = 300;
    var cx = size / 2, cy = size / 2, maxR = 110;
    var step = 360 / 6;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.style.maxWidth = size + 'px';

    // Grid rings
    for (var ring = 1; ring <= 4; ring++) {
      var r = (maxR / 4) * ring;
      var pts = [];
      for (var i = 0; i < 6; i++) {
        var p = polarToXY(cx, cy, r, step * i);
        pts.push(p.x + ',' + p.y);
      }
      var poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', GRID);
      poly.setAttribute('stroke-width', '1');
      svg.appendChild(poly);
    }

    // Axis lines + labels
    for (var i = 0; i < 6; i++) {
      var p = polarToXY(cx, cy, maxR, step * i);
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
      line.setAttribute('stroke', GRID); line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      var lp = polarToXY(cx, cy, maxR + 18, step * i);
      var txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', lp.x); txt.setAttribute('y', lp.y);
      txt.setAttribute('fill', MUTED);
      txt.setAttribute('font-size', '9');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'middle');
      txt.textContent = AXES[i];
      svg.appendChild(txt);
    }

    // Data polygon
    var dataPts = [];
    for (var i = 0; i < 6; i++) {
      var r = (scores[i] / 100) * maxR;
      var p = polarToXY(cx, cy, r, step * i);
      dataPts.push(p.x + ',' + p.y);
    }
    var dataPoly = document.createElementNS(ns, 'polygon');
    dataPoly.setAttribute('points', dataPts.join(' '));
    dataPoly.setAttribute('fill', ACCENT);
    dataPoly.setAttribute('fill-opacity', '0.2');
    dataPoly.setAttribute('stroke', ACCENT);
    dataPoly.setAttribute('stroke-width', '2');
    svg.appendChild(dataPoly);

    // Data dots
    for (var i = 0; i < 6; i++) {
      var r = (scores[i] / 100) * maxR;
      var p = polarToXY(cx, cy, r, step * i);
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
      dot.setAttribute('r', '3'); dot.setAttribute('fill', ACCENT);
      svg.appendChild(dot);
    }

    // Clear and append using DOM methods
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(svg);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.fingerprint-chart').forEach(buildChart);
  });
})();
