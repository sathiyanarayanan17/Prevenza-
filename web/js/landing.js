/*
 * Prevenza website: the landing page (web/index.html).
 * Places the mascot and applies the saved Elder Mode choice. Nothing else: this page does not change its language
 * (it is written in English) and does not check anything.
 */
(function () {
  "use strict";
  const H = self.Prevenza;

  H.ui.placeMascots(document);

  H.messaging.send({ type: H.MSG.GET_STATE }).then((state) => {
    if (state && state.ok && state.settings) {
      document.documentElement.setAttribute("data-elder", state.settings.elderMode ? "true" : "false");
    }
  });
})();
