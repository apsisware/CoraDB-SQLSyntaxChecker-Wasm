// CoraDB-SQLSyntaxChecker-Wasm — is this valid CoraDB SQL?
//
// The engine's own grammar and lexer (src/parser/corasql_grammar.y and
// corasql_lexer.l), with nothing built from what they read, compiled to
// WebAssembly. Runs in the browser and in Node 18+, needs no server and no
// connection, and answers exactly as the engine's parser would: accepted, or
// where it stopped and why. Whether the tables and columns exist is not
// something a grammar knows — that needs the database.

/** The server settings that change how SQL is read, at the engine's defaults. */
export const DEFAULT_SETTINGS = Object.freeze({
  ansiQuotes: true,
  noBackslashEscapes: true,
  pipesAsConcat: true,
});

/**
 * Compile a checker from the module's bytes.
 *
 * The module was built against WASI for the C library's sake, but it never
 * reads or writes anything: the six system calls it imports get do-nothing
 * stand-ins, so it runs anywhere WebAssembly does.
 *
 * @param {BufferSource} bytes the contents of coradb-sqlsyntaxchecker.wasm
 * @returns {Promise<import('./index').SqlChecker>}
 */
export async function createSqlChecker(bytes) {
  let memory = null;
  const wasi = {
    fd_write: (_fd, _iovs, _n, written) => {
      if (memory) new DataView(memory.buffer).setUint32(written, 0, true);
      return 0;
    },
    fd_close: () => 0,
    fd_fdstat_get: () => 0,
    fd_read: () => 0,
    fd_seek: () => 0,
    proc_exit: (code) => {
      throw new Error(`The SQL checker stopped (${code}).`);
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi });
  const x = instance.exports;
  memory = x.memory;
  x._initialize();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const cString = (ptr) => {
    const all = new Uint8Array(x.memory.buffer);
    let end = ptr;
    while (all[end] !== 0) end += 1;
    return decoder.decode(all.subarray(ptr, end));
  };
  let applied = '';

  return {
    check(sql, settings = DEFAULT_SETTINGS) {
      if (typeof sql !== 'string') throw new TypeError('check() takes the SQL as a string.');
      const s = { ...DEFAULT_SETTINGS, ...settings };
      const key = `${+s.ansiQuotes}${+s.noBackslashEscapes}${+s.pipesAsConcat}`;
      if (key !== applied) {
        x.check_set(+s.ansiQuotes, +s.noBackslashEscapes, +s.pipesAsConcat);
        applied = key;
      }
      const bytesIn = encoder.encode(sql);
      const ptr = x.check_alloc(bytesIn.length);
      if (ptr === 0) throw new Error('The SQL checker is out of memory.');
      try {
        new Uint8Array(x.memory.buffer).set(bytesIn, ptr);
        if (x.check_sql(ptr, bytesIn.length) === 0) return null;
        return locate(sql, bytesIn, {
          byteOffset: x.check_offset(),
          message: cString(x.check_message()),
          token: cString(x.check_token()),
        });
      } finally {
        x.check_free(ptr);
      }
    },
  };
}

let loaded = null;

/**
 * The checker, loaded once.
 *
 * With no argument the module next to this file is used: read from disk in
 * Node, fetched in the browser (bundlers such as Vite and webpack copy it
 * along, since it is named with `new URL(…, import.meta.url)`). Pass a URL,
 * a path, or the bytes to load it from somewhere else.
 *
 * @param {URL | string | BufferSource} [source]
 */
export function loadSqlChecker(source) {
  if (source !== undefined) return readBytes(source).then(createSqlChecker);
  if (!loaded) {
    loaded = readBytes(new URL('./coradb-sqlsyntaxchecker.wasm', import.meta.url))
      .then(createSqlChecker)
      .catch((err) => {
        loaded = null; // the next call tries again
        throw err;
      });
  }
  return loaded;
}

/**
 * Check SQL in one call: one statement, or a script of them separated by
 * semicolons (the first error stops it, as it does the engine).
 *
 * @param {string} sql
 * @param {Partial<typeof DEFAULT_SETTINGS>} [settings]
 */
export async function checkSql(sql, settings) {
  return (await loadSqlChecker()).check(sql, settings);
}

const inNode = typeof process !== 'undefined' && !!process.versions?.node;

/**
 * Node's fs, reached so that browser bundlers do not try to pack it:
 * process.getBuiltinModule where Node has it (22.3+), otherwise an import by
 * a name only known at run time.
 */
async function nodeFs() {
  const builtin = globalThis.process?.getBuiltinModule?.('node:fs/promises');
  if (builtin) return builtin;
  const name = 'node:fs/promises';
  return import(/* @vite-ignore */ /* webpackIgnore: true */ name);
}

/** A path or URL, as what to read it with: a file path in Node, a URL anywhere else. */
function where(source) {
  if (source instanceof URL) return source;
  const windowsPath = /^[a-z]:[\\/]/i.test(source);
  if (!windowsPath && /^[a-z][a-z0-9+.-]*:/i.test(source)) return new URL(source);
  if (inNode) return null; // a file path
  return new URL(source, globalThis.location?.href);
}

async function readBytes(source) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source;
  const url = where(source);
  if (url === null || url.protocol === 'file:') {
    return (await nodeFs()).readFile(url ?? source);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The SQL checker could not be loaded from ${url} (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

// --- where the error is, and what to say about it -----------------------------

/** The character offset of a byte offset into the UTF-8 form of `text`. */
export function charOffset(text, byteOffset) {
  let bytes = 0;
  let i = 0;
  while (i < text.length && bytes < byteOffset) {
    const cp = text.codePointAt(i) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

/** 1-based line and column (in characters) of an offset. */
function lineColumn(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line += 1;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Where a string or quoted name that is never closed opens: the last quote
 * the text leaves open, outside comments.
 */
function openQuote(text) {
  const n = text.length;
  for (let i = 0; i < n; ) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === '-' && next === '-') || (ch === '/' && next === '/')) {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) return i;
      i = j;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** Add where in the text the error is, in characters, and how much of it to mark. */
function locate(sql, bytes, raw) {
  let offset = charOffset(sql, Math.min(raw.byteOffset, bytes.length));
  let length = Math.max(1, raw.token.length);
  if (/unterminated/i.test(raw.message)) {
    // The lexer only finds out at the end of the text: mark from the quote
    // that was left open to the end of its line.
    const quote = openQuote(sql);
    if (quote >= 0) offset = quote;
    const nl = sql.indexOf('\n', offset);
    length = (nl < 0 ? sql.length : nl) - offset;
  } else if (raw.token === '' || offset >= sql.length) {
    // At the end of the text: the last thing there is.
    const end = sql.replace(/\s+$/, '').length;
    offset = Math.max(0, end - 1);
    length = end > 0 ? 1 : 0;
  }
  length = Math.max(0, Math.min(length, sql.length - offset));
  return { ...lineColumn(sql, offset), offset, length, message: raw.message, token: raw.token };
}

const TOKEN_WORDS = {
  IdName: 'a name',
  'end of file': 'the end of the statement',
  'end of input': 'the end of the statement',
  UNSIGNED_INTEGER: 'a number',
  UNSIGNED_REAL: 'a number',
  CHAR_STRING: 'a string',
  NCHAR_STRING: 'a string',
  BIT_STRING: 'a bit string',
  HEX_STRING: 'a hex string',
  BINARY_STRING: 'a string',
  EUCKR_STRING: 'a string',
  ISO_STRING: 'a string',
  UTF8_STRING: 'a string',
  PARAM_HEADER: 'a parameter',
};

/** One of the grammar's token names as a person would say it (DELETE_ → DELETE, IdName → a name). */
export function tokenWords(name) {
  if (TOKEN_WORDS[name]) return TOKEN_WORDS[name];
  const quoted = /^'(.+)'$/.exec(name);
  if (quoted) return quoted[1];
  return name.replace(/_+$/, '').replace(/_/g, ' ');
}

/**
 * The error in words: `syntax error, unexpected FROM, expecting ')'` becomes
 * `Syntax error: unexpected "from". Expected ).`
 *
 * @param {import('./index').SqlSyntaxError} err
 */
export function describeError(err) {
  const m = err.message;
  if (/unterminated string/i.test(m)) return 'This string is never closed.';
  if (/unterminated identifier/i.test(m)) return 'This quoted name is never closed.';
  const parsed = /unexpected ([^,]+?)(?:, expecting (.+))?$/.exec(m);
  if (!parsed) return m.charAt(0).toUpperCase() + m.slice(1);
  const typed = err.token.trim();
  const unexpected = typed !== '' ? `"${typed.length > 40 ? `${typed.slice(0, 40)}…` : typed}"` : tokenWords(parsed[1]);
  let text = `Syntax error: unexpected ${unexpected}.`;
  // "{" (the ODBC escape the grammar also allows) is never what anybody
  // meant, and the engine's internal tokens are nobody's to type.
  const wanted = (parsed[2] ?? '')
    .split(' or ')
    .filter((t) => t !== '' && t !== "'{'" && t !== "'}'" && !/__/.test(t))
    .map(tokenWords);
  if (wanted.length > 0) {
    const list = wanted.length === 1 ? wanted[0] : `${wanted.slice(0, -1).join(', ')} or ${wanted[wanted.length - 1]}`;
    text += ` Expected ${list}.`;
  }
  return text;
}
