import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  name: string;
  version: string;
}

function readPackageJson(): PackageJson {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/version.js → ../../package.json
  const pkgPath = join(here, "..", "..", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  return JSON.parse(raw) as PackageJson;
}

export async function runVersion(_args: string[]): Promise<number> {
  const pkg = readPackageJson();
  process.stdout.write(`${pkg.name} v${pkg.version}\n`);
  process.stdout.write(`Node.js ${process.version}\n`);
  process.stdout.write(`Platform: ${process.platform} ${process.arch}\n`);
  return 0;
}
