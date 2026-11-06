(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_NAMES = Object.freeze([
    "search", "sliders-horizontal", "map-pin", "calendar-days", "gauge",
    "settings-2", "fuel", "message-circle", "messages-square", "menu",
    "arrow-left", "chevron-left", "chevron-right", "x", "rotate-ccw",
    "circle-alert", "chevron-down", "log-out", "lock-keyhole", "car-front",
    "plus", "check", "image", "send",
  ]);
  const ALLOWED_ICONS = new Set(ICON_NAMES);
  const ALLOWED_SIZES = new Set([16, 20, 24]);
  const SAFE_CLASS = /^[A-Za-z][A-Za-z0-9_-]*$/;

  function create(name, options = {}) {
    if (!ALLOWED_ICONS.has(name)) throw new TypeError("Unknown Lucide icon.");
    const size = options.size ?? 20;
    if (!ALLOWED_SIZES.has(size)) throw new TypeError("Icon size must be 16, 20, or 24.");

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("lucide-icon");
    if (options.className) {
      String(options.className).split(/\s+/).filter(Boolean).forEach((token) => {
        if (!SAFE_CLASS.test(token)) throw new TypeError("Invalid icon class.");
        svg.classList.add(token);
      });
    }
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("focusable", "false");

    if (typeof options.label === "string" && options.label.trim()) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", options.label.trim());
    } else {
      svg.setAttribute("aria-hidden", "true");
    }

    const use = document.createElementNS(SVG_NS, "use");
    const sprite = document.body?.dataset?.iconSprite || "/static/img/icons/lucide-sprite.svg";
    use.setAttribute("href", `${sprite}#${name}`);
    svg.append(use);
    return svg;
  }

  window.AppIcons = Object.freeze({ create });
})();
