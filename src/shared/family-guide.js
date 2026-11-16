/*
 * Prevenza: the "Ask someone you trust" guide (Step 8). DOM only, text nodes only, never HTML.
 *
 * It is information only. It has no input box, no link, no phone number and no way to send anything. It does not
 * contact anyone, and it does not collect or keep any contact details. Whether the guide is open is remembered
 * nowhere: closing the page forgets it.
 *
 * The panel exists in the page only while it is open, so a closed guide adds one button and nothing else.
 *
 * H.familyGuide.create(family, { open, noTitle })  builds the button and the panel from the "family" text of elder-text.js
 * H.familyGuide.render(container, language, opts)  the same, picking the text for the language
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});
  let counter = 0;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function create(family, opts) {
    const o = opts || {};
    const id = "family-guide-" + ++counter;
    const wrap = el("div", "family");

    const toggle = el("button", "btn btn-trust", family.show);
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    wrap.appendChild(toggle);

    let panel = null;

    function build() {
      const p = el("section", "family-panel");
      p.id = id;
      if (o.noTitle) {
        p.setAttribute("aria-label", family.title);
      } else {
        const heading = el("h4", null, family.title);
        heading.id = id + "-h";
        p.setAttribute("aria-labelledby", id + "-h");
        p.appendChild(heading);
      }
      p.appendChild(el("p", null, family.intro));
      const list = el("div", "family-points");
      list.setAttribute("role", "list");
      family.points.forEach((text) => {
        const item = el("p", null, text);
        item.setAttribute("role", "listitem");
        list.appendChild(item);
      });
      p.appendChild(list);
      p.appendChild(el("p", "muted small", family.footer));
      const close = el("button", "btn", family.hide);
      close.type = "button";
      close.addEventListener("click", () => {
        setOpen(false);
        toggle.focus();
      });
      p.appendChild(close);
      return p;
    }

    function setOpen(next) {
      if (next && !panel) {
        panel = build();
        wrap.appendChild(panel);
        toggle.setAttribute("aria-controls", id);
      } else if (!next && panel) {
        panel.remove();
        panel = null;
        toggle.removeAttribute("aria-controls");
      }
      toggle.setAttribute("aria-expanded", panel ? "true" : "false");
    }

    toggle.addEventListener("click", () => {
      setOpen(!panel);
      if (panel) {
        panel.setAttribute("tabindex", "-1");
        panel.focus();
      }
    });
    if (o.open) setOpen(true);
    return wrap;
  }

  function render(container, language, opts) {
    const set = (H.elderText && (H.elderText[language] || H.elderText.en)) || null;
    container.textContent = "";
    if (!set) return null;
    const node = create(set.family, opts);
    container.appendChild(node);
    return node;
  }

  H.familyGuide = { create, render };
})();
