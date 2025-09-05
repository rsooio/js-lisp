import { REST, TYPE } from "./const";
import type { Arg, AST, Env, Eval, Proc } from "./type";
import * as _ from "es-toolkit/compat";

function error(message: string) {
  throw new Error(message);
}

function isKeyword(sym: symbol) {
  return sym.description?.startsWith(":");
}

function getKeywordName(sym: symbol) {
  return sym.description!.slice(1);
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
    const proc = await eval_(env)(ast[0]);
    if (typeof proc !== "function") throw new Error(`Not a function: ${proc}`);
    if (TYPE in proc) return proc(env, ...ast.slice(1));
    const args = await Promise.all(ast.slice(1).map(eval_(env)).map(wrap()));
    console.log(proc, args, ast.slice(1));
    return proc(...args);
    // return first(...(await Promise.all(ast.slice(1).map(eval_(env)).map(wrap()))));
  };

const wrap =
  (argMap: Env = {}) =>
  <T>(proc: T) => {
    if (typeof proc !== "function" || !(TYPE in proc)) return proc;
    argMap[TYPE] = "callback";
    return async (...args: any[]) => {
      try {
        return await proc(argMap, ...args);
      } catch (e) {
        console.log("Error in callback:", e);
      }
    };
  };

const withTag =
  <Tag extends string>(tag: Tag) =>
  <T>(val: T): T & { [TYPE]: Tag } =>
    Object.defineProperties(val, {
      [TYPE]: { value: tag, writable: false, enumerable: false, configurable: false },
    }) as T & { [TYPE]: Tag };

export const defineMacro = withTag("macro")<Proc>;

const begin = defineMacro((env, ...body) =>
  body.reduce(async (acc, cur) => acc.then(() => eval_(env)(cur)), Promise.resolve())
);

const lambda = defineMacro(async (env, argNames, ...body) => {
  if (!Array.isArray(argNames)) throw new Error("Lambda arg names must be an array");

  const parseArg = async (arg: AST): Promise<Arg> => {
    if (typeof arg === "symbol") return [arg, undefined];
    if (!Array.isArray(arg)) throw new Error(`Unexpected type in arg define: ${typeof arg}`);
    return [arg[0] as symbol, await eval_(env)(arg[1])];
  };

  const parseArgs = async ([arg, ...rest]: AST[], args: Arg[] = [], map: Map<symbol, Arg> = new Map()) => {
    if (arg === undefined) return [args, map] as const;
    if (typeof arg !== "symbol" || !isKeyword(arg)) return parseArgs(rest, [...args, await parseArg(arg)], map);
    if (map.has(arg)) throw new Error(`Duplicated keyword arguments: ${arg.description}`);
    return parseArgs(rest.slice(1), args, map.set(arg, await parseArg(rest[0])));
  };

  const [defArr, defMap] = await parseArgs(argNames);

  return withTag("proc")(async (callEnv: Env, ...args: AST[]) => {
    const localEnv = Object.create(env);
    const isCallback = callEnv[TYPE] === "callback";
    const argMap = new Map<symbol, AST>();

    args.reverse();
    for (const [i, def] of defArr.entries()) {
      if (def[0] === REST) {
        args.reverse();
        localEnv[defArr[i + 1][0]] = isCallback ? args : await Promise.all(args.map(eval_(callEnv)));
        break;
      }
      const arg = args.pop();
      if (typeof arg === "symbol" && isKeyword(arg)) argMap.set(arg, args.pop()!);
      else if (isCallback) localEnv[def[0]] = arg ?? def[1];
      else localEnv[def[0]] = (await eval_(callEnv)(arg!)) ?? (def[1] && (await eval_(callEnv)(def[1])));
    }

    for (const [keyword, [key, val]] of defMap.entries()) {
      if (isCallback) localEnv[key] = callEnv[keyword] ?? val;
      else localEnv[key] = argMap.has(keyword) ? await eval_(callEnv)(argMap.get(keyword)!) : val;
    }

    return begin(localEnv, ...body);
  });
});

const toCallback = defineMacro(async (env, procArg, ...args) => {
  const map = { [TYPE]: "callback" as const } as Record<symbol, any>;
  for (const [k, v] of _.chunk(args, 2)) {
    map[k as symbol] = await eval_(env)(v);
  }
  return async (...args: any[]) => {
    const proc = await eval_(env)(procArg);
    if (typeof proc !== "function") throw new Error(`Not a function: ${proc}`);
    try {
      return TYPE in proc ? await proc(map, ...args) : await proc(...args);
    } catch (e) {
      console.log("Error in callback:", e);
    }
  };
});

const createEnv = <const T extends Record<string, any>>(env: T): Env =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [Symbol.for(k), v]));

const baseEnv = createEnv({
  JS: { String, Number, Array, Boolean, Math, Date, RegExp },
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
  function: toCallback,
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
