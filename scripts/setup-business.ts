import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "config/business.json");
const source = resolve(process.cwd(), "config/business.example.json");

if (existsSync(target)) {
  console.log("config/business.json already exists; nothing changed.");
  process.exit(0);
}

mkdirSync(resolve(process.cwd(), "config"), { recursive: true });
copyFileSync(source, target);
console.log(
  "Created config/business.json. Replace every {{PLACEHOLDER}} before starting automation."
);
