_ = console.info.bind(console);

function clamp(min, val, max) {
   return Math.min(max, Math.max(min, val));
}

function lerp(a, b, alpha) {
   return a + alpha * (b - a);
}

function flattenObject(obj) {
   return Object.fromEntries(
      Object.entries(obj).flatMap(([key, value]) =>
         typeof value === 'object' && value !== null
            ? Object.entries(value).map(([k, v]) => [`${key}.${k}`, v])
            : [[key, value]]
      )
   );
}

async function sleep(amount) {
   return new Promise((resolve) => setTimeout(resolve, amount));
}

function getWithDef(obj, prop, def) {
   const retval = obj[prop];
   return retval === undefined || retval === null ? def : retval;
}

class Logger {
   #name = "";
   #view = null;

   constructor(name) {
      this.#name = name;
      this.#view = $("#log-view");
   }

   installGlobalHandlers() {
      window.addEventListener("error", (e) => {
         const file = e.filename.replace(/^(?:https?:\/\/)?[^\/]+/, '');
         this.error(`unhandled error: ${e.message} [${file}:${e.lineno}]`);
         e.preventDefault();
      });

      window.addEventListener('unhandledrejection', (e) => {
         reportError(e.reason);
         e.preventDefault();
      });
   }

   async debug(msg) {
      console.debug(`[${this.#name}]: ${msg}`);
      this.#view.append(` D|${this.#name}: ${msg}\n`);
   }

   async info(msg) {
      console.info(`[${this.#name}]: ${msg}`);
      this.#view.append(` I|${this.#name}: ${msg}\n`);
   }

   async warn(msg) {
      console.warn(`[${this.#name}]: ${msg}`);
      this.#view.append(`-W|${this.#name}: ${msg}\n`);
   }

   async error(msg) {
      console.error(`[${this.#name}]: ${msg}`);
      this.#view.append(`#E|${this.#name}: ${msg}\n`);
   }
}

_syslog = new Logger("System")
_syslog.installGlobalHandlers();
