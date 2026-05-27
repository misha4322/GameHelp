import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const rootDir = process.cwd();
const envLocalPath = path.join(rootDir, ".env.local");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envLocalPath)) {
  const r = dotenv.config({ path: envLocalPath, override: true });
  if (r.error) console.warn("[load-env] .env.local:", r.error.message);
}
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}
