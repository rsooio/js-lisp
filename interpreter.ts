import type { AST, Env, Eval } from "./type.js";

function error(message: string) {
  throw new Error(message);
}

function isKeyword(sym: symbol) {
  return sym.description?.startsWith("#:");
}

const eval_ =
  (env: Env = {}): Eval =>
  async (ast) => {
    if (typeof ast === "symbol") {
      if (isKeyword(ast)) throw new Error(`Keyword cannot be evaluate: ${ast.description}`);
      return ast in env ? env[ast] : error(`Undefined symbol: ${ast.description}`);
    }
    if (!Array.isArray(ast)) return ast;
    if (ast[0] === undefined) throw new Error("Unexpected empty list");
    const fn = await eval_(env)(ast[0]);
    if (typeof fn !== "function") throw new Error(`Not a function: ${fn}`);
    return fn(env, ...ast.slice(1));
  };

export const fn =
  <T extends (...args: any[]) => any>(f: T) =>
  async (env: Env, ...args: Parameters<T>): Promise<ReturnType<T>> =>
    f(...(await Promise.all(args.map(eval_(env)))));

const evalArgs = (args: AST[], asts: AST[]): [symbol, AST][] => {
  type Arg = symbol | [symbol, AST];

  const parseArg = (arg?: AST) => {
    if (arg === undefined) throw new Error("Unexpected EOF when parsing args");
    if (typeof arg === "symbol") return arg;
    if (!Array.isArray(arg)) throw new Error(`Unexpected type in arg define: ${typeof arg}`);
    if (arg.length != 2 || typeof arg[0] !== "symbol" || isKeyword(arg[0]))
      throw new Error(`Unexpected optional arg: [${arg.map(String).join(" ")}]`);
    return arg as [symbol, AST];
  };

  const parseArgs = ([arg, ...rest]: AST[], args: Arg[] = [], map: Map<symbol, Arg> = new Map()) => {
    if (arg === undefined) return [args, map] as const;
    if (typeof arg !== "symbol" || !isKeyword(arg)) return parseArgs(rest, [...args, parseArg(arg)], map);
    if (map.has(arg)) throw new Error(`Duplicated keyword arguments: ${arg.description}`);
    return parseArgs(rest.slice(1), args, map.set(arg, parseArg(rest[0])));
  };

  const parseAsts = ([ast, ...rest]: AST[], asts: AST[] = [], map: Map<symbol, AST> = new Map()) => {
    if (ast === undefined) return [asts, map] as const;
    if (typeof ast !== "symbol" || !isKeyword(ast)) return parseAsts(rest, [...asts, ast], map);
    if (rest.length < 1) throw new Error(`Unexpected EOF after keyword argument: ${ast.description}`);
    if (map.has(ast)) throw new Error(`Duplicated keyword arguments: ${ast.description}`);
    return parseAsts(rest.slice(1), asts, map.set(ast, rest[0]));
  };

  const getAst = (arg: Arg, ast?: AST): [symbol, AST] => {
    const name = typeof arg === "symbol" ? arg : arg[0];
    if (ast !== undefined) return [name, ast];
    if (Array.isArray(arg)) return arg;
    throw new Error("Too few arguments");
  };

  const getAsts = ([arg, ...args]: Arg[], asts: AST[], env: [symbol, AST][] = []): [symbol, AST][] => {
    if (arg === undefined) {
      if (asts[0] !== undefined) throw new Error("Too much arguments");
      return env;
    }
    if (arg === Symbol.for(".")) {
      if (args.length !== 1 || Array.isArray(args[0])) throw new Error("Unexpected rest argument");
      return [...env, [args[0], [Symbol.for("list"), ...asts]]];
    }
    return getAsts(args, asts.slice(1), [...env, getAst(arg, asts[0])]);
  };

  const [argArr, argMap] = parseArgs(args);
  const [astArr, astMap] = parseAsts(asts);
  if (astMap.keys().some((k) => !argMap.has(k))) throw new Error("Unknown keyword argument");
  if (argMap.entries().some(([sym, arg]) => !Array.isArray(arg) && !astMap.has(sym)))
    throw new Error(`Keyword argument undefined`);
  const pairs = getAsts(argArr, astArr);
  const kwPairs = argMap
    .entries()
    .map(
      ([sym, arg]) => [Array.isArray(arg) ? arg[0] : arg, astMap.get(sym) ?? (arg as [symbol, AST])[1]] as [symbol, AST]
    );
  return [...pairs, ...kwPairs];
};

const lambda = (env: Env, argNames: symbol[], ...body: AST[]) => {
  return async (callEnv: Env, ...args: any[]) => {
    const localEnv = Object.create(env);
    const pairs = evalArgs(argNames, args);
    await pairs.reduce((acc, [sym, ast]) => {
      return acc.then(async () => (localEnv[sym] = await eval_(callEnv)(ast)));
    }, Promise.resolve());
    return body.reduce(async (acc, cur) => acc.then(() => eval_(localEnv)(cur)), Promise.resolve());
  };
};

const createEnv = <const T extends Record<string, any>>(env: T): Env =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [Symbol.for(k), v]));

const baseEnv = createEnv({
  "#t": true,
  "#f": false,
  null: [],
  quote: (_: Env, x: any) => x,
  car: fn((x: any[]) => x[0]),
  cdr: fn((x: any[]) => x.slice(1)),
  cond: async (env: Env, clauses: AST[][]) => {
    for (const [cond, ...body] of clauses) {
      if (cond === Symbol.for("else") || (await eval_(env)(cond!))) {
        return body.reduce(async (acc, cur) => acc.then(() => eval_(env)(cur)), Promise.resolve());
      }
    }
  },
  eval: async (env: Env, ast: AST) => eval_(env)(await eval_(env)(ast)),
  begin: (env: Env, asts: AST[]) => lambda(env, [], ...asts)(env),
  lambda,
  λ: lambda,
  define: async (env: Env, names: symbol[] | symbol, ...body: AST[]) => {
    if (!Array.isArray(names)) {
      env[names] = await eval_(env)(body[0]!);
    } else {
      const [name, ...argNames] = names;
      env[name!] = lambda(env, argNames, ...body);
    }
  },
  object: fn((...args: any[]) => Object.fromEntries(args)),
  list: fn((...args: any[]) => args),
  cons: fn((x: any, y: any) => [x, ...y]),
  "object-ref": fn((obj: any, ...keys: string[]) => {
    return keys.reduce((acc, key) => {
      if (typeof acc[key] === "function") return acc[key].bind(acc);
      return acc[key];
    }, obj);
  }),
  "null?": fn((x: any) => Array.isArray(x) && x.length === 0),
  call: fn(async (fn: any, ...args: any[]) => fn?.(...args)),
  "+": fn((...args: number[]) => args.reduce((prev, curr) => +prev + +curr, 0)),
  "-": fn((...args: number[]) => args.reduce((prev, curr) => +prev - +curr)),
  "*": fn((...args: number[]) => args.reduce((prev, curr) => +prev * +curr, 1)),
  "/": fn((...args: number[]) => args.reduce((prev, curr) => +prev / +curr)),
  "=": fn((a: any, b: any) => a === b),
  ">": fn((a: any, b: any) => a > b),
  ">=": fn((a: any, b: any) => +a >= +b),
  "<": fn((a: any, b: any) => +a < +b),
  "<=": fn((a: any, b: any) => +a <= +b),
  and: fn((...args: any[]) => args.every(Boolean)),
  or: fn((...args: any[]) => args.some(Boolean)),
  not: fn((arg: any) => !arg),
  display: fn(console.log),
  sleep: fn((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
});

export const newEval = (env: Record<string, any> = {}) => eval_(Object.assign(Object.create(baseEnv), createEnv(env)));
