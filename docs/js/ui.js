class UIManager {
   log = new Logger("UI");

   #activeArea = null;
   #container = null;
   #topBarHeight = 0;

   // public interface

   constructor(containerId, defaultArea = "pads") {
      this.#container = $(`#${containerId}`);
      this.switchArea(defaultArea);

      // setup the color pickers
      (async () => {
         Coloris({
            alpha: false,
            theme: "pill",
            formatToggle: true,
            closeButton: true,
            clearButton: true,
            focusInput: false,
            selectInput: false,
            swatches: [
               '#067bc2',
               '#84bcda',
               '#80e377',
               '#ecc30b',
               '#f37748',
               '#d56062'
            ]
         });
      })();
   }

   switchArea(name) {
      if (this.#activeArea == name)
         return;
      this.#container.find("#app-bar button.active").removeClass("active");
      this.#container.find(`#show-${name}-button`).addClass("active");
      this.#container.find('.app-area').hide();
      this.#container.find(`#${name}-area`).show();
      this.#activeArea = name;

      this.log.debug(`switch to area '${name}'`);
   }

   toggleTopBar() {
      let bar = $('#app-bar');
      let offset = bar.is(":visible") ? -(bar.height() + 10) : 0;
      let cont = this.#container[0];

      if (this.#topBarHeight == 0)
         this.#topBarHeight = getComputedStyle(cont).getPropertyValue("--top-bar-h");

      // animate top bar in/out movement
      bar.show();
      anime({
         targets: bar[0],
         translateY: offset,
         duration: 300,
         complete: offset ? bar.toggle.bind(bar) : null,
      });

      const cssVar = {
         height: this.#topBarHeight
      };

      // animate area grow/shrink
      anime({
         targets: cssVar,
         height: offset ? [cssVar.height, 0] : [0, cssVar.height],
         duration: 100,
         easing: 'linear',
         update: () => {
            cont.style.setProperty("--top-bar-h", cssVar.height);
         },
      });
   }

   createButtonGrid(opts) {
      const buttons = [];

      if (opts.cssClass && opts.cssClass.call === undefined) {
         const cssClass = opts.cssClass;
         opts.cssClass = () => cssClass;
      }
      if (opts.label && opts.label.call === undefined)
         opts.label = (col, row) => row * opts.cols + col;

      const container = $(`#${opts.containerId}`);
      if (opts.columnSizes == undefined)
         opts.columnSizes = `repeat(${opts.cols}, 1fr)`;
      container.css({
         "display": "grid",
         "grid-template-columns": opts.columnSizes,
      });

      const elem = opts.elemType ? opts.elemType : "button";
      const close = elem == "button" ? "</button>" : "";
      for (let i=opts.rows-1; i>=0; i--) {
         for (let j=0; j<opts.cols; j++) {
            const css = opts.cssClass(j, i);
            const label = opts.label ? `${opts.label(j, i)}` : "";
            const id = opts.btnId ? `id="${opts.btnId(j, i)}"` : "";
            const attrs = opts.attributes ? opts.attributes(j, i) : "";
            const labelSpan = label != "" ? `<span>${label}</span>` : "";
            const index = opts.index ? opts.index(j, i) : i * opts.cols + j;
            const btn = $(`
               <${elem} ${id} tabindex="-1" btn-index="${index}" class="${css}" ${attrs}>
                  ${labelSpan}${close}
            `);
            if (elem == "button")
               btn.attr("type", "button");
            if (opts.onPress)
               btn.on("pointerdown", (ev) => {
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                  opts.onPress({col: j, row: i, label: label, index: index});
                  btn.addClass("active");
               });
            if (opts.onRelease)
               btn.on("pointerup", () => {
                  opts.onRelease({col: j, row: i, label: label, index: index});
                  btn.removeClass("active");
               });
            for (let ev in opts.events || {}) {
               const cb = opts.events[ev];
               btn.on(ev, cb);
            }
            container.append(btn);
            buttons.push(btn);
         }
      }
      return buttons;
   }

   showUndoMsg(elemId, msg, rollbackFn) {
      const container = $(`#${elemId}`);
      container.empty();
      const undoBtn = $('<a href="#"> UNDO </a>');
      undoBtn.on("click", async () => {
         if (await rollbackFn())
            container.hide();
      });
      const closeBtn = $('<button><i class="fa-solid fa-fw fa-lg fa-times"></i></button>');
      closeBtn.on("click", () => {
         container.hide();
      });
      container.append(closeBtn);
      container.append(`<span>${msg}</span>`);
      container.append(undoBtn);
      container.show();
   }

   showCriticalError(title, details, dismissable=true) {
      // TODO: implement a GUI dialog
      this.log.error(title);
      if (!dismissable)
         document.write(title);
   }

   repeatUntileRelease(opts) {
      opts.interval = opts.interval || 50;

      let delay = 500;
      const callWithDelay = () => {
         if (delay > opts.interval) {
            delay -= opts.interval;
            return;
         }
         opts.repeat();
      };

      const intervalId = setInterval(callWithDelay, opts.interval);
      const handler = () => {
         opts.target.off("pointerup pointerleave", handler);
         clearInterval(intervalId);
         opts.release ? opts.release() : null;
      };
      opts.target.on("pointerup pointerleave", handler);
   }

   handleActiveClass(elemId) {
      const elem = $(elemId);
      elem.on("pointerdown", () => elem.addClass("active"));
      elem.on("pointerup", () => elem.removeClass("active"));
   }

   stopAnimations(elem) {
      elem.getAnimations().forEach((anim) => {
          anim.cancel();
      });
   }

   syncAnimations(elem) {
      elem.getAnimations({subtree: true}).forEach((anim) => {
          anim.cancel();
          anim.play();
      });
   }
}

class SliderControl {
   #container;
   #minValue;
   #maxValue;
   #onChange;

   #startX = 0;
   #pointerId = 0;

   constructor({ container, min = 0, max = 127, onChange = null, initial = 63 } = {}) {
      this.#container = container;
      this.#minValue = min;
      this.#maxValue = max;
      this.#onChange = onChange;

      this.value = initial;

      this.#container.on("pointerdown", this.#onPointerDown.bind(this));
      this.#container.on("pointerup", this.#onPointerUp.bind(this));
   }

   #onPointerDown(event) {
      event.currentTarget.setPointerCapture(event.pointerId);
      this.#startX = event.clientX;
      this.#pointerId = event.pointerId;
      $(document).on("pointermove", this.#onPointerMove.bind(this));
      this.#container.addClass("active");
      event.stopPropagation();
   }

   #onPointerMove(event) {
      if (event.pointerId != this.#pointerId)
         return;
      const displacement = (event.clientX - this.#startX) * 0.5;
      const newValue = Math.round(clamp(
         this.#minValue, this.value + displacement, this.#maxValue));

      if (this.value != newValue) {
         this.value = newValue;
         this.#onChange ? this.#onChange(newValue) : null;
         this.#startX = event.clientX;
      }
   }

   #onPointerUp(event) {
      event.stopPropagation();
      $(document).off("pointermove");
      this.#container.removeClass("active");
   }
}
