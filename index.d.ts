/** Server settings that change how SQL is read. Each defaults to the engine's own default (true). */
export interface CheckSettings {
  /** `"…"` quotes a name, not a string (ansi_quotes). */
  ansiQuotes: boolean;
  /** A backslash in a string is just a backslash (no_backslash_escapes). */
  noBackslashEscapes: boolean;
  /** `||` joins strings rather than meaning OR (pipes_as_concat). */
  pipesAsConcat: boolean;
}

export declare const DEFAULT_SETTINGS: Readonly<CheckSettings>;

/** Where the parser stopped, and why. */
export interface SqlSyntaxError {
  /** 1-based line in the text checked. */
  line: number;
  /** 1-based column, in characters. */
  column: number;
  /** Where the error is in the string, in characters (0-based). */
  offset: number;
  /** How many characters to mark from `offset`: the token, or an open quote to the end of its line. */
  length: number;
  /** What the parser said, e.g. `syntax error, unexpected FROM, expecting ')'`. */
  message: string;
  /** The text of the token it stopped at; '' at the end of the text. */
  token: string;
}

export interface SqlChecker {
  /**
   * null when the engine's parser accepts `sql` — one statement, or several
   * separated by semicolons; otherwise the first error.
   */
  check(sql: string, settings?: Partial<CheckSettings>): SqlSyntaxError | null;
}

/** Compile a checker from the bytes of coradb-sqlsyntaxchecker.wasm. */
export declare function createSqlChecker(bytes: BufferSource): Promise<SqlChecker>;

/**
 * The checker, loaded once from the coradb-sqlsyntaxchecker.wasm next to this module (read
 * from disk in Node, fetched in the browser), or from `source` when given.
 */
export declare function loadSqlChecker(source?: URL | string | BufferSource): Promise<SqlChecker>;

/** Check in one call, with the module next to this one. */
export declare function checkSql(sql: string, settings?: Partial<CheckSettings>): Promise<SqlSyntaxError | null>;

/** The error in words: `Syntax error: unexpected "from". Expected ).` */
export declare function describeError(err: SqlSyntaxError): string;

/** The character offset of a byte offset into the UTF-8 form of `text`. */
export declare function charOffset(text: string, byteOffset: number): number;

/** One of the grammar's token names as a person would say it (DELETE_ → DELETE, IdName → a name). */
export declare function tokenWords(name: string): string;
