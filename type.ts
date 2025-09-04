export type AST = number | string | symbol | AST[];
export type Eval = (ast: AST) => Promise<any>;
export type Env = Record<symbol, any>;
export type Proc = (env: Env, ...args: AST[]) => any;
