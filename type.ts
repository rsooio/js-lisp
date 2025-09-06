export type AST = number | string | symbol | AST[];
export type Eval = (ast: AST) => any;
export type Env = Record<symbol, any>;
export type Proc = (env: Env, ...args: AST[]) => any;
export type Arg = [symbol, AST | undefined];
export type Promisable<T> = T | Promise<T>;
