import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const files = {};
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (!path.endsWith(".map")) files[relative("dist", path)] = readFileSync(path);
  }
}
collect("dist");
const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
mkdirSync("artifacts", { recursive: true });
const destination = `artifacts/linkarr-${version}.zip`;
writeFileSync(destination, zipSync(files, { level: 9 }));
console.log(destination);
