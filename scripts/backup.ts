import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Vault } from "../lib/vault";
export function restoreBackup(file: string, destination: string) {
  if (existsSync(destination))
    throw new Error(
      "The destination already exists. Restore into a new folder; existing data will not be overwritten.",
    );
  const raw = readFileSync(file);
  if (raw.length > 500 * 1024 * 1024)
    throw new Error("Backup exceeds the 500 MB restore limit.");
  const b = JSON.parse(raw.toString());
  if (
    b.format !== "agreement-logic-encrypted-backup-v1" ||
    !Array.isArray(b.files) ||
    b.files.length > 10000
  )
    throw new Error("Unsupported backup.");
  const names = new Set<string>();
  const decoded: { name: string; data: Buffer }[] = [];
  for (const f of b.files) {
    if (
      !f ||
      typeof f.name !== "string" ||
      typeof f.data !== "string" ||
      !(f.name === "vault.json" || /^[a-f0-9-]{36}\.vault$/.test(f.name)) ||
      names.has(f.name)
    )
      throw new Error("Invalid backup file list.");
    names.add(f.name);
    const data = Buffer.from(f.data, "base64");
    if (data.toString("base64") !== f.data)
      throw new Error("Invalid file encoding.");
    if (
      f.name !== "vault.json" &&
      (data.length < 32 || data.subarray(0, 4).toString() !== "ALE1")
    )
      throw new Error("Invalid encrypted document.");
    decoded.push({ name: f.name, data });
  }
  if (!names.has("vault.json")) throw new Error("Vault metadata is missing.");
  const meta = JSON.parse(
    decoded.find((f) => f.name === "vault.json")!.data.toString(),
  );
  if (
    meta.version !== 1 ||
    typeof meta.salt !== "string" ||
    Buffer.from(meta.salt, "base64").length !== 32 ||
    typeof meta.check !== "string"
  )
    throw new Error("Invalid vault metadata.");
  const temp = destination + ".restore-" + randomUUID();
  mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    for (const f of decoded)
      writeFileSync(path.join(temp, f.name), f.data, { mode: 0o600 });
    renameSync(temp, destination);
  } catch (e) {
    rmSync(temp, { recursive: true, force: true });
    throw e;
  }
  return decoded.length - 1;
}
if (process.argv[1]?.endsWith("backup.ts") && process.argv[2]) {
  try {
    if (process.argv[2] !== "restore" || !process.argv[3] || !process.argv[4])
      throw new Error("Usage: npm run restore -- backup.json NEW_DESTINATION");
    console.log(
      `Restored ${restoreBackup(process.argv[3], path.resolve(process.argv[4]))} encrypted documents. Stop the app before selecting this vault using AGREEMENT_DATA_DIR. Unlock it with its original passphrase to verify integrity.`,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Restore failed.");
    process.exitCode = 1;
  }
}
