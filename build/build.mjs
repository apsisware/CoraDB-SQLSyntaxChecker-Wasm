/**
 * Build coradb-sqlsyntaxchecker.wasm from the CoraDB engine's source.
 *
 *   npm run build -- D:\GitHub\arnia\tesseractdb-develop\src\parser
 *
 * Needs, on PATH or named by environment variables:
 *   - bison 3.x  (BISON;  on Windows win_bison, from winflexbison)
 *   - flex 2.6   (FLEX;   on Windows win_flex)
 *   - the WASI SDK (WASI_SDK_PATH), https://github.com/WebAssembly/wasi-sdk/releases
 *
 * Writes coradb-sqlsyntaxchecker.wasm and build-info.json (which source it was built from)
 * at the top of the package. Intermediate files go to build/out/.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'corasql_grammar.y'))) {
  console.error('Usage: npm run build -- <tesseractdb>/src/parser');
  process.exit(1);
}
const win = process.platform === 'win32';
const wasi = process.env.WASI_SDK_PATH;
if (!wasi || !fs.existsSync(wasi)) {
  console.error('Set WASI_SDK_PATH to the folder the WASI SDK was unpacked into.');
  process.exit(1);
}

/** The first of `names` that runs. */
function tool(env, names) {
  for (const name of [process.env[env], ...names].filter(Boolean)) {
    if (spawnSync(name, ['--version'], { encoding: 'utf8' }).status === 0) return name;
  }
  console.error(`${names[0]} was not found. Put it on PATH or set ${env}.`);
  process.exit(1);
}
const bison = tool('BISON', win ? ['win_bison', 'bison'] : ['bison']);
const flex = tool('FLEX', win ? ['win_flex', 'flex'] : ['flex']);
const clang = path.join(wasi, 'bin', win ? 'clang.exe' : 'clang');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  // Warnings are left unsaid: bison reports conflicts and unused rules, and
  // flex rules it cannot reach — all there in the engine's own build too,
  // since the grammar is GLR and the sources are the engine's.
  if (r.status !== 0) {
    console.error(r.stderr);
    console.error(`${path.basename(cmd)} failed.`);
    process.exit(1);
  }
}

const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const counts = generate(src, out);
run(bison, ['-d', '-o', path.join(out, 'check_grammar.tab.c'), path.join(out, 'check_grammar.y')]);
run(flex, ['-P', 'corasql_yy', '-o', path.join(out, 'check_lexer.c'), path.join(out, 'check_lexer.l')]);
const wasm = path.join(root, 'coradb-sqlsyntaxchecker.wasm');
run(clang, [
  '--target=wasm32-wasip1',
  `--sysroot=${path.join(wasi, 'share', 'wasi-sysroot')}`,
  '-O2',
  '-mexec-model=reactor',
  // Bison's GLR parser recovers with setjmp/longjmp, which WebAssembly does
  // with its exception instructions (every current browser, and Node 18+).
  '-mllvm', '-wasm-enable-sjlj',
  '-Wno-everything',
  '-I', here,
  '-I', out,
  '-o', wasm,
  path.join(here, 'check.c'),
  path.join(out, 'check_grammar.tab.c'),
  path.join(out, 'check_lexer.c'),
  '-lsetjmp',
]);

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(src, f))).digest('hex');
const versionFile = path.resolve(src, '..', '..', 'VERSION');
const info = {
  builtAt: new Date().toISOString(),
  source: path.resolve(src),
  engineVersion: fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null,
  grammarSha256: sha('corasql_grammar.y'),
  lexerSha256: sha('corasql_lexer.l'),
  tokens: counts.tokens,
  hints: counts.hints,
};
fs.writeFileSync(path.join(root, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Wrote coradb-sqlsyntaxchecker.wasm (${(fs.statSync(wasm).size / 1024).toFixed(0)} KB) and build-info.json`);
