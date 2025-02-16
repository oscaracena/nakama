function checkAPICompat() {
   // TODO: check for navigator.requestMIDIAccess
   return {ok: true};
}

$(window).on("load", async function () {
   _ui = new UIManager("app-container", "pads");

   const compat = checkAPICompat();
   if (!compat.ok) {
      _ui.showCriticalError("Could not continue", compat.details, false);
      return;
   }

   _settings = new SettingsManager();
   _midi = new MIDIIface();

   // objects dedicated to handle each UI area
   _padsCtrl = new PadsController();
   _settingsCtrl = new SettingsController("settings-area", "general");

   // disable context menu
   window.addEventListener("contextmenu", (e) => { e.preventDefault(); });
});
