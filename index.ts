import { newEval } from "./interpreter";
import { startConsoleRepl } from "./repl";

startConsoleRepl(newEval({}));
setTimeout(() => {}, 1 << 30);
