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
    // Elder Mode adds one plain sentence ("check for yourself first") and, when the result is uncertain, the family guide.
    if (model.elder && model.elder.extra) box.appendChild(el("span", "small holdy-extra", model.elder.extra));
    if (model.elder && model.elder.trust && H.familyGuide) box.appendChild(H.familyGuide.create(model.elder.family));
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

  /** Elder Mode: what we found, why it can be dangerous, and one or two next steps, then the family guide. No <li> here. */
  function elderPanel(model) {
    const e = model.elder;
    const panel = el("div", "holdy-elder");
    panel.appendChild(el("p", "holdy-label", e.labels.found));
    panel.appendChild(el("p", "holdy-found", e.found));
    panel.appendChild(el("p", "holdy-label", e.labels.why));
    panel.appendChild(el("p", "holdy-why", e.why));
    panel.appendChild(el("p", "holdy-label", e.labels.todo));
    const todo = el("div", "holdy-do");
    e.steps.forEach((s, i) => {
      const p = el("p", "holdy-step");
      p.append(el("span", "holdy-step-no", String(i + 1)), el("span", null, s));
      todo.appendChild(p);
    });
    panel.appendChild(todo);
    if (H.familyGuide) panel.appendChild(H.familyGuide.create(e.family));
    return panel;
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
    if (model.elder) box.setAttribute("data-elder", "true");

    const head = el("div", "holdy-head");
    const h = el("h3", null, model.lead + " " + model.headline);
    h.id = hid;
    head.append(mascot(44), tierTag(model), h);
    box.appendChild(head);

    const dismiss = button(model.labels.dismiss, () => {
      seen.set(model.key, "dismissed");
      rerender();
    });

    if (model.elder) box.appendChild(elderPanel(model));

    if (compact) {
      // A short card: for a repeat of the same result, or for small spaces such as the popup.
      box.appendChild(el("p", "muted small", compact === "repeat" ? model.labels.repeat : model.simple[0] || model.disclaimer));
      const row = el("div", "btn-row");
      row.append(button(model.labels.details, () => rerender(true)), dismiss);
      box.appendChild(row);
      return box;
    }

    // In Elder Mode the technical detail sits in a section that is open by default and can be closed.
    const detail = model.elder ? el("details", "holdy-more") : box;
    if (model.elder) {
      detail.open = true;
      detail.appendChild(el("summary", null, model.elder.labels.more));
      box.appendChild(detail);
    }
    if (model.simple.length) {
      detail.appendChild(el("p", "holdy-label", model.labels.noticed));
      detail.appendChild(lines("holdy-simple", model.simple));
    }
    if (model.signs.length) {
      detail.appendChild(el("p", "holdy-label", model.labels.signs));
      detail.appendChild(lines("holdy-signs muted", model.signs.map((s) => s.label + (s.source ? " (" + s.source + ")" : ""))));
    }
    detail.appendChild(el("p", "holdy-label", model.labels.todo));
    const ul = el("ul");
    model.actions.forEach((text, i) => {
      const li = el("li");
      if (i === 0) li.appendChild(button(text, () => review(opts)));
      else li.textContent = text;
      ul.appendChild(li);
    });
    detail.appendChild(ul);
    detail.appendChild(el("p", "muted small", model.disclaimer));
    if (model.partial) detail.appendChild(el("p", "muted small", model.labels.partial));
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
