class Profile {
   name = null;
   id = Date.now().toString() + Math.random().toString().replace(".", "");
   data = {};

   constructor(name) {
      this.name = name;
   }

   updateData(path, value) {
      let data = this.data;
      const keys = path.split('.');

      for (let i = 0; i < keys.length - 1; i++) {
         if (!data[keys[i]])
            data[keys[i]] = {};
         data = data[keys[i]];
      }

      data[keys[keys.length - 1]] = value;
   }

   static fromObject(obj) {
      for (const key of ["name", "id", "data"])
         if (!Object.hasOwn(obj, key))
            throw new Error("missing key fields");

      const retval = new Profile(obj.name);
      if (obj.id != null)
         retval.id = obj.id;
      retval.data = obj.data;
      return retval;
   }
}

class SettingsManager extends EventTarget {
   // available events
   EVT_SETTINGS_READY = "settings-ready";
   EVT_PROFILE_LIST_CHANGED = "profile-list-changed";
   EVT_PROFILE_CHANGED = "profile-changed";
   EVT_VALUE_CHANGED = "value-changed";

   // public properties
   log = new Logger("SettingsMgr");
   currentProfile = null;

   // private properties
   #settingsReady = Promise.withResolvers();
   #profileList = {};
   #storage = null;
   #delayedUpdateTimeout = null;

   // public interface
   constructor() {
      super();
      this.#initStorageSystem();
   }

   async getAllProfiles() {
      // wait until profile is fully loaded
      await this.#settingsReady.promise;
      return this.#profileList;
   }

   async addProfileFromObject(obj) {
      try {
         const newProfile = Profile.fromObject(obj);
         await this.loadColorSet(newProfile);
         await this.#store(`profile-${newProfile.id}`, newProfile);
         this.#profileList[newProfile.id] = newProfile.name;
         await this.#updateProfileSettings();

         this.dispatchEvent(new Event(this.EVT_PROFILE_LIST_CHANGED));
         return newProfile;

      } catch (error) {
         throw new Error(`invalid profile data provided, ${error.message}`);
      }
   }

   async changeToProfile(profileId) {
      this.currentProfile = Profile.fromObject(
         await this.#retrieve(`profile-${profileId}`));
      await this.#updateProfileSettings();

      this.dispatchEvent(new Event(this.EVT_PROFILE_CHANGED));
   }

   async renameProfile(newName) {
      if (newName == this.currentProfile.name)
         return;

      this.currentProfile.name = newName;
      this.#profileList[this.currentProfile.id] = newName;
      await this.#save();
      await this.#updateProfileSettings();

      this.dispatchEvent(new Event(this.EVT_PROFILE_CHANGED));
   }

   async deleteProfile() {
      const profileIds = Object.keys(this.#profileList);
      if (profileIds.length <= 1)
         return;

      const currentIndex = profileIds.indexOf(this.currentProfile.id);
      const nextIndex = (currentIndex + 1) % profileIds.length;
      const nextProfileId = profileIds[nextIndex];

      await this.#storage.delete(`profile-${this.currentProfile.id}.json`);
      delete this.#profileList[this.currentProfile.id];
      await this.changeToProfile(nextProfileId);
      await this.#updateProfileSettings();
      this.dispatchEvent(new Event(this.EVT_PROFILE_LIST_CHANGED));
   }

   async loadColorSet(profile) {
      const resp = await fetch("css/themes/colors.json");
      const colors = await resp.json();
      profile.updateData("midi.colors", colors);
   }

   async get(path, defValue = null) {
      // wait until profile is fully loaded
      await this.#settingsReady.promise;

      if (path === undefined)
         breakpoint();

      const keys = path.split('.');
      let data = this.currentProfile.data;

      for (let i = 0; i < keys.length; i++) {
         if (data[keys[i]] === undefined)
         return defValue;
         data = data[keys[i]];
      }

      return data;
   }

   async update(path, value) {
      this.currentProfile.updateData(path, value);
      await this.#save();

      this.dispatchEvent(new CustomEvent(this.EVT_VALUE_CHANGED, {detail: {
         path: path, value: value
      }}));

      this.dispatchEvent(new CustomEvent(`change ${path}`, {detail: {
         path: path, value: value
      }}));

      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      this.log.debug(`change '${path}' to '${strVal}'`);
   }

   async delayedUpdate(path, value) {
      if (this.#delayedUpdateTimeout) {
         clearTimeout(this.#delayedUpdateTimeout);
      }

      this.#delayedUpdateTimeout = setTimeout(async () => {
         await this.update(path, value);
      }, 500);
   }

   // private interface

   async #initStorageSystem() {
      // request persistent storage
      this.#storage = await caches.open("storage-v1");
      if (navigator.storage && navigator.storage.persist) {
         navigator.storage.persist().then((allow) => {
            if (allow) this.log.info("persistent storage allowed");
            else this.log.warn("persistent storage was NOT allowed!");
         });
      }

      // get general profile info (current, available, etc)
      let profiles = await this.#retrieve('profiles');
      if (profiles)
         this.log.info("profile list retrieved from storage")

      else {
         // no profiles, create one and store it
         this.log.info("no profiles available, creating a default one");
         this.currentProfile = new Profile("Default");
         await this.#save();

         // create the profile list and store it
         profiles = {current: this.currentProfile.id, all: {}}
         profiles.all[this.currentProfile.id] = this.currentProfile.name;
         await this.#updateProfileSettings(profiles);
      }

      // load current profile
      this.#profileList = profiles.all;
      if (this.currentProfile == null)
         await this.changeToProfile(profiles.current);

      this.#settingsReady.resolve(true);
      this.dispatchEvent(new Event(this.EVT_SETTINGS_READY));
      this.log.info("storage initialized");
   }

   async #store(key, obj) {
      await this.#storage.put(`/${key}.json`, new Response(
         JSON.stringify(obj), {headers: {'content-type': 'application/json'}}
      ));
   }

   async #retrieve(key) {
      let retval = await this.#storage.match(`/${key}.json`);
      if (retval)
         retval = await retval.json();
      else
         this.log.warn(`could not load key: '/${key}.json'`);
      return retval;
   }

   async #save() {
      await this.#store(`profile-${this.currentProfile.id}`, this.currentProfile);
      this.log.debug("current profile saved");
   }

   async #updateProfileSettings(profiles = null) {
      if (profiles == null)
         profiles = {current: this.currentProfile.id, all: this.#profileList}
      await this.#store("profiles", profiles);
      this.log.debug("profile settings updated");
   }
}

class SettingsController {
   log = new Logger("SettingsCtrl");

   #activeSection = null;
   #container = null;

   // public interface

   constructor(containerId, defaultSection = "general") {
      this.#container = $(`#${containerId}`);

      this.#fillWithSettings();
      this.#createNoteColorMap("sa-color-map-1", 0, 31, true);
      this.#createNoteColorMap("sa-color-map-2", 32, 63);
      this.#createNoteColorMap("sa-color-map-3", 64, 95);
      this.#createNoteColorMap("sa-color-map-4", 96, 127);

      this.switchSection(defaultSection);
   }

   switchSection(name) {
      if (this.#activeSection == name)
         return;
      this.#container.find("#sa-sections-menu .active").removeClass("active");
      this.#container.find(`#sa-menu-${name}`).addClass("active");
      this.#container.find('.section').hide();
      this.#container.find(`#sa-${name}`).show();
      this.#activeSection = name;
   }

   onProfileChange(ev) {
      const profileId = $(ev.target).find(":selected").val();
      _settings.changeToProfile(profileId);
   }

   onProfileNameEdit(save) {
      if (save) {
         const newName = this.#container.find("#sa-profile-name > input").val().trim();
         this.#container.find("#sa-profile-name > select :selected").text(newName);
         _settings.renameProfile(newName);
      }
      this.enableEditProfileName(false);
   }

   enableEditProfileName(state) {
      this.#container.find("#sa-profile-name > *").hide();

      if (state) {
         this.#container.find("#sa-profile-name > .show-on-edit").show();
         const name = this.#container.find("#sa-profile-name > select :selected").text();
         this.#container.find("#sa-profile-name > input").val(name).focus();
      }
      else {
         this.#container.find("#sa-profile-name > .hide-on-edit").show();
      }
   }

   exportProfile() {
      const blob = new Blob([JSON.stringify(_settings.currentProfile)],
         {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${_settings.currentProfile.name}.json`;
      a.click();
      URL.revokeObjectURL(url);

      this.log.debug(`export current profile as '${a.download}'`);
   }

   importProfile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = ".json";
      input.onchange = async (e) => {
         try {
            const data = await e.target.files[0].text();
            const profile = await _settings.addProfileFromObject(JSON.parse(data));
            this.log.debug(`successfully imported profile: '${profile.name}'`);
         } catch(error) {
            this.log.error(`could not import profile: '${error.message}'`);
         }
      };
      input.click();
   }

   async duplicateProfile() {
      // serialize current profile to create a deep copy
      const clone = JSON.parse(JSON.stringify(_settings.currentProfile));
      const profileNames = Object.values(await _settings.getAllProfiles());
      clone.id = null;

      // find a suitable new name
      const copyRegex = /\((copy(?: x(\d+))?)\)$/;
      const oldName = clone.name.replace(copyRegex, "").trim();
      let newName = `${oldName} (copy)`;
      let count = 2;
      while (profileNames.includes(newName)) {
         newName = `${oldName} (copy x${count})`;
         count++;
      }

      clone.name = newName;
      const newProfile = await _settings.addProfileFromObject(clone);
      await _settings.changeToProfile(newProfile.id);
      this.log.debug("current profile cloned");
   }

   async addProfile() {
      const profileNames = Object.values(await _settings.getAllProfiles());
      let name = "New profile";
      let count = 2;
      while (profileNames.includes(name))
         name = `New profile (x${count++})`;

      const profile = new Profile(name);
      this.log.debug(`new profile created, named: '${name}'`);

      await _settings.loadColorSet(profile);
      await _settings.addProfileFromObject(profile);
      await _settings.changeToProfile(profile.id);
   }

   async deleteProfile() {
      if (Object.keys(await _settings.getAllProfiles()).length <= 1) {
         this.log.warn("the only remaining profile could not be deleted");
         return;
      }

      const profile = JSON.parse(JSON.stringify(_settings.currentProfile));
      await _settings.deleteProfile();
      this.log.debug(`profile named '${profile.name}' deleted`);

      // offer the posibility to undo it
      const warnMsg = `The profile <b>'${profile.name}'</b> was deleted.`;
      _ui.showUndoMsg("sa-profile-actions-msg", warnMsg, async () => {
         await _settings.addProfileFromObject(profile);
         await _settings.changeToProfile(profile.id);
         this.log.debug(`profile named '${profile.name}' was restored successfully`);
         return true;
      });
   }

   onThemeChange(ev) {
      const wg = $(ev.target);
      const opt = wg.find(":selected")
      const path = opt.length ? opt.attr("path") : "";
      $("head link.theme").attr("href", path);
      this.log.debug(`current theme set to '${path}'`);

      // save settings only when field is changed by user
      if (ev.isTrusted)
         _settings.update(wg.attr("p-key"), opt.val());
   }

   onVibrateChange(ev) {
      const wg = $(ev.target);
      _settings.update(wg.attr("p-key"), wg.is(":checked"));
   }

   onMidiInChange(ev) {
      const wg = $(ev.target);
      const name = wg.find("option:selected").text().trim();
      _settings.update(wg.attr("p-key"), {id: wg.val(), name: name});
      $("#sa-midi-in-msg").hide();
   }

   onMidiOutChange(ev) {
      const wg = $(ev.target);
      const name = wg.find("option:selected").text().trim();
      _settings.update(wg.attr("p-key"), {id: wg.val(), name: name});
      $("#sa-midi-out-msg").hide();
   }

   onPadsModeChange(ev) {
      const wg = $(ev.target);
      _settings.update(wg.attr("p-key"), wg.val());
   }

   onIntegerInputChange(ev) {
      const wg = $(ev.target);
      const min = parseInt(wg.prop("min"));
      const max = parseInt(wg.prop("max"));
      const val = clamp(min, parseInt(wg.val()), max);
      if (wg.val() != `${val}`)
         wg.val(val);
      _settings.update(wg.attr("p-key"), val);
   }

   showColorPage(target, page) {
      this.#container.find('#sa-color-maps-banks .active').removeClass("active");
      $(target).addClass("active");
      this.#container.find(`#sa-color-maps div`).hide();
      this.#container.find(`#sa-color-map-${page}`).show();
   }

   downloadLogs() {
      const logs = $('#log-view').val();
      const blob = new Blob([logs], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zynthian-nakama.log';
      a.click();
      URL.revokeObjectURL(url);
   }

   // private interface

   async #fillWithSettings() {
      // theme selector
      const themeSelect = $("#sa-theme");
      fetch("css/themes/themes.json").then(async (resp) => {
         const themes = await resp.json();
         for (let spec of themes) {
            themeSelect.append(`
               <option value="${spec.id}" path="${spec.path}"
               ${spec.default ? 'default="true"': ""}
               >${spec.name}</option>
            `);
            this.log.debug(`system theme added: '${spec.name}'`);
         }
         this.log.debug("theme list loaded");
      });

      // profile selector
      const profileSelect = this.#container.find("#sa-profile-name > select");

      const doFillProfileSelector = async() => {
         const profiles = await _settings.getAllProfiles();
         profileSelect.empty();
         for (const id in profiles) {
            const selected = id == _settings.currentProfile.id ? "selected" : "";
            profileSelect.append(`
               <option value="${id}" ${selected}>${profiles[id]}</option>
            `);
         }
      }

      doFillProfileSelector();
      _settings.addEventListener(_settings.EVT_PROFILE_LIST_CHANGED, doFillProfileSelector);

      // midi ports
      const midiInSelect = $("#sa-midi-in");
      const midiOutSelect = $("#sa-midi-out");
      _midi.ready.then(async (isReady) => {
         if (!isReady)
            return;

         for (const entry of _midi.ports.out) {
            const output = entry[1];
            midiOutSelect.append(`
               <option value="${output.id}" label="${output.name}">
               ${output.name}</option>
            `);
         }

         for (const entry of _midi.ports.in) {
            const input = entry[1];
            midiInSelect.append(`
               <option value="${input.id}" label="${input.name}">
               ${input.name}</option>
            `);
         }
      });

      // pads mapping buttons
      const popOverTmpl = document.getElementById("sa-pads-map-tpl");
      $("#sa-pads-map-buttons > button").each((idx, btn) => {
         const container = document.createElement("div");
         container.appendChild(document.importNode(popOverTmpl.content, true));
         const input = $(container).find("input");
         $(container).find("button:first-of-type").on("click", () => {
            input[0].stepDown();
            input[0].dispatchEvent(new Event("change"));
         });
         $(container).find("button:last-of-type").on("click", async () => {
            input[0].stepUp();
            input[0].dispatchEvent(new Event("change"));
         });
         input.attr("p-key", $(btn).attr("p-key"));
         input.on("change", (ev) => {
            this.onIntegerInputChange(ev);
            $(btn).attr("cc-num", input.val())
         });

         tippy(btn, {
            content: container,
            interactive: true,
            arrow: true,
            arrowType: 'round',
            trigger: "click",
            theme: "nakama",
            onTrigger: () => input.val($(btn).attr("cc-num") || 0),
         });
      });

      // add a listener to update UI elements on profile change
      _settings.addEventListener(_settings.EVT_PROFILE_CHANGED, async () => {
         this.log.info(`profile changed to '${_settings.currentProfile.name}'`);

         // profile selector
         profileSelect.val(_settings.currentProfile.id);

         // user theme selector
         const defaultTheme = themeSelect.find("option[default]").val();
         const userTheme = await _settings.get(themeSelect.attr("p-key"), defaultTheme);
         themeSelect.val(userTheme).trigger("change");

         // vibration toggle
         const vibrationWg = $("#sa-vibrate");
         const vibrationVal = await _settings.get(vibrationWg.attr("p-key"), true);
         vibrationWg.prop("checked", vibrationVal);

         // color maps
         const colorMapsWg = $("#sa-color-maps");
         const colorMapsVal = await _settings.get(colorMapsWg.attr("p-key"), []);
         for (let idx = 0; idx < 128; idx++) {
            const btn = colorMapsWg.find(`#sa-color-btn-${idx}`);
            let val = colorMapsVal[idx];
            if (val)
               val = "#" + val.toString(16).padStart(6, '0');
            this.#setButtonColor(btn, val);
         }

         // midi ports
         // FIXME: if some port is not found, show a warning icon on the bar
         const userMidiIn = await _settings.get(midiInSelect.attr("p-key"), {});
         const userMidiOut = await _settings.get(midiOutSelect.attr("p-key"), {});
         midiInSelect.val(userMidiIn.id);
         if (midiInSelect.val() == null) {
            const msg = `Input MIDI port '${userMidiIn.name}' not found.`;
            $("#sa-midi-in-msg").text(msg).show();
            this.log.error(msg);
         }
         else
            $("#sa-midi-in-msg").hide();
         midiOutSelect.val(userMidiOut.id);
         if (midiOutSelect.val() == null) {
            const msg = `Output MIDI port '${userMidiOut.name}' not found.`;
            $("#sa-midi-out-msg").text(msg).show();
            this.log.error(msg);
         }
         else
            $("#sa-midi-out-msg").hide();

         // pads area controls
         const padDefaults = PadsController.getDefaultSettings(true);
         const padControls = {
            "mode": "mode", "root-note": "root-note", "velocity": "velocity",
            "channel-a": "channel-a", "channel-b": "channel-b",
            "map-rec-btn": "map.rec", "map-stop-btn": "map.stop",
            "map-play-btn": "map.play", "map-shift-btn": "map.shift",
            "map-rl-1-btn": "map.row-launch-1", "map-rl-2-btn": "map.row-launch-2",
            "map-rl-3-btn": "map.row-launch-3", "map-rl-4-btn": "map.row-launch-4",
         };
         for (const name in padControls) {
            const wg = $(`#sa-pads-${name}`);
            const value = await _settings.get(
               wg.attr("p-key"), padDefaults[padControls[name]]);
            wg.is("button") ? wg.attr("cc-num", value) : wg.val(value);
         }
      });
   }

   #setButtonColor(btn, val) {
      if (val) {
         btn.val(val);
         btn.css({"--note-color": val, "border-color": "transparent"});
      }
      else {
         btn.val("");
         btn.css({"--note-color": "transparent", "border-color": ""});
      }
   }

   #createNoteColorMap(elemId, start, end, active) {
      const colorMapsWg = $("#sa-color-maps");
      let rows = 4;
      let cols = 8;

      _ui.createButtonGrid({
         cols: cols, rows: rows,
         containerId: elemId,
         cssClass: (col, row) => {
            if (row == 0 && col == 0)
               return "btn idx-bl";
            if (row == 0 && col == cols-1)
               return "btn idx-br";
            if (row == rows-1 && col == 0)
               return "btn idx-tl";
            if (row == rows-1 && col == cols-1)
               return "btn idx-tr";
            return col == 4 ? "btn" : "btn";
         },
         attributes: (row, col) => 'data-coloris',
         btnId: (col, row) => {
            return `sa-color-btn-${start + row * cols + col}`;
         },
         elemType: "button",
         events: {
            change: async (ev) => {
               const btn = $(ev.target);
               let newColor = btn.val();
               this.#setButtonColor(btn, newColor);

               const note = parseInt(btn.prop("id").split('-').pop(), 10);
               const path = colorMapsWg.attr("p-key");
               let colorMapsVal = await _settings.get(path, []);
               if (!colorMapsVal)
                  colorMapsVal = new Array(128).fill(0);
               newColor = parseInt(newColor.replace("#", ""), 16);
               if (colorMapsVal[note] != newColor) {
                  colorMapsVal[note] = newColor;
                  _settings.update(path, colorMapsVal);
               }
            },
            open: (ev) => $(ev.target).addClass("color-picker-active"),
            close: (ev) => $(ev.target).removeClass("color-picker-active"),
         }
      });

      let container = $(`#${elemId}`);
      container.find(".idx-bl").attr("label", start);
      container.find(".idx-br").attr("label", start + cols - 1);
      container.find(".idx-tl").attr("label", end - cols + 1);
      container.find(".idx-tr").attr("label", end);

      if (!active)
         container.hide();
   }
}
