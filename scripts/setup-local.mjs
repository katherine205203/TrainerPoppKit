import { randomBytes } from "node:crypto";
import { chmod, access, writeFile } from "node:fs/promises";

const file = new URL("../.dev.vars", import.meta.url);
try {
  await access(file);
  console.log("Local secrets already exist; left unchanged.");
} catch {
  const password = randomBytes(28).toString("base64url");
  const signingSecret = randomBytes(48).toString("base64url");
  await writeFile(file, `OWNER_PASSWORD=${password}\nSESSION_SECRET=${signingSecret}\n`, { mode: 0o600, flag: "wx" });
  await chmod(file, 0o600);
  console.log("Created ignored local owner secrets in .dev.vars. Open that local file to view the password; it is excluded from Git.");
}
