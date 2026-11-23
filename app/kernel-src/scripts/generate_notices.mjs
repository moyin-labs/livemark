import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const metadata = JSON.parse(readFileSync("../.build/kernel_meta.json", "utf8"));
const packages = new Map();
for (const file of Object.keys(metadata.inputs)) {
  if (!file.includes("node_modules/")) continue;
  let folder = dirname(resolve(file));
  let pkg;
  while (dirname(folder) !== folder) {
    const manifest = resolve(folder, "package.json");
    if (existsSync(manifest)) {
      const candidate = JSON.parse(readFileSync(manifest, "utf8"));
      if (candidate.name && candidate.version) {
        pkg = candidate;
        break;
      }
    }
    folder = dirname(folder);
  }
  if (!pkg) continue;
  if (packages.has(pkg.name)) continue;
  const notices = readdirSync(folder)
    .filter((name) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name))
    .map((name) => {
      try {
        return readFileSync(resolve(folder, name), "utf8");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  packages.set(
    pkg.name,
    `${pkg.name} ${pkg.version}\nLicense: ${pkg.license || "See upstream notices"}\n${notices.join("\n")}`,
  );
}
const text =
  "LiveMark WebKernel — Third-party notices\nGenerated from the actual esbuild input graph.\n\n" +
  [...packages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text)
    .join("\n\n" + "=".repeat(72) + "\n\n") +
  "\n\n" + "=".repeat(72) + "\n\nPT Serif\nLicense: SIL OFL 1.1\n" +
  readFileSync("static/style/fonts/PTSerif-OFL.txt", "utf8");
writeFileSync(
  "../Sources/LiveMark/Resources/WebKernel/THIRD_PARTY_NOTICES.txt",
  text,
);
console.log(`Third-party notices: ${packages.size} packages`);
