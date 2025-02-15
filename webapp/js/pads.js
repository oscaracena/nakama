
// TODO: add haptic feedback on button press
// TODO: implement pads/row-launch/transpose colors from incoming events

class PadsController {
   log = new Logger("PadsCtrl");

   #shift = false;
   #shiftCancel = new AbortController();
   #shiftTs = 0;
   #changeVel = false;
   #defaultVel = 63;

   #cc;
   #root;
   #offset = 0;
   #rowLaunchCCs = [];
   #ccMap = {};
   #velMap = [];
   #channelA;
   #channelB;

   // public interface

   constructor() {
      _ui.createButtonGrid({
         cols: 5, rows: 4,
         containerId: "pa-pads-array",
         columnSizes: 'repeat(4, 1fr) auto',
         label: (col, row) => {
            return col == 4 ? "" : row * 4 + col + 1;
         },
         cssClass: (col, row) => {
            return col == 4 ? "btn-row-launch" : "btn-pad";
         },
         index: (col, row) => {
            return col < 4 ? row * 4 + col : row;
         },
         onPress: this.#onPadPress.bind(this),
         onRelease: this.#onPadRelease.bind(this),
      });

      _ui.handleActiveClass("#pa-rec-btn");
      _ui.handleActiveClass("#pa-stop-btn");
      _ui.handleActiveClass("#pa-play-btn");

      this.#createVelocitySliders();

      _settings.addEventListener(
         _settings.EVT_PROFILE_CHANGED, this.#onProfileChanged.bind(this));
      _settings.addEventListener(
         _settings.EVT_VALUE_CHANGED, (ev) => {
            if (!ev.detail.path.startsWith("pads."))
               return;
            this.#onSettingsChanged(ev.detail.path, ev.detail.value);
         });
      this.log.debug("controller ready");
   }

   static getDefaultSettings(flat=false) {
      const retval = {
         "root-note": 60,
         velocity: 63,
         mode: "note",
         "channel-a": 0,
         "channel-b": 1,
         map: {
            rec: 1,
            stop: 2,
            play: 3,
            shift: 0,
            "row-launch-1": 4,
            "row-launch-2": 5,
            "row-launch-3": 6,
            "row-launch-4": 7,
            velocities: [],
         }
      };
      if (flat)
         return flattenObject(retval);
      return retval;
   }

   sendCCMessage(name, vel = null) {
      let ccnum = this.#ccMap[name];
      if (ccnum === undefined)
         ccnum = 0;
      if (vel == null)
         vel = this.#defaultVel;
      _midi.sendCC(ccnum, vel, this.#channelB);
   }

   onShiftPress(ev) {
      ev.stopPropagation();
      const btn = $(ev.currentTarget);

      // on double tap, lock the shift
      if (this.#shift && ev.timeStamp - this.#shiftTs < 400) {
         btn.addClass("lock", this.#shift);
         this.#shiftCancel.abort();
         this.#shiftCancel = new AbortController();
         return;
      }

      this.#shift = !this.#shift;
      btn.toggleClass("active", this.#shift);
      btn.removeClass("lock", this.#shift);
      this.sendCCMessage('shift', this.#shift ? null : 0);

      if (this.#shift) {
         document.addEventListener("pointerdown", () => {
            this.#shift = false;
            btn.removeClass("active");
            setTimeout(() => this.sendCCMessage('shift', 0), 0);
         }, { once: true, signal: this.#shiftCancel.signal });
      }
      else {
         this.#shiftCancel.abort();
         this.#shiftCancel = new AbortController();
      }

      this.#shiftTs = ev.timeStamp;
   }

   toggleVelocity(ev) {
      const btn = $(ev.currentTarget);

      // reset all velocities when pressing SHIFT
      if (this.#changeVel && this.#shift) {
         _settings.update("pads.map.velocities", []);
         return;
      }

      this.#changeVel = !this.#changeVel
      btn.toggleClass("active", this.#changeVel);
      this.#showPadVelocities(this.#changeVel);
   }

   increasePadOffset(ev) {
      this.#changePadOffset(ev, 16);
   }

   decreasePadOffset(ev) {
      this.#changePadOffset(ev, -16);
   }

   toggleCC(event) {
      this.#cc = !this.#cc;
      this.log.debug(`pads mode changed to ${this.#cc ? 'cc' : 'note-on/off'}`);
      $(event.currentTarget).toggleClass("active");
   }

   // private interface

   async #onProfileChanged() {
      this.log.info(`profile changed to '${_settings.currentProfile.name}'`);
      const defs = PadsController.getDefaultSettings();
      let settings = await _settings.get("pads", defs);

      this.#onSettingsChanged(
         "pads.mode", getWithDef(settings, "mode", defs["mode"]));
      this.#onSettingsChanged(
         "pads.root-note", getWithDef(settings, "root-note", defs["root-note"]));
      this.#onSettingsChanged(
         "pads.velocity", getWithDef(settings, "velocity", defs["velocity"]));
      this.#onSettingsChanged(
         "pads.channel-a", getWithDef(settings, "channel-a", defs["channel-a"]));
      this.#onSettingsChanged(
         "pads.channel-b", getWithDef(settings, "channel-b", defs["channel-b"]));

      const ccmap = getWithDef(settings, "map", defs["map"]);
      for (const [key, value] of Object.entries(ccmap)) {
         this.#onSettingsChanged(`pads.map.${key}`, value);
      }
   }

   #onSettingsChanged(path, value) {
      switch (path) {
         case "pads.mode":
            this.#cc = value === "cc";
            $("#pa-cc-btn").toggleClass("active", this.#cc);
            this.log.debug(`pads mode set to '${this.#cc ? "cc" : "note"}'`);
            break;

         case "pads.root-note":
            this.#root = value;
            this.#offset = 0;
            $("#pa-root-note-label").text(this.#root);
            $("#pa-offset-label").text(`+ ${this.#offset}`);
            this.log.debug(`pads root note set to '${this.#root}'`);
            break;

         case "pads.velocity":
            this.#defaultVel = value;
            this.#updateVelocitySliders();
            this.log.debug(`pads default velocity set to '${value}'`);
            break;

         case "pads.channel-a":
            this.#channelA = value;
            this.log.debug(`pads channel A set to '${this.#channelA}'`);
            break;

         case "pads.channel-b":
            this.#channelB = value;
            this.log.debug(`pads channel B set to '${this.#channelB}'`);
            break;

         case "pads.map.rec":
         case "pads.map.stop":
         case "pads.map.play":
         case "pads.map.shift":
            this.#ccMap[path.split(".").pop()] = value;
            this.log.debug(`pads map ${path.split(".").pop()} set to '${value}'`);
            break;

         case "pads.map.row-launch-1":
         case "pads.map.row-launch-2":
         case "pads.map.row-launch-3":
         case "pads.map.row-launch-4":
            const index = parseInt(path.split("-").pop()) - 1;
            this.#rowLaunchCCs[index] = value;
            this.log.debug(`pads map ${path.split(".").pop()} set to '${value}'`);
            break;

         case "pads.map.velocities":
            this.#velMap = value;
            this.#updateVelocitySliders();
            this.log.debug(`pads map velocities set to '${value}'`);
            break;

         default:
            this.log.warn(`unknown settings change for path: '${path}'`);
      }
   }

   #onPadPress(btn) {
      // row launch buttons sent on release
      if (btn.col == 4)
         return

      if (!this.#cc) {
         const note = this.#root + this.#offset + btn.index;
         const vel = getWithDef(this.#velMap, btn.index, this.#defaultVel);
         _midi.noteOn(note, vel, this.#channelA);
      }
   }

   #onPadRelease(btn) {
      const vel = getWithDef(this.#velMap, btn.index, this.#defaultVel);

      // row launch buttons
      if (btn.col == 4) {
         const ccNum = getWithDef(this.#rowLaunchCCs, btn.index, btn.index);
         _midi.sendCC(ccNum, vel, this.#channelA);
      }

      else if (this.#cc)
         _midi.sendCC(this.#root + this.#offset + btn.index, vel, this.#channelA);
      else
         _midi.noteOff(this.#root + this.#offset + btn.index, 0, this.#channelA);
   }

   #changePadOffset(ev, incValue) {
      const target = $(ev.currentTarget);
      target.addClass("active");

      const changeOffset = () => {
         let increment = incValue;

         // if current value is less than increment, adjust only by that amount
         if (this.#offset % increment !== 0) {
            const remainder = this.#offset % increment;
            increment = Math.sign(increment) * Math.abs(remainder);
         }

         this.#offset = Math.max(-this.#root, Math.min(112 - this.#root, this.#offset + increment));

         const sign = this.#offset < 0 ? "-" : "+";
         $("#pa-offset-label").text(`${sign} ${Math.abs(this.#offset)}`);
         this.log.debug(
            `offset ${increment > 0 ? 'increased' : 'decreased'} to ${this.#offset}`
         );
      };

      changeOffset();
      _ui.repeatUntileRelease({
         target: target,
         repeat: changeOffset,
         release: () => target.removeClass("active"),
      });
   }

   #createVelocitySliders(pads) {
      $("#pa-pads-array .btn-pad").each((_, pad) => {
         const index = parseInt($(pad).attr("btn-index"));
         const overlay = $(`
            <div style="display: none" class="pad-vel-overlay">
               <span class="vel-bar"></span>
               <span class="vel-number">63</span>
            </div>
         `);
         new SliderControl({
            min: 0, max: 127,
            container: overlay,
            onChange: (value) => {
               overlay.find(".vel-number").text(value);
               overlay.find(".vel-bar").css("--fill-per", value / 127);
               this.#velMap[index] = value;
               _settings.delayedUpdate("pads.map.velocities", this.#velMap);
            }
         });
         $(pad).append(overlay);
      });
   }

   #updateVelocitySliders() {
      $("#pa-pads-array .btn-pad").each((_, pad) => {
         const index = parseInt($(pad).attr("btn-index"));
         const overlay = $(pad).find(".pad-vel-overlay");
         const value = getWithDef(this.#velMap, index, this.#defaultVel);
         overlay.find(".vel-number").text(value);
         overlay.find(".vel-bar").css("--fill-per", value / 127);
      });
   }

   #showPadVelocities(show) {
      $(".pad-vel-overlay").toggle(show);
   }
}
