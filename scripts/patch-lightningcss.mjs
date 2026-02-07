import fs from "fs";
import path from "path";

const pkgDir = path.join(process.cwd(), "node_modules", "lightningcss", "pkg");
const target = path.join(pkgDir, "index.js");

fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(
  target,
  "module.exports = require('lightningcss-wasm');\n",
  "utf8"
);

console.log("Patched lightningcss pkg shim -> lightningcss-wasm");
