import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const failures = [];
const warnings = [];

for (const name of readdirSync(packagesDir).sort()) {
  const dir = join(packagesDir, name);
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const label = pkg.name ?? name;

  requireField(pkg, "type", "module", label);
  requireField(pkg, "main", "./dist/index.js", label);
  requireField(pkg, "types", "./dist/index.d.ts", label);
  if (pkg.exports?.["."]?.import !== "./dist/index.js") failures.push(`${label}: package.json exports["."].import must be "./dist/index.js"`);
  if (pkg.exports?.["."]?.types !== "./dist/index.d.ts") failures.push(`${label}: package.json exports["."].types must be "./dist/index.d.ts"`);
  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) failures.push(`${label}: package.json files must include "dist"`);
  if (!Array.isArray(pkg.files) || !pkg.files.includes("!dist/tests")) failures.push(`${label}: package.json files must exclude "!dist/tests"`);
  if (!Array.isArray(pkg.files) || !pkg.files.includes("!dist/__tests__")) failures.push(`${label}: package.json files must exclude "!dist/__tests__"`);
  if (!Array.isArray(pkg.files) || !pkg.files.includes("!dist/**/__tests__")) failures.push(`${label}: package.json files must exclude nested "__tests__"`);
  if (!pkg.scripts?.build) failures.push(`${label}: scripts.build is required`);
  if (!pkg.scripts?.typecheck) failures.push(`${label}: scripts.typecheck is required`);
  if (!pkg.scripts?.test) failures.push(`${label}: scripts.test is required`);
  if (!existsSync(join(dir, "src/index.ts"))) failures.push(`${label}: src/index.ts is required`);
  if (!existsSync(join(dir, "tsconfig.json"))) failures.push(`${label}: tsconfig.json is required`);
  if (!existsSync(join(dir, "dist/index.js"))) failures.push(`${label}: dist/index.js is required; run pnpm build before packaging`);
  if (!existsSync(join(dir, "dist/index.d.ts"))) failures.push(`${label}: dist/index.d.ts is required; run pnpm build before packaging`);
  if (pkg.private !== true) warnings.push(`${label}: private is not true; confirm registry/access before publishing`);
}

if (warnings.length) {
  console.warn("Package readiness warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("Package readiness failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Package readiness check passed.");
}

function requireField(pkg, key, expected, label) {
  if (pkg[key] !== expected) failures.push(`${label}: package.json ${key} must be ${JSON.stringify(expected)}`);
}
