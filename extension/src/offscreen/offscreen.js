/**
 * TransPop — offscreen document (one per extension, shared by TTS and OCR; created by background/offscreen-doc.js
 * with reasons AUDIO_PLAYBACK + WORKERS).
 * Messages (from the service worker, `target: 'offscreen'` only):
 *   { type: 'offscreen-play', urls: string[] | url: string, rate } → { ok: true } once the first chunk
 *       starts playing, { ok: false, error } if it can't be played (the SW then falls back to chrome.tts)
 *   { type: 'offscreen-stop' } → { ok: true }
 *   { type: 'offscreen-ocr', dataUrl, langs } → { ok: true, ocr: OcrResult } | { ok: false, error: { code, message } }
 *   { type: 'offscreen-ocr-clear' } → { ok: true } after the Tesseract worker is stopped and its language data deleted
 *
 * The document closes itself after IDLE_CLOSE_MS without audio or OCR (the WORKERS reason would otherwise keep it, and
 * the OCR worker's memory, alive for the whole session); the service worker recreates it on the next request.
 */
import { MSG, LIMITS } from '../shared/constants.js';
import { serializeError } from '../shared/messaging.js';
import { clearCache, getStatus, recognize } from './ocr-engine.js';

const TTS_PREFIX = 'https://translate.google.com/translate_tts?';
const IDLE_CLOSE_MS = 5 * 60_000;

let idleCloseTimer = null;
let ocrJobs = 0;

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

/* ------------------------------------------------------------------ */
/* Idle self-close                                                     */
/* ------------------------------------------------------------------ */

function touch() {
  clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(closeIfIdle, IDLE_CLOSE_MS);
}

function closeIfIdle() {
  if (current || ocrJobs > 0 || getStatus().busy) {
    touch();
    return;
  }
  window.close();
}

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */

/** Run an OCR task and answer with an envelope; keeps the document alive while it runs. */
function answerOcr(task, sendResponse) {
  ocrJobs++;
  Promise.resolve()
    .then(task)
    .then(
      (data) => sendResponse({ ok: true, ...data }),
      (err) => sendResponse({ ok: false, error: serializeError(err) }),
    )
    .finally(() => {
      ocrJobs--;
      touch();
    });
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  touch();

  if (message.type === MSG.OFFSCREEN_OCR) {
    const { dataUrl, langs } = message;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      sendResponse({ ok: false, error: { code: 'OCR_FAILED', message: 'Not an image' } });
      return false;
    }
    return answerOcr(async () => ({ ocr: await recognize(dataUrl, Array.isArray(langs) ? langs : undefined) }), sendResponse);
  }

  if (message.type === MSG.OFFSCREEN_OCR_CLEAR) {
    return answerOcr(async () => {
      await clearCache();
      return {};
    }, sendResponse);
  }

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

// Close even if no message ever arrives (e.g. the service worker went away right after creating the document).
touch();
