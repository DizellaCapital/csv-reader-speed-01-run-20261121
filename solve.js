// Fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly
// csv-reader's {columns, rows, errors} for an input {text, header}.
//
// Written from the RULES.txt spec, not a copy of the reference: single pass,
// left to right, commas and double quotes. A U+FEFF at the very start is
// dropped; a record ends at LF or CRLF; a line left with no characters is no
// record; outside quotes a CR not followed by LF is dropped (stray_cr); a
// field opening with a quote runs to the next undoubled quote, "" inside is
// one quote, each CRLF or lone CR inside is read as LF, what follows the
// closing quote up to the next comma or line break is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a literal
// and the text after it is read again as unquoted (unterminated_quote); a
// quote inside an unquoted field is a literal; fields stay strings; columns
// is the first record when header is true, else null; rows are padded with ""
// (short_row, with fields: its count) or cut (long_row, with extra: the cut
// fields) to the first record's width; each error is {code, line, row} in the
// order met, line the 1-based line its record starts on, row its record's
// index in rows (null for the header).
//
// Speed: scanning is indexOf/charCodeAt based (no regex, no split); fields
// are single slices in the common case, and the next CR / LF positions are
// cached so no scan ever re-walks ground already covered. Quoted fields with
// no escapes and no line breaks inside are one slice as well.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // Next CR / LF at or after pos, cached: -2 unknown, -1 none left in the
  // text, else the index. pos only moves forward (except the
  // unterminated-quote reset, which clears both caches), so a cached index
  // stays the first such character at or after pos, and every indexOf scan
  // for CR/LF only ever walks new ground.
  let crPos = -2;
  let lfPos = -2;

  function ensureCR() {
    if (crPos === -2 || (crPos !== -1 && crPos < pos)) crPos = text.indexOf('\r', pos);
  }
  function ensureLF() {
    if (lfPos === -2 || (lfPos !== -1 && lfPos < pos)) lfPos = text.indexOf('\n', pos);
  }

  // The record being read: the line it starts on, and the index in rows it
  // takes (null for the header). Errors report these two.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, and how it ended (0 comma, 1 line break,
  // 2 end of text).
  let fValue = '';
  let fEnded = 0;

  // Reads an unquoted field at pos, starting from `init` (a string already
  // in the value, or null for an empty start). Sets fValue/fEnded. Returns
  // the number of characters kept (for quote_junk).
  function readUnquoted(init) {
    const initLen = init === null ? 0 : init.length;
    let acc = init;
    let seg = pos;
    for (;;) {
      ensureCR();
      ensureLF();
      const ci = text.indexOf(',', pos);
      let e = -1;
      let k = -1;
      if (ci !== -1) { e = ci; k = 0; }
      if (lfPos !== -1 && (e === -1 || lfPos < e)) { e = lfPos; k = 1; }
      if (crPos !== -1 && (e === -1 || crPos < e)) { e = crPos; k = 2; }
      if (e === -1) {
        fValue = acc === null ? text.slice(seg) : acc + text.slice(seg);
        pos = n;
        fEnded = 2;
        return fValue.length - initLen;
      }
      if (k === 2 && text.charCodeAt(e + 1) !== 10) {
        // A CR not followed by LF is dropped (stray_cr); the field goes on.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        acc = acc === null ? text.slice(seg, e) : acc + text.slice(seg, e);
        pos = e + 1;
        seg = pos;
        continue;
      }
      fValue = acc === null ? text.slice(seg, e) : acc + text.slice(seg, e);
      if (k === 0) { pos = e + 1; fEnded = 0; }
      else if (k === 1) { pos = e + 1; line += 1; fEnded = 1; }
      else { pos = e + 2; line += 1; fEnded = 1; }
      return fValue.length - initLen;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue/fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let acc = null;
    let seg = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        crPos = -2;
        lfPos = -2;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      ensureCR();
      ensureLF();
      if (lfPos !== -1 && lfPos < q || crPos !== -1 && crPos < q) {
        // Line breaks inside the quoted region each become one LF.
        let p = pos;
        for (;;) {
          const ni = text.indexOf('\n', p);
          const ri = text.indexOf('\r', p);
          let b = -1;
          let isCR = false;
          if (ri !== -1 && ri < q && (ni === -1 || ri < ni)) { b = ri; isCR = true; }
          else if (ni !== -1 && ni < q) { b = ni; }
          if (b === -1) break;
          acc = acc === null ? text.slice(seg, b) : acc + text.slice(seg, b);
          acc += '\n';
          line += 1;
          p = b + 1;
          if (isCR && text.charCodeAt(p) === 10) p += 1;
          seg = p;
        }
        pos = q;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one quote in the value, and the field goes on.
        acc = acc === null ? text.slice(seg, q) + '"' : acc + text.slice(seg, q) + '"';
        pos = q + 2;
        seg = pos;
        continue;
      }
      // Closing quote.
      fValue = acc === null ? text.slice(seg, q) : acc + text.slice(seg, q);
      pos = q + 1;
      if (pos >= n) { fEnded = 2; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; fEnded = 0; return; }
      if (c === 10) { pos += 1; line += 1; fEnded = 1; return; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fEnded = 1; return; }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const added = readUnquoted(fValue);
      if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) { lastQuoted = true; readQuoted(); }
      else { lastQuoted = false; readUnquoted(null); }
      fields.push(fValue);
      if (fEnded !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
