import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  checkSql,
  createSqlChecker,
  describeError,
  charOffset,
  loadSqlChecker,
  tokenWords,
} from '../index.js';

// Valid CoraDB SQL that the checker must accept: a guard against false
// alarms as much as a test. Add to it whenever one is found.
const GOOD = [
  'select 1',
  "select * from orders where id = 1 and name like 'a%' order by 2 desc limit 10",
  "select a, b from t where x = 'it''s'",
  'select count(*), avg(price) from orders group by customer_id having count(*) > 2',
  'insert into t (a, b) values (1, 2), (3, 4)',
  'update t set a = a + 1 where id in (select id from u)',
  'delete from t where id = 3',
  'create table x (id int primary key auto_increment, name varchar(50) not null, c datetime default sysdatetime)',
  'alter table x add column z int',
  'drop table if exists x',
  'merge into t using s on (t.id = s.id) when matched then update set t.a = s.a when not matched then insert (id, a) values (s.id, s.a)',
  "select level, sys_connect_by_path(name, '/') from emp start with mgr is null connect by nocycle prior id = mgr order siblings by name",
  'select /*+ USE_IDX(t idx1) ORDERED */ * from t',
  'select /* plain comment */ 1',
  'with recursive r (n) as (select 1 union all select n + 1 from r where n < 10) select * from r',
  'SELECT JSON_GRAPH(a, e, b) FROM MATCH (a:person)-[e:knows]->(b:person)',
  "select * from json_table('[1,2]', '$[*]' columns (v int path '$')) jt",
  'select "order", `group` from t',
  'select a || b from t',
  'set @collect_exec_stats = 1',
  'show exec statistics all',
  'SET TRACE ON OUTPUT JSON',
  'KILL QUERY 3',
  'UPDATE STATISTICS ON t',
  'SELECT * FROM t LIMIT 0, 100',
  'INSERT INTO t (a) VALUES (1) ON DUPLICATE KEY UPDATE a = 2',
  'SELECT ? FROM db_root',
  'select @x := 1',
  'CREATE TRIGGER tr BEFORE INSERT ON t EXECUTE UPDATE u SET n = n + 1',
  'ALTER TABLE t OWNER TO u',
  'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
  'ROLLBACK TO SAVEPOINT s1',
  "select 'ăîșț' from db_root",
  "create procedure p() as language java name 'X.y()'",
  'select 1; select 2;',
];

const checker = await loadSqlChecker();

test('accepts valid CoraDB SQL', () => {
  for (const sql of GOOD) assert.equal(checker.check(sql), null, sql);
});

test('says where it stopped, in lines, bytes and characters', () => {
  const err = checker.check('select a, from t');
  assert.deepEqual(
    { line: err.line, column: err.column, offset: err.offset, length: err.length, token: err.token },
    { line: 1, column: 11, offset: 10, length: 4, token: 'from' },
  );
});

test('places errors after strings, comments and hints', () => {
  for (const [sql, at] of [
    ["select 'ab' from from t", 17],
    ["select 'ăî' from from t", 17],
    ['select /*+ ORDERED */ a from from t', 29],
    ['select /* note */ a from from t', 25],
    ['select a -- note\n from from t', 23],
  ]) {
    const err = checker.check(sql);
    assert.equal(err.offset, at, sql);
    assert.equal(sql.slice(err.offset, err.offset + err.length), 'from', sql);
  }
});

test('counts lines and columns in characters', () => {
  const err = checker.check("select 'ăîș',\n  'ț' from from t");
  assert.deepEqual([err.line, err.column], [2, 12]);
  assert.equal(charOffset('ăb', 2), 1);
});

test('finds an error on a later line', () => {
  const sql = 'select a,\n  b\nfrom t\nwhere x = 1 and and y = 2';
  const err = checker.check(sql);
  assert.equal(err.line, 4);
  assert.equal(sql.slice(err.offset, err.offset + err.length), 'and');
});

test('describes errors in words', () => {
  assert.equal(describeError(checker.check('select count(* from t')), 'Syntax error: unexpected "from". Expected ).');
  assert.equal(describeError(checker.check('select a from t where x = 1 and and y = 2')), 'Syntax error: unexpected "and".');
  assert.match(describeError(checker.check('select * from')), /unexpected the end of the statement|unexpected end/);
});

test('marks an open string from its quote to the end of the line', () => {
  const sql = "select 'abc from t";
  const err = checker.check(sql);
  assert.equal(describeError(err), 'This string is never closed.');
  assert.equal(sql.slice(err.offset, err.offset + err.length), "'abc from t");
});

test('follows the server settings that change how SQL reads', () => {
  assert.equal(checker.check('select a || b from t'), null);
  assert.notEqual(checker.check('select a || b from t', { pipesAsConcat: false }), null);
  assert.equal(checker.check('select a || b from t', DEFAULT_SETTINGS), null);
});

test('starts every check afresh', () => {
  assert.notEqual(checker.check('select ('), null);
  assert.equal(checker.check('SELECT JSON_GRAPH(a) FROM MATCH (a:person)'), null);
  assert.equal(checker.check("select x from t where a = '[' and b = 1"), null);
});

test('stops at the first error of a script', () => {
  const err = checker.check('select 1;\nselec 2;\nselect (;');
  assert.equal(err.line, 2);
});

test('loads from bytes, from a path and in one call', async () => {
  const fromBytes = await createSqlChecker(readFileSync(new URL('../coradb-sqlsyntaxchecker.wasm', import.meta.url)));
  assert.equal(fromBytes.check('select 1'), null);
  const fromPath = await loadSqlChecker(new URL('../coradb-sqlsyntaxchecker.wasm', import.meta.url));
  assert.notEqual(fromPath.check('select'), null);
  assert.equal(await checkSql('select 1'), null);
});

test('says token names the way a person would', () => {
  assert.equal(tokenWords('DELETE_'), 'DELETE');
  assert.equal(tokenWords('IdName'), 'a name');
  assert.equal(tokenWords("')'"), ')');
});
