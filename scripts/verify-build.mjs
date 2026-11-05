import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version);
assert.deepEqual(manifest.permissions, ["storage"]);
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...manifest.content_scripts.flatMap((script) => script.js),
  ...Object.values(manifest.icons),
]) {
  assert(existsSync(join("dist", file)), `Missing extension artifact: ${file}`);
}
for (const file of ["content.js", "background.js"]) {
  const code = readFileSync(join("dist", file), "utf8");
  assert(!/\beval\s*\(|new Function\s*\(/.test(code), `${file} contains MV3-incompatible code`);
}
console.log(`Verified Linkarr ${manifest.version}: MV3 manifest and all entry points are present.`);
