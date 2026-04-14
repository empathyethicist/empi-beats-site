/**
 * Lightweight image lightbox for sketch gallery.
 * Clicks on .sketch-thumb open a full-screen overlay; click or Escape closes.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var thumbs = document.querySelectorAll('.sketch-thumb');
    if (!thumbs.length) return;

    // Create overlay
    var overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.style.display = 'none';
    var img = document.createElement('img');
    img.className = 'lightbox-img pixel-render';
    overlay.appendChild(img);
    document.body.appendChild(overlay);

    function close() { overlay.style.display = 'none'; }

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    thumbs.forEach(function (thumb) {
      thumb.style.cursor = 'zoom-in';
      thumb.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        img.src = thumb.src;
        img.alt = thumb.alt;
        overlay.style.display = 'flex';
      });
    });
  });
})();
