import { readFile } from "fs/promises";
import { parse } from "./parser";
import { newEval } from "./interpreter";

const script = await readFile("test.lisp", "utf8");
const asts = parse(script);
const evaluate = newEval({
  log: console.log,
});
for (const [i, ast] of asts.entries()) {
  const start = globalThis.performance.now();
  await evaluate(ast);
  const timeSpent = globalThis.performance.now() - start;
  console.log(timeSpent);
}
