# CoraDB-SQLSyntaxChecker-Wasm

Is this valid CoraDB SQL? An offline syntax check that uses **the engine's own
grammar and lexer** (`corasql_grammar.y`, `corasql_lexer.l`) compiled to
WebAssembly. It runs in the browser and in Node 18+, needs no server and no
connection, and answers as the engine's parser would: accepted, or where it
stopped and why.

It checks syntax only. Whether the tables, columns and functions a statement
names exist is something only the database knows.

## Install

The npm package is named `coradb-sqlsyntaxchecker-wasm`: npm package names are lower case.

```bash
npm install ../CoraDB-SQLSyntaxChecker-Wasm          # from a folder next to your project
```

or from its git repository once it has one (`npm install git+https://…`), or
from a private registry after `npm publish`.

## Use

```js
import { checkSql, describeError } from 'coradb-sqlsyntaxchecker-wasm';

const err = await checkSql('select a, from t');
if (err) {
  console.log(err.line, err.column, describeError(err));
  // 1 11 'Syntax error: unexpected "from".'
}
```

For many checks, load the checker once:

```js
import { loadSqlChecker } from 'coradb-sqlsyntaxchecker-wasm';

const checker = await loadSqlChecker();      // ~0.5 MB, compiled once
checker.check('select 1');                   // null: valid
checker.check('select count(* from t');      // { line, column, offset, length, message, token }
```

`check()` takes one statement, or a script of statements separated by
semicolons; the first error stops it, as it does the engine. A typical
statement takes a small fraction of a millisecond.

**In the browser** the module is fetched from next to `index.js`. Vite and
webpack 5 copy it into the build on their own, since it is named with
`new URL('./coradb-sqlsyntaxchecker.wasm', import.meta.url)`. To serve it from somewhere
else, pass its URL: `loadSqlChecker('/assets/coradb-sqlsyntaxchecker.wasm')`, or the bytes:
`createSqlChecker(bytes)`.

## The error

| field | |
|---|---|
| `line`, `column` | 1-based, in characters |
| `offset`, `length` | the part of the text to mark: the token, or an unclosed quote to the end of its line |
| `token` | the text the parser stopped at; `''` at the end of the text |
| `message` | what the parser said, e.g. `syntax error, unexpected FROM, expecting ')'` |

`describeError(err)` puts that in words: `Syntax error: unexpected "from". Expected ).`
or `This string is never closed.`

## Server settings

Three server settings change how SQL is read. The checker uses the engine's
defaults; pass the server's own when they differ:

```js
checker.check(sql, { ansiQuotes: true, noBackslashEscapes: true, pipesAsConcat: false });
```

| option | server parameter | default |
|---|---|---|
| `ansiQuotes` | `ansi_quotes`: `"…"` quotes a name | `true` |
| `noBackslashEscapes` | `no_backslash_escapes` | `true` |
| `pipesAsConcat` | `pipes_as_concat`: `\|\|` joins strings | `true` |

## Limits

- The engine refuses a few things after parsing them (limits, invalid
  combinations). Those checks live in the C code the grammar runs, which is
  not part of this module.

## Rebuilding from the engine source

When the engine's grammar changes:

```bash
npm run build -- D:\GitHub\arnia\tesseractdb-develop\src\parser
npm test
```

This needs bison 3 and flex 2.6 (on Windows `win_bison` and `win_flex` from
winflexbison), and the [WASI SDK](https://github.com/WebAssembly/wasi-sdk/releases)
with `WASI_SDK_PATH` set to where it was unpacked. `build-info.json` records
the engine version and the source it was built from. How the engine's sources
are turned into the module is described at the top of `build/generate.mjs`.

## License

MIT. See `LICENSE`.
