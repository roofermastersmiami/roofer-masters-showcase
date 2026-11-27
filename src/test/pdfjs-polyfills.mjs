/**
 * Polyfills for the pdf.js worker realm, imported first by
 * pdfjs-worker.mjs. See that file for why these are needed (pdf.js 6
 * uses stage-4 APIs that Node 22.12 — the CI runtime — does not have,
 * and the worker's realm is separate from the test's main thread).
 */
const uint8Proto = Object.getPrototypeOf(Uint8Array.prototype);
if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(uint8Proto, "toHex", {
    value: function toHex() {
      return [...this].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  });
}
if (typeof Uint8Array.prototype.toBase64 !== "function") {
  Object.defineProperty(uint8Proto, "toBase64", {
    value: function toBase64() {
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
  });
}
const patchUpsert = (proto, has, get, set) => {
  if (typeof proto.getOrInsertComputed === "function") return;
  proto.getOrInsertComputed = function (key, fn) {
    if (!has.call(this, key)) set.call(this, key, fn(key));
    return get.call(this, key);
  };
  proto.getOrInsert = function (key, value) {
    if (!has.call(this, key)) set.call(this, key, value);
    return get.call(this, key);
  };
};
patchUpsert(Map.prototype, Map.prototype.has, Map.prototype.get, Map.prototype.set);
patchUpsert(WeakMap.prototype, WeakMap.prototype.has, WeakMap.prototype.get, WeakMap.prototype.set);
if (typeof Uint8Array.fromBase64 !== "function") {
  Uint8Array.fromBase64 = (base64) => {
    const binary = atob(base64.replace(/\s/g, ""));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  };
}
if (typeof Uint8Array.fromHex !== "function") {
  Uint8Array.fromHex = (hex) => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
}
if (typeof Promise.try !== "function") {
  Promise.try = (fn, ...args) => new Promise((resolve) => resolve(fn(...args)));
}
if (typeof Math.sumPrecise !== "function") {
  // Neumaier compensated summation — close enough for pdf.js's internal
  // metrics; the spec version only differs in last-bit rounding.
  Object.defineProperty(Math, "sumPrecise", {
    value: (items) => {
      let sum = 0;
      let compensation = 0;
      for (const value of items) {
        const next = sum + value;
        if (Math.abs(sum) >= Math.abs(value)) {
          compensation += sum - next + value;
        } else {
          compensation += value - next + sum;
        }
        sum = next;
      }
      return sum + compensation;
    },
  });
}
