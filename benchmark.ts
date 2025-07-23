import { parse } from "./parser";
import type { AST } from "./type";

function generateLisp(depth: number, breadth: number) {
  if (depth === 0) {
    // 叶子节点：返回简单 symbol 或数字
    return Math.random() < 0.5
      ? Math.floor(Math.random() * 100).toString()
      : "symbol" + Math.floor(Math.random() * 1000);
  }
  const children: string[] = [];
  for (let i = 0; i < breadth; i++) {
    children.push(generateLisp(depth - 1, breadth));
  }
  return "(" + children.join(" ") + ")";
}

function benchmark(depth: number, breadth: number) {
  const code = generateLisp(depth, breadth);
  // console.log('Test code:', code);

  const size = code.split(" ").length;
  console.log(`Parsing Lisp code with token size=${size}`);
  const start = performance.now();
  const ast = parse(code);
  const end = performance.now();
  console.log(
    `performance: ${(((end - start) / size) * 1e6).toFixed(2)} ns/token`
  );

  console.log(
    `Parsed Lisp code with depth=${depth}, breadth=${breadth} in ${(
      end - start
    ).toFixed(2)} ms`
  );
  return ast;
}

benchmark(5, 6);
benchmark(5, 7);
benchmark(6, 7);
benchmark(7, 7);
