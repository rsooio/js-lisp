import { readFile } from "fs/promises";
import { parse } from "./parser";
import { newEval } from "./interpreter";

const script = await readFile("test.lisp", "utf8");
const asts = parse(script);
const evaluate = newEval();
for (const ast of asts) {
  await evaluate(ast);
}
