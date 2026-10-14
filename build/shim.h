/* What the engine's lexer rules expect of the parser around them. */
#ifndef CHECK_SHIM_H
#define CHECK_SHIM_H

typedef struct { int line, column, strings_have_no_escapes; } CHECK_PARSER;
extern CHECK_PARSER *this_parser;

/* Token values are never used: nothing is built, only accepted or not. */
char *pt_makename (const char *s);
char *pt_append_string (void *parser, char *a, const char *b);

enum { PRM_ID_ANSI_QUOTES, PRM_ID_NO_BACKSLASH_ESCAPES, PRM_ID_PIPES_AS_CONCAT };
int prm_get_bool_value (int id);

int check_input (char *buf, int max);
void corasql_yyerror (const char *s);
#endif
