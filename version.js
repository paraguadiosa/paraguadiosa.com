// version.js

document.addEventListener('DOMContentLoaded', (event) => {
    // Function to get the current date and time
    function getCurrentDateTime(format = 'day-month-year') {
        return '04.09.26';
    }


    // Function to get the version of the website
    function getVersion() {
        return "4.3.0";
    }

    // Update the 'last-updated' span with the current date and time
    document.getElementById('last-updated').textContent = getCurrentDateTime();

    // Update the 'version' span with the version of the website
    document.getElementById('version').textContent = getVersion();
});