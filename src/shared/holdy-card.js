/*
 * Prevenza: Prevy's intervention card on extension pages (Step 7). DOM only, text nodes only, never HTML.
 *
 * H.holdyCard.render(container, assessment, { context, onReview, compact })
 *   Builds the model with holdy.js (language and elder mode come from the page's own <html> attributes) and shows:
 *   - nothing, when there is no result
 *   - a small note, for LOW and INCONCLUSIVE
 *   - a warning card, for MEDIUM, HIGH and CRITICAL
 *
 * Repeats and dismissals are remembered only in this page's memory, by a fingerprint of the result (which rules fired
 * and the level), never by the text, address or payment. Closing the page forgets them.
 * Dismissing never marks anything safe: a short note stays, says the level, and can bring the warning back.
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});
  const seen = new Map(); // fingerprint -> "shown" | "dismissed"
  const ICONS = { info: "i", uncertain: "?", caution: "!", warning: "!!", stop: "\u25A0" };
  let idCounter = 0;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(text, onClick, primary) {
    const b = el("button", "btn" + (primary ? " btn-primary" : ""), text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function tierTag(model) {
    const tag = el("span", "holdy-tier");
    tag.setAttribute("data-tier", model.tier);
    const icon = el("span", "holdy-icon", ICONS[model.tier] || "i");
    icon.setAttribute("aria-hidden", "true");
    tag.append(icon, el("span", null, model.tierLabel));
    return tag;
  }

  function mascot(size) {
    const slot = el("span");
    slot.setAttribute("aria-hidden", "true");
    if (H.mascotElement) slot.appendChild(H.mascotElement(document, size));
    return slot;
  }

  function note(model, text, extraButton) {
    const box = el("div", "holdy-note");
    box.setAttribute("data-tier", model.tier);
    box.setAttribute("role", "status");
    box.append(mascot(28), tierTag(model), el("span", "small", text));
    if (extraButton) box.appendChild(extraButton);
    return box;
  }

  function lines(className, items) {
    const wrap = el("div", className);
    items.forEach((t) => wrap.appendChild(el("p", "small", t)));
    return wrap;
  }

  /** "Review": moves focus to the analysis (opts.reviewTarget, an element or a function returning one) or calls opts.onReview. */
  function review(opts) {
    if (typeof opts.onReview === "function") return opts.onReview();
    const target = typeof opts.reviewTarget === "function" ? opts.reviewTarget() : opts.reviewTarget;
    if (!target) return undefined;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.scrollIntoView({ block: "start" });
    target.focus();
    return undefined;
  }

  function card(model, opts, rerender, compact) {
    const box = el("section", "holdy");
    const hid = "holdy-h-" + ++idCounter;
    box.setAttribute("data-level", model.category);
    box.setAttribute("data-tier", model.tier);
    box.setAttribute("aria-labelledby", hid);
    // Announce HIGH and CRITICAL once, when they first appear. Repeats and lower levels are polite.
    box.setAttribute("role", model.urgent && !compact ? "alert" : "status");
    if (compact) box.setAttribute("data-repeat", "true");

    const head = el("div", "holdy-head");
    const h = el("h3", null, model.lead + " " + model.headline);
    h.id = hid;
    head.append(mascot(44), tierTag(model), h);
    box.appendChild(head);

    const dismiss = button(model.labels.dismiss, () => {
      seen.set(model.key, "dismissed");
      rerender();
    });

    if (compact) {
      // A short card: for a repeat of the same result, or for small spaces such as the popup.
      box.appendChild(el("p", "muted small", compact === "repeat" ? model.labels.repeat : model.simple[0] || model.disclaimer));
      const row = el("div", "btn-row");
      row.append(button(model.labels.details, () => rerender(true)), dismiss);
      box.appendChild(row);
      return box;
    }

    if (model.simple.length) {
      box.appendChild(el("p", "holdy-label", model.labels.noticed));
      box.appendChild(lines("holdy-simple", model.simple));
    }
    if (model.signs.length) {
      box.appendChild(el("p", "holdy-label", model.labels.signs));
      box.appendChild(lines("holdy-signs muted", model.signs.map((s) => s.label + (s.source ? " (" + s.source + ")" : ""))));
    }
    box.appendChild(el("p", "holdy-label", model.labels.todo));
    const ul = el("ul");
    model.actions.forEach((text, i) => {
      const li = el("li");
      if (i === 0) li.appendChild(button(text, () => review(opts)));
      else li.textContent = text;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(el("p", "muted small", model.disclaimer));
    if (model.partial) box.appendChild(el("p", "muted small", model.labels.partial));
    const row = el("div", "btn-row");
    row.appendChild(dismiss);
    box.appendChild(row);
    return box;
  }

  function render(container, assessment, opts) {
    const o = opts || {};
    const html = document.documentElement;
    const model = H.holdy.build(assessment, { context: o.context, language: html.lang, elder: html.getAttribute("data-elder") === "true" });
    container.textContent = "";
    if (!model.show) return model;

    if (model.show === "note") {
      container.appendChild(note(model, model.note));
      return model;
    }

    const draw = (forceFull) => {
      container.textContent = "";
      const state = seen.get(model.key);
      if (state === "dismissed" && !forceFull) {
        container.appendChild(
          note(model, model.labels.hidden, button(model.labels.show, () => {
            seen.set(model.key, "shown");
            draw(true);
          }))
        );
        return;
      }
      const compact = forceFull ? false : state === "shown" ? "repeat" : o.compact === true ? "small" : false;
      if (forceFull) seen.set(model.key, "shown");
      container.appendChild(card(model, o, (full) => draw(full === true), compact));
      seen.set(model.key, "shown");
    };
    draw(false);
    return model;
  }

  /** Forget repeats and dismissals (for tests and for "Clear" buttons that should start over). */
  function reset() {
    seen.clear();
  }

  H.holdyCard = { render, reset };
})();
