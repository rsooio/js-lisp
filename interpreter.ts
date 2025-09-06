import { REST, TYPE } from "./const";
import type { Arg, AST, Env, Eval, Proc, Promisable } from "./type";
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

function then<T, U>(v: Promisable<T>, k: (val: T) => Promisable<U>): Promisable<U> {
  if (v instanceof Promise) return v.then(k);
  // if (Array.isArray(v) && v.some((x) => x instanceof Promise)) return Promise.all(v).then(k);
  return k(v);
}

function thenAll<T, U>(vs: Promisable<T>[], k: (vals: T[]) => Promisable<U>): Promisable<U> {
  if (vs.some((v) => v instanceof Promise)) return Promise.all(vs).then(k);
  return k(vs as T[]);
}

const eval_ =
  (env: Env = {}): Eval =>
  (ast) => {
    if (typeof ast === "symbol") {
      if (isKeyword(ast)) throw new Error(`Keyword cannot be evaluate: ${ast.description}`);
      return ast in env ? env[ast] : error(`Undefined symbol: ${ast.description}`);
    }
    if (!Array.isArray(ast)) return ast;
    if (ast[0] === undefined) throw new Error("Unexpected empty list");
    return then(eval_(env)(ast[0]), (proc) => {
      if (typeof proc !== "function") throw new Error(`Not a function: ${proc}`);
      if (TYPE in proc) return proc(env, ...ast.slice(1));
      return thenAll(ast.slice(1).map(wrap(env)), (args) => proc(...args));
    });
  };

const wrap =
  (env: Env, argMap: Env = {}) =>
  (procAst: AST) =>
    then(eval_(env)(procAst), (proc) => {
      if (typeof proc !== "function" || !(TYPE in proc)) return proc;
      argMap[TYPE] = "callback";
      return (...args: any[]) => proc(argMap, ...args);
    });

const withTag =
  <Tag extends string>(tag: Tag) =>
  <T>(val: T): T & { [TYPE]: Tag } =>
    Object.defineProperties(val, {
      [TYPE]: { value: tag, writable: false, enumerable: false, configurable: false },
    }) as T & { [TYPE]: Tag };

export const defineMacro = withTag("macro")<Proc>;

const begin = defineMacro((env, ...body) =>
  then(eval_(env)(body[0]), (v) => (body.length === 1 ? v : begin(env, ...body.slice(1))))
);

const lambda = defineMacro((env, argNames, ...body) => {
  if (!Array.isArray(argNames)) throw new Error("Lambda arg names must be an array");

  const parseArg = (arg: AST): Promisable<Arg> => {
    if (typeof arg === "symbol") return [arg, undefined];
    if (!Array.isArray(arg)) throw new Error(`Unexpected type in arg define: ${typeof arg}`);
    // return [arg[0] as symbol, eval_(env)(arg[1])];
    return then(eval_(env)(arg[1]), (v) => [arg[0] as symbol, v]);
  };

  const parseArgs = (
    [arg, ...rest]: AST[],
    args: Arg[] = [],
    map: Map<symbol, Arg> = new Map()
  ): Promisable<[Arg[], Map<symbol, Arg>]> => {
    if (arg === undefined) return [args, map] as const;
    if (typeof arg !== "symbol" || !isKeyword(arg))
      return then(parseArg(arg), (parsed) => parseArgs(rest, [...args, parsed], map));
    if (map.has(arg)) throw new Error(`Duplicated keyword arguments: ${arg.description}`);
    return then(parseArg(rest[0]!), (parsed) => parseArgs(rest.slice(1), args, map.set(arg, parsed)));
  };

  return then(parseArgs(argNames), ([defArr, defMap]) => {
    return withTag("proc")((callEnv: Env, ...args: AST[]) => {
      const localEnv = Object.create(env);
      const isCallback = callEnv[TYPE] === "callback";
      const argMap = new Map<symbol, AST>();

      args.reverse();
      const parseArg = (arr: [number, Arg][]): Promisable<void> => {
        if (arr.length === 0) return;
        const [[i, def], ...rest] = arr;
        if (def[0] === REST) {
          args.reverse();
          if (isCallback) return void (localEnv[defArr[i + 1][0]] = args);
          else return void thenAll(args.map(eval_(callEnv)), (vals) => (localEnv[defArr[i + 1][0]] = vals));
        }
        const arg = args.pop();
        if (typeof arg === "symbol" && isKeyword(arg)) argMap.set(arg, args.pop()!);
        else if (isCallback) localEnv[def[0]] = arg ?? def[1];
        else
          return then(eval_(callEnv)(arg!), (v) => {
            if (v !== undefined) localEnv[def[0]] = v;
            else if (def[1] !== undefined)
              return then(eval_(callEnv)(def[1]), (v2) => ((localEnv[def[0]] = v2), parseArg(rest)));
            return parseArg(rest);
          });
        return parseArg(rest);
      };

      const parseNamedArgs = (arr: [symbol, Arg][]): Promisable<void> => {
        if (arr.length === 0) return;
        const [[keyword, [key, val]], ...rest] = arr;
        if (isCallback) localEnv[key] = callEnv[keyword] ?? val;
        else if (!argMap.has(keyword)) localEnv[key] = val;
        else
          return then(eval_(callEnv)(argMap.get(keyword)!), (v) => {
            localEnv[key] = v;
            return parseNamedArgs(rest);
          });
        return parseNamedArgs(rest);
      };

      return then(parseArg(Array.from(defArr.entries())), () => {
        return then(parseNamedArgs(Array.from(defMap.entries())), () => {
          return begin(localEnv, ...body);
        });
      });
    });
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
