// Some useful constants
// const SYSEX_REQUEST   = 0x00;
// const SYSEX_RESPONSE  = 0x01;
// const SYSEX_CHECK_DEV = 0x00;
// const SYSEX_DEV_ACK   = 0x01;
// const SYSEX_REFRESH   = 0x02;
const SYSEX_START     = 0xF0;
const SYSEX_END       = 0xF7;
const SYSEX_DEV_ID    = 0x7D;

const MIDI_NOTE_ON    = 0x90;
const MIDI_NOTE_OFF   = 0x80;
const MIDI_CC         = 0xB0;

// const LED_BRIGHT_10   = 0x00;
// const LED_BRIGHT_25   = 0x01;
// const LED_BRIGHT_50   = 0x02;
// const LED_BRIGHT_65   = 0x03;
// const LED_BRIGHT_75   = 0x04;
// const LED_BRIGHT_90   = 0x05;
// const LED_BRIGHT_100  = 0x06;
// const LED_PULSING_16  = 0x07;
// const LED_PULSING_8   = 0x08;
// const LED_PULSING_4   = 0x09;
// const LED_PULSING_2   = 0x0A;
// const LED_BLINKING_24 = 0x0B;
// const LED_BLINKING_16 = 0x0C;
// const LED_BLINKING_8  = 0x0D;
// const LED_BLINKING_4  = 0x0E;
// const LED_BLINKING_2  = 0x0F;


class MIDIIface extends EventTarget {
   #midi = null;
   #outPort = null;
   #inPort = null;
   #inPortAbort = null;
   #ready = Promise.withResolvers();

   log = new Logger("MIDIIface");

   // public interface

   constructor() {
      super();
      this.#init();

      _settings.addEventListener(
         _settings.EVT_PROFILE_CHANGED, this.#onSettingsChange.bind(this));
      _settings.addEventListener("change midi.in",
         this.#onSettingsChange.bind(this));
      _settings.addEventListener("change midi.out",
         this.#onSettingsChange.bind(this));
   }

   get ready() {
      return this.#ready.promise;
   }

   noteOn(note, velocity = 0x7f, channel = 0) {
      this.#sendEvent([MIDI_NOTE_ON | channel, note, velocity]);
   }

   noteOff(note, velocity = 0x7f, channel = 0) {
      this.#sendEvent([MIDI_NOTE_OFF | channel, note, velocity]);
   }

   sendCC(number, data, channel = 0) {
      this.#sendEvent([MIDI_CC | channel, number, data]);
   }

   sendSysEx(payload) {
      this.#sendEvent([SYSEX_START, SYSEX_DEV_ID, ...payload, SYSEX_END]);
   }

   midiEvent(msg) {
      let ev = this.#parseMIDI(msg.data);
      this.dispatchEvent(new CustomEvent(ev.name, {detail: ev}));
   }

   get ports() {
      return {
         in: this.#midi ? this.#midi.inputs || [] : [],
         out: this.#midi ? this.#midi.outputs || [] : [],
      };
   }

   // private interface

   async #init() {
      try {
         this.#midi = await navigator.requestMIDIAccess({"software": true, "sysex": true});
         this.#ready.resolve(true);
         this.log.info(
            "MIDI: sub-system is ready! SysEx supported: " + this.#midi.sysexEnabled);
      } catch (error) {
         _ui.showCriticalError("MIDI is not available", `${error}`, true);
         this.#ready.resolve(false);
      }
   }

   async #onSettingsChange() {
      const cfg = await _settings.get("midi") || {};
      this.#selectPorts(cfg.in, cfg.out);
   }

   #sendEvent(payload) {
      if (this.#outPort)
         this.#outPort.send(payload);
      else
         this.log.warn("MIDI: send data requested, but OUT port is not ready!");
   }

   async #selectPorts(inPort, outPort) {
      await this.ready;

      if (inPort && inPort.id) {
         // if port already selected, do nothing
         if (this.#inPort && inPort.id == this.#inPort.id)
            return;

         this.#disconnectInputPort();
         this.#inPortAbort = new AbortController();
         this.#inPort = this.ports["in"].get(inPort.id);
         if (this.#inPort) {
            this.#inPort.addEventListener("midimessage", this.midiEvent.bind(this),
               { signal: this.#inPortAbort.signal });
            this.log.info(`IN port set to '${this.#inPort.name}'.`);
         }
         else
            this.log.error(`could not find IN port with ID: ${inPort.id}`);
      }
      else {
         if (this.#disconnectInputPort())
            this.log.info("IN port set to null");
      }

      if (outPort && outPort.id) {
         // if port already selected, do nothing
         if (this.#outPort && outPort.id == this.#outPort.id)
            return;

         this.#outPort = this.ports["out"].get(outPort.id);
         if (this.#outPort)
            this.log.info(`OUT port set to '${this.#outPort.name}'.`);
         else
            this.log.error(`could not find OUT port with ID: ${outPort.id}`);
      }
      else if (this.#outPort) {
         this.#outPort = null;
         this.log.info("OUT port set to null");
      }
   }

   #disconnectInputPort() {
      if (this.#inPortAbort == null)
         return false;
      this.#inPortAbort.abort();
      this.#inPortAbort = null;
      this.#inPort = null;
      return true;
   }

   #parseMIDI(data) {
      const event = { status: data[0] };
      const nibble1 = event.status & 0xF0;
      event.noteOn = nibble1 == MIDI_NOTE_ON;
      event.noteOff = nibble1 == MIDI_NOTE_OFF;
      event.cc = nibble1 == MIDI_CC;
      event.sysEx = event.status == SYSEX_START;

      event.name = event.noteOn ? "note-on" :
         event.noteOff ? "note-off" :
         event.cc ? "cc" :
         event.sysEx ? "sysex" : "unknown";

      if (event.noteOn || event.noteOff) {
         event.channel = event.status & 0x0F;
         event.note = data[1] & 0x7F;
         event.velocity = data[2] & 0x7F;
      }
      else if (event.cc) {
         event.number = event.note;
         event.value = event.velocity;
      }
      else if (event.sysEx) {
         event.devId = data[1] % 0x7F;
         event.sysExType = data[2] % 0x7F;
         if (event.sysExType == SYSEX_REQUEST)
            event.operation = data[3] % 0x7F;
         else if (event.sysExType == SYSEX_RESPONSE)
            event.response = data[3] % 0x7F;
      }

      return event;
   }
}
