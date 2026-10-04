// version.js
// Fills the "Last updated / Version" line from version.json, which
// gen-version.sh regenerates from git. The line stays hidden until real
// data loads, so the page never shows stale or fake values.
(function () {
    var meta = document.getElementById('site-meta');
    var updated = document.getElementById('last-updated');
    var version = document.getElementById('version');

    if (!meta || !updated || !version) {
        return;
    }

    function fill(data) {
        if (!data || !data.updated || !data.version) {
            return;
        }
        updated.textContent = data.updated;
        version.textContent = data.version;
        meta.hidden = false;
    }

    fetch('./version.json', { cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('version.json not available');
            }
            return response.json();
        })
        .then(fill)
        .catch(function () {
            // Keep the line hidden rather than show stale values.
        });
})();
