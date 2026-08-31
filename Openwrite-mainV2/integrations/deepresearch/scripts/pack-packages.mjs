import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packagesDir = join(root, "packages");
const destination = join(root, "artifacts/packages");
mkdirSync(destination, { recursive: true });

for (const name of readdirSync(packagesDir).sort()) {
  const dir = join(packagesDir, name);
  if (!existsSync(join(dir, "package.json"))) continue;
  const result = spawnSync("pnpm", ["pack", "--pack-destination", destination], {
    cwd: dir,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Packed packages into ${destination}`);
