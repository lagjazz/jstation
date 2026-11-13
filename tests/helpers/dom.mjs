// Minimal DOM stand-in so modules that build procedural canvas textures
// (js/textures.js) can be imported under node. Every 2D-context call is
// a no-op; three.js only stores the "canvas" object on the texture.
const noop = () => {};
const grad = () => ({ addColorStop: noop });
const ctx2d = new Proxy({}, {
  get(_t, k) {
    if (typeof k === 'symbol') return undefined;
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return grad;
    if (k === 'getImageData' || k === 'createImageData') return (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'measureText') return () => ({ width: 10 });
    return noop;
  },
  set: () => true,
});
if (!globalThis.document) {
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }),
    getElementById: () => null,
  };
}
