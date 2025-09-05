export type AST = number | string | symbol | AST[];
export type Eval = (ast: AST) => any;
export type Env = Record<symbol, any>;
export type Proc = (env: Env, ...args: AST[]) => any;
export type Arg = [symbol, any | undefined];

// export type Context = { env: Env; cont: (result: any) => void };
// export type ProcCPS = (context: Context, ...args: AST[]) => void;

export type Cont = (result: any) => void;
export type ProcCPS<T = AST[]> = (env: Env, args: T, cont: Cont) => Promise<any>;
