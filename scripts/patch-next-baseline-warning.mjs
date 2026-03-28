import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function main() {
  const target = require.resolve("next/dist/compiled/browserslist/index.js");
  const source = await readFile(target, "utf8");
  const pattern = /&&console\.warn\("\[baseline-browser-mapping\][^"]*"\);/;

  if (!pattern.test(source)) {
    return;
  }

  const patched = source.replace(pattern, "&&0;");
  if (patched !== source) {
    await writeFile(target, patched, "utf8");
    console.log("Silenced Next baseline-browser-mapping freshness warning.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
