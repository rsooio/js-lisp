import { ELSE, REST, TYPE } from "./const";
import type { Arg, AST, Env, Eval, Proc, ProcCPS } from "./type";
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

const withTag =
  <Tag extends string>(tag: Tag) =>
  <T>(val: T): T & { [TYPE]: Tag } =>
    Object.defineProperties(val, {
      [TYPE]: { value: tag, writable: false, enumerable: false, configurable: false },
    }) as T & { [TYPE]: Tag };

const macro = (proc: (env: Env, args: any, cont: (val: any) => void) => void) =>
  withTag("macro")((env: Env, args: any, cont?: (val: any) => void) => proc(env, args, cont ?? ((v) => v)));

// @ts-ignore
const eval_ = macro((env, ast, cont) => {
  if (typeof ast === "symbol") {
    if (isKeyword(ast)) throw new Error(`Keyword cannot be evaluate: ${ast.description}`);
    if (ast in env) return cont(env[ast]);
    throw new Error(`Undefined symbol: ${ast.description}`);
  }
  if (!Array.isArray(ast)) return cont(ast);
  if (ast[0] === undefined) throw new Error("Unexpected empty list");
  eval_(env, ast[0]!, async (proc: ProcCPS<any[]>) => {
    if (typeof proc !== "function") throw new Error(`Not a function: ${proc}`);
    if (TYPE in proc) return proc(env, ast.slice(1), cont);
    // TODO: auto wrap callback functions
    console.log("CALL", proc, ast.slice(1));
    const args = await Promise.all(ast.slice(1).map((arg) => wrap(env, [arg])));
    return cont(await (proc as any)(...args));
  });
});

const wrap = macro((env, [procAst, argMap = {}]: [AST, Env], cont) => {
  eval_(env, procAst, (proc) => {
    if (typeof proc !== "function" || !(TYPE in proc)) return cont(proc);
    argMap[TYPE] = "callback";
    return cont((...args: any[]) => {
      try {
        return proc(argMap, args);
      } catch (e) {
        console.log("Error in callback:", e);
      }
    });
  });
});

// const wrap =
//   (env: Env, argMap: Env = {}) =>
//   (procAst: AST) => {
//     const proc = eval_(env)(procAst);
//     if (typeof proc !== "function" || !(TYPE in proc)) return proc;
//     argMap[TYPE] = "callback";
//     return (...args: any[]) => {
//       try {
//         return proc(argMap, ...args);
//       } catch (e) {
//         console.log("Error in callback:", e);
//       }
//     };
//   };

export const defineMacro = withTag("macro")<Proc>;

const begin = macro((env, [body, ...rest]: AST[], cont) => {
  eval_(env, body, rest.length ? undefined : cont);
  begin(env, rest, cont);
});

const lambda = macro((env, [argNames, ...body]: AST[], cont) => {
  if (!Array.isArray(argNames)) throw new Error("Lambda arg names must be an array");

  const parseArg = (arg: AST, cont: (val: Arg) => any): void => {
    if (typeof arg === "symbol") return cont([arg, undefined]);
    if (!Array.isArray(arg)) throw new Error(`Unexpected type in arg define: ${typeof arg}`);
    return cont([arg[0] as symbol, eval_(env, arg[1])]);
  };

  const parseArgs = (
    [arg, ...rest]: AST[],
    args: Arg[],
    map: Map<symbol, Arg>,
    cont: (val: [Arg[], Map<symbol, Arg>]) => any
  ): void => {
    if (arg === undefined) return cont([args, map]);
    if (typeof arg !== "symbol" || !isKeyword(arg))
      return parseArg(arg, (parsed) => parseArgs(rest, [...args, parsed], map, cont));
    if (map.has(arg)) throw new Error(`Duplicated keyword arguments: ${arg.description}`);
    parseArg(rest[0], (parsed) => parseArgs(rest.slice(1), args, map.set(arg, parsed), cont));
  };

  return parseArgs(argNames, [], new Map(), ([defArr, defMap]) =>
    cont(
      macro((callEnv, args: AST[], cont) => {
        console.log(argNames, args);
        const localEnv = Object.create(env);
        const isCallback = callEnv[TYPE] === "callback";
        const argMap = new Map<symbol, AST>();
        let chain = Promise.resolve();

        // const evalChain: typeof eval_ = (e, a, c) => {
        //   chain = chain.then(() => new Promise((res) => eval_(e, a, (v) => (c?.(v), res()))));
        // };

        const evalChain = macro((e, a, c) => {
          chain = chain.then(() => new Promise((res) => eval_(e, a, (v) => (c(v), res()))));
        });

        args.reverse();
        for (const [i, def] of defArr.entries()) {
          if (def[0] === REST) {
            args.reverse();
            localEnv[defArr[i + 1][0]] = isCallback ? args : args.map((arg) => evalChain(callEnv, arg));
            if (isCallback) localEnv[defArr[i + 1][0]] = args;
            else evalChain(callEnv, args, (vals) => (localEnv[defArr[i + 1][0]] = vals));
            break;
          }
          const arg = args.pop();
          if (typeof arg === "symbol" && isKeyword(arg)) argMap.set(arg, args.pop()!);
          else if (isCallback) localEnv[def[0]] = arg ?? def[1];
          else
            evalChain(callEnv, arg, (v) => {
              if (v !== undefined) localEnv[def[0]] = v;
              else if (def[1] !== undefined) evalChain(callEnv, def[1], (v2) => (localEnv[def[0]] = v2));
            });
        }

        for (const [keyword, [key, val]] of defMap.entries()) {
          if (isCallback) localEnv[key] = callEnv[keyword] ?? val;
          else if (argMap.has(keyword)) evalChain(callEnv, argMap.get(keyword)!, (v) => (localEnv[key] = v));
          else localEnv[key] = val;
        }

        return chain.then(() => begin(localEnv, body, cont));
      })
    )
  );
});

// const toCallback = defineMacro((env, procArg, ...args) => {
//   const map = { [TYPE]: "callback" as const } as Record<symbol, any>;
//   for (const [k, v] of _.chunk(args, 2)) {
//     map[k as symbol] = eval_(env)(v);
//   }
//   return wrap(env, map)(procArg);
// });

const createEnv = <const T extends Record<string, any>>(env: T): Env =>
  Object.fromEntries(Object.entries(env).map(([k, v]) => [Symbol.for(k), v]));

const baseEnv = createEnv({
  JS: { String, Number, Array, Boolean, Math, Date, RegExp },
  "#t": true,
  "#f": false,
  null: [],
  quote: macro((_, [ast], cont) => cont(ast)),
  car: (x: any[]) => x[0],
  cdr: (x: any[]) => x.slice(1),
  cond: macro(async (env, [clauses]: AST[], cont) => {
    for (const [cond, ...body] of clauses as AST[][]) {
      if (cond === ELSE || (await eval_(env, cond))) return begin(env, body, cont);
    }
    cont(undefined);
  }),
  eval: macro((env, ast, cont) => eval_(env, ast, (ast) => eval_(env, ast, cont))),
  begin,
  lambda,
  λ: lambda,
  // function: toCallback,
  define: macro((env, [names, ...body], cont) => {
    if (!Array.isArray(names)) {
      env[names as symbol] = eval_(env, body[0]!, (v) => (env[names as symbol] = v));
    } else {
      const [name, ...argNames] = names as symbol[];
      env[name] = lambda(env, [argNames, ...body], (v) => {
        env[name] = v;
        console.log(env);
      });
    }
    cont(undefined);
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
  when: macro((env, [cond, ...body], cont) => {
    eval_(env, cond, (v) => (v ? begin(env, body, cont) : cont(undefined)));
  }),
  unless: macro((env, [cond, ...body], cont) => {
    eval_(env, cond, (v) => (v ? cont(undefined) : begin(env, body, cont)));
  }),
  while: macro(async (env, [cond, ...body], cont) => {
    const loop = () => {
      eval_(env, cond, (v) => {
        if (!v) return cont(undefined);
        begin(env, body, loop);
      });
    };
    loop();
  }),
  if: macro(async (env, [cond, thenBranch, elseBranch], cont) => {
    eval_(env, cond, (v) => {
      const branch = v ? thenBranch : elseBranch;
      branch !== undefined ? begin(env, [branch], cont) : cont(undefined);
    });
  }),
  // dict: defineMacro((env, ...pairs) => {
  //   if (pairs.length % 2 !== 0) throw new Error("dict requires even number of arguments");
  //   return pairs.reduce(async (acc, cur, i) => {
  //     return acc.then(async (obj) => {
  //       if (i % 2 === 1) return obj;
  //       const key = typeof cur === "symbol" && isKeyword(cur) ? getKeywordName(cur) : await eval_(env)(cur);
  //       const value = await eval_(env)(pairs[i + 1]!);
  //       if (key in obj) throw new Error(`Duplicate key '${key}' in dict`);
  //       if (typeof key !== "string" && typeof key !== "number") throw new Error(`Invalid key type: ${typeof key}`);
  //       return Object.assign(obj, { [key]: value });
  //     });
  //   }, Promise.resolve({}));
  // }),
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
  // "set!": defineMacro((env, ...args) => {
  //   const [value, key] = args.map(eval_(env));
  //   let proto = env;
  //   while (proto) {
  //     if (Object.hasOwn(proto, key)) break;
  //     proto = Object.getPrototypeOf(proto);
  //   }
  //   proto ??= env;
  //   return _.set(proto, Symbol.for(key), value);
  // }),
});

export const newEval = (env: Record<string, any> = {}) => {
  const localEnv = Object.assign(Object.create(baseEnv), createEnv(env));
  return (ast: AST) => eval_(localEnv, ast);
};
