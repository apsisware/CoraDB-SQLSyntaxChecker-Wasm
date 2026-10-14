# Installing CoraDB-SQLSyntaxChecker-Wasm in another app

CoraDB-SQLSyntaxChecker-Wasm (npm package `coradb-sqlsyntaxchecker-wasm`) checks whether text is valid CoraDB SQL, offline, using the
engine's own grammar and lexer compiled to WebAssembly. It runs in browsers and
in Node 18+, and needs no server and no database connection.

The package is handed over as one file:

```
D:\GitHub\arnia\CoraDB-SQLSyntaxChecker-Wasm\coradb-sqlsyntaxchecker-wasm-0.1.0.tgz      (about 160 KB)
```

It contains `index.js`, `index.d.ts` (TypeScript types), `coradb-sqlsyntaxchecker.wasm`,
`build-info.json`, `README.md`, `LICENSE` and `NOTICE`. It has no dependencies.

## 1. JavaScript / TypeScript apps (Node, React, Vite, webpack…)

1. Copy the `.tgz` into the other project, for example into a `vendor` folder.
2. Install it from there:

   ```bash
   npm install ./vendor/coradb-sqlsyntaxchecker-wasm-0.1.0.tgz
   ```

   npm records it in `package.json` as
   `"coradb-sqlsyntaxchecker-wasm": "file:vendor/coradb-sqlsyntaxchecker-wasm-0.1.0.tgz"`.
   Commit the `.tgz` together with the project, so that every machine that
   installs it gets exactly the same file — no network or registry is needed.

3. Use it:

   ```js
   import { checkSql, describeError } from 'coradb-sqlsyntaxchecker-wasm';

   const err = await checkSql(sqlText);
   if (err) {
     alert(`Error at line ${err.line}, column ${err.column}: ${describeError(err)}`);
   }
   ```

In a browser app, Vite and webpack copy `coradb-sqlsyntaxchecker.wasm` into the build on
their own; nothing else has to be set up.

### Checking many times

Load the checker once and reuse it; each check of a typical statement takes a
fraction of a millisecond:

```js
import { loadSqlChecker, describeError } from 'coradb-sqlsyntaxchecker-wasm';

const checker = await loadSqlChecker();
const err = checker.check('select count(* from t');   // null when valid
```

`check()` takes one statement, or a script of statements separated by
semicolons; the first error stops it, as it does the engine.

### What an error contains

| Field | Meaning |
|---|---|
| `line`, `column` | 1-based position, in characters |
| `offset`, `length` | the part of the text to highlight (the token, or an unclosed quote to the end of its line) |
| `token` | the text the parser stopped at; `''` at the end of the text |
| `message` | the parser's own words, e.g. `syntax error, unexpected FROM, expecting ')'` |

`describeError(err)` turns it into a sentence for people, for example
`Syntax error: unexpected "from". Expected ).` or `This string is never closed.`

### Server settings

Three server parameters change how SQL is read. The checker uses the engine's
defaults (all on); pass the server's own values when they differ:

```js
checker.check(sql, { ansiQuotes: true, noBackslashEscapes: true, pipesAsConcat: false });
```

| Option | Server parameter |
|---|---|
| `ansiQuotes` | `ansi_quotes` — `"…"` quotes a name |
| `noBackslashEscapes` | `no_backslash_escapes` |
| `pipesAsConcat` | `pipes_as_concat` — `\|\|` joins strings |

## 2. Other ways to hand it over

| How | When to use it |
|---|---|
| `npm install ../CoraDB-SQLSyntaxChecker-Wasm` (the package folder) | Both projects are on the same machine and changes should show up at once. Breaks if the app is moved to a machine without that folder. |
| A git repository: `npm install git+https://…/CoraDB-SQLSyntaxChecker-Wasm.git` | Several teams; versions by tag. |
| A private registry (GitHub Packages, Verdaccio…): `npm publish`, then `npm install coradb-sqlsyntaxchecker-wasm` | Many apps; normal version upgrades. |

## 3. Apps that do not use npm (plain web pages, Electron, any web server)

Copy two files into the same folder of the app — `index.js` and
`coradb-sqlsyntaxchecker.wasm` (unpack them from the `.tgz`, or take them from the package
folder) — and load it as a module:

```html
<script type="module">
  import { checkSql, describeError } from './CoraDB-SQLSyntaxChecker-Wasm/index.js';

  const err = await checkSql('select a, from t');
  if (err) console.log(err.line, err.column, describeError(err));
</script>
```

Ship `LICENSE` and `NOTICE` with them: the Apache License 2.0 requires it.

If the `.wasm` is served from somewhere else, say where:
`loadSqlChecker('/assets/coradb-sqlsyntaxchecker.wasm')`, or pass its bytes to
`createSqlChecker(bytes)`.

## 4. Apps not written in JavaScript (Java, .NET, Python…)

There is nothing ready-made yet. Two routes:

- **A WebAssembly runtime** (Wasmtime for .NET/Python/Rust, Chicory or
  GraalWasm for Java, wazero for Go). The runtime must support WebAssembly
  exception handling, which the module uses; check that the chosen runtime
  and version do before relying on it.
- **A native library**: the generated C sources (grammar, lexer and
  `build/check.c`) are plain portable C and can be compiled as a `.dll` / `.so`
  for JNI, P/Invoke or ctypes.

## 5. Limits

- Syntax only. Whether the tables, columns and functions a statement names
  exist is something only the database knows.
- PL/CSQL procedure bodies (`CREATE PROCEDURE … AS BEGIN … END`) are compiled
  separately by the engine and are not read by this grammar; leave them out of
  what is checked. Java procedures (`AS LANGUAGE JAVA …`) check normally.

## 6. When the engine's grammar changes

In `D:\GitHub\arnia\CoraDB-SQLSyntaxChecker-Wasm`:

```bash
npm run build -- D:\GitHub\arnia\tesseractdb-develop\src\parser
npm test
```

Then raise `version` in `package.json` (for example to `0.1.1`), run
`npm pack`, and give the apps the new `.tgz`. In each app:

```bash
npm install ./vendor/coradb-sqlsyntaxchecker-wasm-0.1.1.tgz
```

The build needs bison 3 and flex 2.6 (on Windows `win_bison` and `win_flex`
from winflexbison) and the WASI SDK, with `WASI_SDK_PATH` set to the folder it
was unpacked into. `build-info.json` records which engine version and source
the module was built from.
