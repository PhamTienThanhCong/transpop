import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_TTL_MS,
  CROP_DEFAULTS,
  captureTab,
  computeCropBox,
  computeDeviceScale,
  computeScale,
  cropForOcr,
  dropCapture,
  getCapture,
  getCaptureForTab,
  grayscaleContrast,
  pngSize,
  pngSizeFromDataUrl,
} from '../../extension/src/background/capture.js';

/** Bytes of a PNG signature + IHDR for a w×h image (enough for size sniffing). */
function pngHeader(w, h) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
const pngDataUrl = (w, h) => `data:image/png;base64,${Buffer.from(pngHeader(w, h)).toString('base64')}`;

const realNow = Date.now;
const saved = {};
afterEach(() => {
  Date.now = realNow;
  for (const k of Object.keys(saved)) {
    globalThis[k] = saved[k];
    delete saved[k];
  }
});
const stubGlobal = (name, value) => {
  if (!(name in saved)) saved[name] = globalThis[name];
  globalThis[name] = value;
};

/* ---------------- geometry ---------------- */

test('computeDeviceScale: image width / viewport width (height, then 1, as fallbacks)', () => {
  assert.equal(computeDeviceScale({ width: 1280, height: 800 }, { width: 2560, height: 1600 }), 2);
  assert.equal(computeDeviceScale({ width: 0, height: 500 }, { width: 900, height: 900 }), 1.8);
  assert.equal(computeDeviceScale(undefined, { width: 900, height: 900 }), 1);
});

test('computeCropBox: DPR 1 and DPR 2', () => {
  const rect = { x: 10, y: 20, width: 100, height: 50 };
  assert.deepEqual(computeCropBox(rect, { width: 1280, height: 800 }, { width: 1280, height: 800 }), {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    scale: 1,
  });
  assert.deepEqual(computeCropBox(rect, { width: 1280, height: 800 }, { width: 2560, height: 1600 }), {
    x: 20,
    y: 40,
    width: 200,
    height: 100,
    scale: 2,
  });
});

test('computeCropBox: fractional DPR 1.8 rounds outwards without float-noise pixels', () => {
  const viewport = { width: 1000, height: 700 };
  const image = { width: 1800, height: 1260 };
  // 100.5*1.8 = 180.9 → 180, 50.2*1.8 = 90.36 → 90, 300.5*1.8 = 540.9 → 541, 80.2*1.8 = 144.36 → 145
  assert.deepEqual(computeCropBox({ x: 100.5, y: 50.2, width: 200, height: 30 }, viewport, image), {
    x: 180,
    y: 90,
    width: 361,
    height: 55,
    scale: 1.8,
  });
  // 100*1.8 is 180.00000000000003 in floating point: must not become 181 / an extra column
  const box = computeCropBox({ x: 100, y: 100, width: 100, height: 100 }, viewport, image);
  assert.deepEqual([box.x, box.y, box.width, box.height], [180, 180, 180, 180]);
});

test('computeCropBox: clamps to the screenshot, normalizes negative sizes, null when nothing remains', () => {
  const vp = { width: 1280, height: 800 };
  const img = { width: 2560, height: 1600 };
  assert.deepEqual(computeCropBox({ x: -50, y: -10, width: 200, height: 100 }, vp, img), { x: 0, y: 0, width: 300, height: 180, scale: 2 });
  assert.deepEqual(computeCropBox({ x: 1200, y: 700, width: 500, height: 500 }, vp, img), {
    x: 2400,
    y: 1400,
    width: 160,
    height: 200,
    scale: 2,
  });
  // dragged towards the top-left
  assert.deepEqual(computeCropBox({ x: 110, y: 70, width: -100, height: -50 }, vp, img), { x: 20, y: 40, width: 200, height: 100, scale: 2 });
  assert.equal(computeCropBox({ x: 1300, y: 10, width: 50, height: 50 }, vp, img), null, 'entirely outside');
  assert.equal(computeCropBox({ x: 10, y: 10, width: 0, height: 50 }, vp, img), null, 'zero width');
  assert.equal(computeCropBox({ x: 10, y: 10, width: 50, height: 50 }, vp, { width: 0, height: 0 }), null, 'no image');
  assert.deepEqual(computeCropBox({ x: 'a', y: null, width: 10, height: 10 }, vp, img), { x: 0, y: 0, width: 20, height: 20, scale: 2 });
});

test('computeCropBox: page zoom (CSS viewport smaller than the device image)', () => {
  // 150% zoom on a 1280px-wide DPR-1 window → innerWidth 853
  const box = computeCropBox({ x: 100, y: 100, width: 100, height: 20 }, { width: 853, height: 533 }, { width: 1280, height: 800 });
  assert.ok(Math.abs(box.scale - 1280 / 853) < 1e-9);
  assert.deepEqual([box.x, box.y, box.width, box.height], [150, 150, 151, 31]);
});

test('computeScale: upscale small crops towards ~1400px (max 2.5×), keep medium, downscale huge', () => {
  assert.equal(computeScale(300, 40), 2.5, 'capped at 2.5×');
  assert.equal(computeScale(40, 300), 2.5, 'long side may be the height');
  assert.equal(computeScale(700, 100), 2);
  assert.ok(Math.abs(computeScale(999, 120) - 1400 / 999) < 1e-12);
  assert.equal(computeScale(1000, 200), 1);
  assert.equal(computeScale(2400, 1600), 1);
  assert.equal(computeScale(6000, 1000), 0.5, 'longer than 3000px → downscaled');
  assert.equal(computeScale(0, 0), 1);
  assert.equal(computeScale(100, 20, { maxUpscale: 3, targetLongSide: 600 }), 3);
  assert.equal(computeScale(500, 20, { targetLongSide: 400 }), 1, 'never shrinks a small crop');
  assert.equal(CROP_DEFAULTS.maxUpscale, 2.5);
});

test('grayscaleContrast: Rec. 601 luma with mild contrast, opaque output', () => {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 128, 128, 128, 10, 100, 150, 200, 255]);
  grayscaleContrast(px, 1.2);
  assert.deepEqual([...px.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...px.slice(4, 8)], [0, 0, 0, 255]);
  assert.deepEqual([...px.slice(8, 12)], [128, 128, 128, 255]);
  // luma 140.75 → (140.75 - 128) * 1.2 + 128 = 143.3
  assert.deepEqual([...px.slice(12, 16)], [143, 143, 143, 255]);
});

test('pngSize / pngSizeFromDataUrl', () => {
  assert.deepEqual(pngSize(pngHeader(2560, 1600)), { width: 2560, height: 1600 });
  assert.equal(pngSize(new Uint8Array(30)), null);
  assert.deepEqual(pngSizeFromDataUrl(pngDataUrl(1800, 1260)), { width: 1800, height: 1260 });
  assert.equal(pngSizeFromDataUrl('data:image/jpeg;base64,/9j/4AAQ'), null);
  assert.equal(pngSizeFromDataUrl('data:image/png;base64,@@@'), null);
});

/* ---------------- capture store ---------------- */

test('captureTab: PNG of the tab window, stored per tab with a 2-minute TTL', async () => {
  const calls = [];
  const shot = pngDataUrl(2560, 1600);
  stubGlobal('chrome', {
    tabs: {
      captureVisibleTab: async (windowId, opts) => {
        calls.push({ windowId, opts });
        return shot;
      },
    },
  });
  let now = 1_000_000;
  Date.now = () => now;

  const cap = await captureTab({ id: 7, windowId: 3, title: 'Docs' });
  assert.deepEqual(calls, [{ windowId: 3, opts: { format: 'png' } }]);
  assert.equal(cap.dataUrl, shot);
  assert.deepEqual([cap.width, cap.height], [2560, 1600]);
  assert.match(cap.id, /^[0-9a-f-]{36}$/);
  assert.equal(getCapture(cap.id).tabTitle, 'Docs');
  assert.equal(getCaptureForTab(7).id, cap.id);

  const second = await captureTab({ id: 7, windowId: 3 });
  assert.notEqual(second.id, cap.id);
  assert.equal(getCapture(cap.id), null, 'replaced by the next capture of the same tab');

  now += CAPTURE_TTL_MS + 1;
  assert.equal(getCaptureForTab(7), null, 'expired');
  assert.equal(getCapture(second.id), null);

  const third = await captureTab({ id: 8, windowId: 3 });
  dropCapture(8);
  assert.equal(getCapture(third.id), null);
});

test('captureTab: failures map to CAPTURE_FAILED', async () => {
  await assert.rejects(captureTab(undefined), { code: 'CAPTURE_FAILED' });
  stubGlobal('chrome', {
    tabs: {
      captureVisibleTab: async () => {
        throw new Error('Cannot access contents of url "chrome://settings/". Extension manifest must request permission.');
      },
    },
  });
  await assert.rejects(captureTab({ id: 1, windowId: 1 }), (err) => err.code === 'CAPTURE_FAILED' && /chrome:\/\/settings/.test(err.message));
  chrome.tabs.captureVisibleTab = async () => undefined;
  await assert.rejects(captureTab({ id: 1, windowId: 1 }), { code: 'CAPTURE_FAILED' });
});

/* ---------------- crop (with canvas stubs) ---------------- */

function stubCanvas() {
  const log = { drawImage: null, put: 0, closed: 0, size: null };
  stubGlobal('createImageBitmap', async () => ({ width: 2000, height: 1000, close: () => log.closed++ }));
  stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(w, h) {
        log.size = [w, h];
        this.w = w;
        this.h = h;
      }
      getContext() {
        return {
          drawImage: (...args) => {
            log.drawImage = args.slice(1);
          },
          getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
          putImageData: () => log.put++,
        };
      }
      async convertToBlob(opts) {
        log.type = opts.type;
        return new Blob([pngHeader(this.w, this.h)], { type: 'image/png' });
      }
    },
  );
  return log;
}

test('cropForOcr: maps CSS → device px, upscales, grayscales, returns a PNG data: URL', async () => {
  const log = stubCanvas();
  // viewport 1000 CSS px over a 2000 px screenshot = DPR 2; rect 100×20 CSS → 200×40 px → ×2.5 → 500×100
  const out = await cropForOcr(pngDataUrl(2000, 1000), { x: 100, y: 50, width: 100, height: 20 }, { width: 1000, height: 500 });
  assert.deepEqual(log.drawImage, [200, 100, 200, 40, 0, 0, 500, 100]);
  assert.deepEqual(log.size, [500, 100]);
  assert.equal(log.put, 1, 'grayscale applied');
  assert.equal(log.type, 'image/png');
  assert.equal(log.closed, 1, 'bitmap released');
  assert.deepEqual(pngSizeFromDataUrl(out), { width: 500, height: 100 });

  await cropForOcr(pngDataUrl(2000, 1000), { x: 0, y: 0, width: 600, height: 400 }, { width: 1000, height: 500 }, { grayscale: false });
  assert.deepEqual(log.size, [1200, 800], 'large enough: no resize');
  assert.equal(log.put, 1, 'grayscale skipped');
});

test('cropForOcr: empty selection / undecodable screenshot → OCR_FAILED', async () => {
  const log = stubCanvas();
  await assert.rejects(cropForOcr(pngDataUrl(2000, 1000), { x: 5000, y: 0, width: 10, height: 10 }, { width: 1000, height: 500 }), {
    code: 'OCR_FAILED',
  });
  assert.equal(log.closed, 1);
  globalThis.createImageBitmap = async () => {
    throw new Error('The source image could not be decoded.');
  };
  await assert.rejects(cropForOcr(pngDataUrl(10, 10), { x: 0, y: 0, width: 5, height: 5 }, { width: 10, height: 10 }), {
    code: 'OCR_FAILED',
  });
});
