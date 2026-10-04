// theme.js
// Dark is the default. The toggle stores the choice in localStorage.
(function () {
    var docEl = document.documentElement;

    function storedTheme() {
        try {
            return localStorage.getItem('theme');
        } catch (error) {
            return null;
        }
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            docEl.setAttribute('data-theme', 'light');
        } else {
            docEl.removeAttribute('data-theme');
        }
    }

    function currentTheme() {
        return docEl.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    applyTheme(storedTheme());

    document.addEventListener('DOMContentLoaded', function () {
        var buttons = document.querySelectorAll('.theme-toggle');

        function updateLabels() {
            var label = currentTheme() === 'light' ? 'Dark' : 'Light';
            buttons.forEach(function (button) {
                button.textContent = label;
            });
        }

        buttons.forEach(function (button) {
            button.hidden = false;
            button.addEventListener('click', function () {
                var next = currentTheme() === 'light' ? 'dark' : 'light';
                applyTheme(next);
                try {
                    localStorage.setItem('theme', next);
                } catch (error) {
                    // Private mode: the theme still applies for this page view.
                }
                updateLabels();
            });
        });

        updateLabels();
    });
})();
