export type AST = number | string | symbol | AST[];
export type Eval = (ast: AST) => Promise<any>;
export type Env = Record<symbol, any>;
