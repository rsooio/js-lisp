import type { AST } from "./type";

const tokenize = (input: string) =>
  input
    .split(/\r?\n/)
    .map((line) => line.replace(/("(?:\\.|[^"\\])*")|;.*/g, (_, s) => s ?? ""))
    .join(" ")
    .match(/[()\[\]]|'|"(?:\\.|[^"\\])*"|[^\s()\[\]]+/g) || [];

const parseAtom = (token: string) => {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  if (/^["'].*["']$/.test(token)) return token.slice(1, -1);
  return Symbol.for(token);
};

const parseList = (tokens: string[], acc: AST[] = []): [AST[], string[]] => {
  if (tokens.length === 0) throw new Error("Unexpected EOF while reading list");
  const token = tokens.at(-1);

  if (token && "])".includes(token)) {
    return [acc, (tokens.pop(), tokens)];
  } else {
    const [form, nextTokens] = parseForm(tokens);
    return parseList(nextTokens, (acc.push(form), acc));
  }
};

const parseForm = (tokens: string[]): [AST, string[]] => {
  const token = tokens.pop();

  if (token && "[(".includes(token)) {
    return parseList(tokens);
  } else if (token === "'") {
    const [form, nextTokens] = parseForm(tokens);
    return [[Symbol.for("quote"), form], nextTokens];
  } else {
    return [parseAtom(token!), tokens];
  }
};

const parseAll = (tokens: string[], acc: AST[] = []): AST[] => {
  if (tokens.length === 0) return acc;
  const [form, rest] = parseForm(tokens);
  return parseAll(rest, (acc.push(form), acc));
};

export const parse = (input: string) => parseAll(tokenize(input).toReversed());

// const source = `(define (square x) (* x x)) (123print '''(add'test 4) "'he;llo, world")`;
// console.log(tokenize(source));
// const ast = parse(source);
// console.log(ast);
