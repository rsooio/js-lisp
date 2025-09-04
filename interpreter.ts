import type { AST, Env, Eval, Proc } from "./type.js";
import * as _ from "es-toolkit/compat";

const TYPE: unique symbol = Symbol("type");

function error(message: string) {
  throw new Error(message);
}

function isKeyword(sym: symbol) {
  return sym.description?.startsWith("#:");
}

function getKeywordName(sym: symbol) {
  return sym.description!.slice(2);
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
    const first = await eval_(env)(ast[0]);
    if (typeof first !== "function") throw new Error(`Not a function: ${first}`);
    const proc = TYPE in first ? first : fn(first);
    return proc(env, ...ast.slice(1));
  };

export const fn =
  <T extends (...args: any[]) => any>(f: T) =>
  async (env: Env, ...args: Parameters<T>): Promise<ReturnType<T>> =>
    f(...(await Promise.all(args.map(eval_(env)))));

const withTag =
  <Tag extends string>(tag: Tag) =>
  <T>(val: T): T & { [TYPE]: Tag } =>
    Object.defineProperties(val, {
      [TYPE]: { value: tag, writable: false, enumerable: false, configurable: false },
    }) as T & { [TYPE]: Tag };

export const defineMacro = withTag("macro")<Proc>;
export const defineProc = <T extends (...args: any[]) => any>(f: T): Proc =>
  withTag("proc")(async (env, ...args) => f(...(await Promise.all(args.map(eval_(env))))));

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

const begin = defineMacro((env, ...body) =>
  body.reduce(async (acc, cur) => acc.then(() => eval_(env)(cur)), Promise.resolve())
);

const lambda = defineMacro((env, argNames, ...body) =>
  withTag("proc")(async (callEnv: Env, ...args: any[]) => {
    const localEnv = Object.create(env);
    const pairs = evalArgs(argNames as symbol[], args);
    await pairs.reduce((acc, [sym, ast]) => {
      return acc.then(async () => (localEnv[sym] = await eval_(callEnv)(ast)));
    }, Promise.resolve());
    return begin(localEnv, ...body);
  })
);

const callback = defineMacro((env, argNames, ...body: AST[]) => {
  const localEnv = Object.create(env);
  return async (...args: any[]) => {
    if (args.length !== (argNames as symbol[]).length) throw new Error("Invalid number of arguments");
    await (argNames as symbol[]).reduce((acc, sym, i) => {
      return acc.then(async () => (localEnv[sym] = await eval_(env)(args[i])));
    }, Promise.resolve());
    return body.reduce(async (acc, cur) => acc.then(() => eval_(localEnv)(cur)), Promise.resolve());
  };
});

const createEnv = <const T extends Record<string, any>>(env: T): Env =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [Symbol.for(k), v]));

const baseEnv = createEnv({
  JS: { String, Number },
  "#t": true,
  "#f": false,
  null: [],
  quote: defineMacro((_, x) => x),
  car: (x: any[]) => x[0],
  cdr: (x: any[]) => x.slice(1),
  cond: defineMacro(async (env, clauses) => {
    for (const [cond, ...body] of clauses as AST[][]) {
      if (cond === Symbol.for("else") || (await eval_(env)(cond!))) return begin(env, ...body);
    }
  }),
  eval: defineMacro(async (env: Env, ast: AST) => eval_(env)(await eval_(env)(ast))),
  begin,
  lambda,
  λ: lambda,
  callback,
  define: defineMacro(async (env, names, ...body) => {
    if (!Array.isArray(names)) {
      env[names as symbol] = await eval_(env)(body[0]!);
    } else {
      const [name, ...argNames] = names as symbol[];
      env[name!] = lambda(env, argNames, ...body);
    }
  }),
  list: Array.of,
  cons: (x: any, y: any) => [x, ...y],
  "null?": (x: any) => Array.isArray(x) && x.length === 0,
  call: (fn: any, ...args: any[]) => fn?.(...args),
  "+": (...args: number[]) => args.reduce((prev, curr) => +prev + +curr, 0),
  "-": (...args: number[]) => args.reduce((prev, curr) => +prev - +curr),
  "*": (...args: number[]) => args.reduce((prev, curr) => +prev * +curr, 1),
  "/": (...args: number[]) => args.reduce((prev, curr) => +prev / +curr),
  "=": (a: any, b: any) => a === b,
  "equal?": _.isEqual,
  ">": (a: any, b: any) => a > b,
  ">=": (a: any, b: any) => +a >= +b,
  "<": (a: any, b: any) => +a < +b,
  "<=": (a: any, b: any) => +a <= +b,
  and: (...args: any[]) => args.every(Boolean),
  or: (...args: any[]) => args.some(Boolean),
  not: (arg: any) => !arg,
  display: console.log,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  when: defineMacro(async (env, cond, ...body) => {
    if (await eval_(env)(cond)) return begin(env, ...body);
  }),
  while: defineMacro(async (env, cond, ...body) => {
    while (await eval_(env)(cond)) {
      await begin(env, ...body);
    }
  }),
  if: defineMacro(async (env, cond, thenBranch, elseBranch) => {
    if (await eval_(env)(cond)) {
      return begin(env, thenBranch);
    } else if (elseBranch !== undefined) {
      return begin(env, elseBranch);
    }
  }),
  dict: defineMacro((env, ...pairs) => {
    if (pairs.length % 2 !== 0) throw new Error("dict requires even number of arguments");
    return pairs.reduce(async (acc, cur, i) => {
      return acc.then(async (obj) => {
        if (i % 2 === 1) return obj;
        const key = typeof cur === "symbol" && isKeyword(cur) ? getKeywordName(cur) : await eval_(env)(cur);
        const value = await eval_(env)(pairs[i + 1]!);
        if (key in obj) throw new Error(`Duplicate key '${key}' in dict`);
        if (typeof key !== "string" && typeof key !== "number") throw new Error(`Invalid key type: ${typeof key}`);
        return Object.assign(obj, { [key]: value });
      });
    }, Promise.resolve({}));
  }),
  get: (target: any, ...path: string[]) => {
    const paths = _.toPath(path.join("."));
    if (paths.length === 0) return target;
    const result: unknown = _.get(target, paths);
    if (typeof result !== "function") return result;
    return result.bind(paths.length > 1 ? _.get(target, paths.slice(0, -1)) : target);
  },
  set: (target: any, value: any, ...path: string[]) => {
    const paths = _.toPath(path.join("."));
    if (paths.length === 0) return target;
    return _.set(target, paths, value);
  },
  "set!": defineMacro(async (env, ...args) => {
    const [value, key] = await Promise.all(args.map(eval_(env)));
    let proto = env;
    while (proto) {
      if (Object.hasOwn(proto, key)) break;
      proto = Object.getPrototypeOf(proto);
    }
    proto ??= env;
    return _.set(proto, Symbol.for(key), value);
  }),
});

export const newEval = (env: Record<string, any> = {}) => eval_(Object.assign(Object.create(baseEnv), createEnv(env)));
