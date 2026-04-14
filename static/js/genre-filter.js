/**
 * Genre filter for journal list page.
 * Reads data-genre from .card elements, builds filter buttons, toggles visibility.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var container = document.querySelector('.genre-filter');
    if (!container) return;

    var cards = document.querySelectorAll('.card[data-genre], .card-attempt[data-genre], .card.reflection-cross-session, .card.reflection-session');
    if (!cards.length) return;

    // Collect unique genres + entry types
    var genres = new Set();
    cards.forEach(function (c) {
      var g = c.getAttribute('data-genre');
      if (g) genres.add(g);
    });

    var types = ['all', 'reflection', 'attempt'];
    var genreList = Array.from(genres).sort();

    // Build filter bar
    var bar = document.createElement('div');
    bar.className = 'filter-bar';

    function makeBtn(label, value, group) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn' + (value === 'all' ? ' active' : '');
      btn.textContent = label;
      btn.setAttribute('data-filter', value);
      btn.setAttribute('data-group', group);
      btn.addEventListener('click', function () {
        applyFilter(value);
        bar.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      return btn;
    }

    bar.appendChild(makeBtn('All', 'all', 'type'));
    genreList.forEach(function (g) { bar.appendChild(makeBtn(g, g, 'genre')); });
    bar.appendChild(makeBtn('Reflections', 'reflection', 'type'));
    bar.appendChild(makeBtn('Attempts', 'attempt', 'type'));

    container.appendChild(bar);

    function applyFilter(value) {
      cards.forEach(function (card) {
        if (value === 'all') {
          card.style.display = '';
          return;
        }
        if (value === 'reflection') {
          card.style.display = (card.classList.contains('reflection-cross-session') || card.classList.contains('reflection-session')) ? '' : 'none';
          return;
        }
        if (value === 'attempt') {
          card.style.display = card.classList.contains('card-attempt') ? '' : 'none';
          return;
        }
        // Genre filter
        var g = card.getAttribute('data-genre');
        card.style.display = (g === value) ? '' : 'none';
      });
    }
  });
})();
