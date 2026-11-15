/**
 * TransPop popup — CSV export helpers (ES module). The builders are pure (Node-testable);
 * only downloadText() touches the DOM.
 */

/** UTF-8 byte order mark so Excel / Anki detect the encoding correctly. */
export const CSV_BOM = '﻿';

/** Escape one CSV cell (RFC 4180) and neutralise spreadsheet formula injection. */
export function csvCell(value) {
  let s = value === undefined || value === null ? '' : String(value);
  // Cells starting with = + @ (or - followed by a non-letter, e.g. "-1+2") are evaluated as formulas by spreadsheets.
  if (/^[=+@\t\r]/.test(s) || /^-[^\s\p{L}]/u.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: Array<Array<unknown>> → CSV string with BOM and CRLF line endings. */
export function toCsv(rows) {
  return `${CSV_BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD HH:mm" (spreadsheet-friendly). */
export function formatCsvDate(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CSV_COLUMNS = Object.freeze(['text', 'translation', 'from', 'to', 'date']);

/** Favorites (Entry[]) → CSV with columns text, translation, from, to, date. */
export function entriesToCsv(entries) {
  return toCsv([
    CSV_COLUMNS,
    ...(Array.isArray(entries) ? entries : []).map((e) => [e?.text, e?.translation, e?.from, e?.to, formatCsvDate(e?.ts)]),
  ]);
}

/** e.g. "transpop-favorites-2026-11-15.csv" */
export function csvFileName(kind, date = new Date()) {
  return `transpop-${kind}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** Trigger a download of `text` via Blob + <a download> (no `downloads` permission needed). */
export function downloadText(text, filename, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
