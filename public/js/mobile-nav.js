/*
 * Phone menu. Below 700px the sidebar becomes a drawer opened from a menu button in the top bar.
 * On wider screens nothing here shows, and the sidebar stays where it is.
 */
(function () {
    "use strict";

    var sidebar = document.querySelector(".sidebar");
    var topbar = document.querySelector(".topbar");
    if (!sidebar || !topbar) return;

    var MOBILE = window.matchMedia("(max-width: 700px)");

    sidebar.id = sidebar.id || "appSidebar";

    // Keep the title block together so the menu button sits beside it, not between its lines.
    var left = topbar.firstElementChild;
    var title = document.createElement("div");
    title.className = "topbar-title";
    while (left.firstChild) title.appendChild(left.firstChild);
    left.classList.add("topbar-left");

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-controls", sidebar.id);
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
        '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/>' +
        '<line x1="4" y1="17" x2="20" y2="17"/></svg>';
    left.appendChild(toggle);
    left.appendChild(title);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "nav-close";
    close.setAttribute("aria-label", "Close menu");
    close.innerHTML = "&times;";
    sidebar.insertBefore(close, sidebar.firstChild);

    var overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    document.body.appendChild(overlay);

    function setOpen(open) {
        document.body.classList.toggle("nav-open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        if (open) close.focus(); else if (MOBILE.matches) toggle.focus();
    }

    toggle.addEventListener("click", function () {
        setOpen(!document.body.classList.contains("nav-open"));
    });
    close.addEventListener("click", function () { setOpen(false); });
    overlay.addEventListener("click", function () { setOpen(false); });
    sidebar.addEventListener("click", function (e) {
        if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && document.body.classList.contains("nav-open")) setOpen(false);
    });
    // Rotating the phone or widening the window leaves no half-open drawer behind.
    MOBILE.addEventListener("change", function () {
        document.body.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
    });
})();
