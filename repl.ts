export const startConsoleRepl = (evaluate: (code: string) => any) => {
  (globalThis as any)["evaluate"] = evaluate;
  console.log("Lisp console REPL started. Use evaluate() to evaluate code.");
};
