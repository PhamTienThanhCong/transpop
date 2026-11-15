/**
 * TransPop — offscreen document: plays Google TTS audio chunks sequentially.
 * Messages (from the service worker, `target: 'offscreen'` only):
 *   { type: 'offscreen-play', urls: string[] | url: string, rate } → { ok: true } once the first chunk
 *       starts playing, { ok: false, error } if it can't be played (the SW then falls back to chrome.tts)
 *   { type: 'offscreen-stop' } → { ok: true }
 */
import { MSG, LIMITS } from '../shared/constants.js';

const TTS_PREFIX = 'https://translate.google.com/translate_tts?';

let session = 0;
let current = null; // { audio, reject }

const clampRate = (rate) => {
  const r = Number(rate);
  return Number.isFinite(r) ? Math.min(LIMITS.SPEECH_RATE_MAX, Math.max(LIMITS.SPEECH_RATE_MIN, r)) : 1;
};

function createAudio(url, rate) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  audio.src = url;
  return audio;
}

function release(audio) {
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch {
    /* ignore */
  }
}

function stopPlayback() {
  session++;
  if (current) {
    const { audio, reject } = current;
    current = null;
    release(audio);
    reject(new Error('stopped'));
  }
}

/** Play one element; resolves on `ended`, calls onStart once playback begins. */
function playAudio(audio, rate, onStart) {
  return new Promise((resolve, reject) => {
    current = { audio, reject };
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error(`Audio error ${audio.error?.code ?? ''}`.trim()));
    audio
      .play()
      .then(() => {
        audio.playbackRate = rate; // some engines reset it on load
        onStart();
      })
      .catch(reject);
  });
}

/** Play urls in order. Resolves when the first chunk starts; rejects if the first chunk fails. */
function play(urls, rate) {
  stopPlayback();
  const mySession = session;
  return new Promise((resolveStart, rejectStart) => {
    let started = false;
    const markStarted = () => {
      if (!started) {
        started = true;
        resolveStart();
      }
    };
    (async () => {
      let next = createAudio(urls[0], rate);
      for (let i = 0; i < urls.length; i++) {
        if (mySession !== session) return;
        const audio = next;
        // Preload the following chunk while this one plays, to avoid gaps.
        next = i + 1 < urls.length ? createAudio(urls[i + 1], rate) : null;
        try {
          await playAudio(audio, rate, markStarted);
        } catch (err) {
          if (next) release(next);
          if (mySession !== session) markStarted(); // stopped / superseded: not a playback failure
          else if (!started) rejectStart(err);
          return;
        } finally {
          if (current?.audio === audio) current = null;
        }
      }
      markStarted();
    })();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;
  if (sender?.id && sender.id !== chrome.runtime.id) return false;

  if (message.type === MSG.OFFSCREEN_PLAY) {
    const list = Array.isArray(message.urls) ? message.urls : message.url ? [message.url] : [];
    const urls = list.filter((u) => typeof u === 'string' && u.startsWith(TTS_PREFIX));
    if (!urls.length) {
      sendResponse({ ok: false, error: { code: 'UNKNOWN', message: 'No playable audio' } });
      return false;
    }
    play(urls, clampRate(message.rate)).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: { code: 'NETWORK', message: String(err?.message || err) } }),
    );
    return true;
  }

  if (message.type === MSG.OFFSCREEN_STOP) {
    stopPlayback();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
