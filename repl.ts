import type { Eval } from "./type";
import { parse } from "./parser";

export const startConsoleRepl = (evaluate: Eval) => {
  (globalThis as any)["evaluate"] = (code: string) => {
    const asts = parse(code);
    return asts.reduce(async (acc, cur) => acc.then(() => evaluate(cur)), Promise.resolve());
  };
  console.log("Lisp console REPL started. Use evaluate() to evaluate code.");
};
