import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  existsSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { AppError } from "./errors";
import type { Matter, MatterView } from "./types";

export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from("ALE1"), iv, cipher.getAuthTag(), body]);
}
export function decrypt(data: Buffer, key: Buffer): Buffer {
  if (data.length < 32 || data.subarray(0, 4).toString() !== "ALE1")
    throw new AppError(
      "The encrypted file is invalid. Restore it from your backup.",
    );
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  cipher.setAuthTag(data.subarray(16, 32));
  try {
    return Buffer.concat([cipher.update(data.subarray(32)), cipher.final()]);
  } catch {
    throw new AppError(
      "Unable to unlock or read this vault. Check the passphrase or restore a backup.",
    );
  }
}
export class Vault {
  key?: Buffer;
  token?: string;
  timer?: ReturnType<typeof setTimeout>;
  failures: number[] = [];
  controllers = new Set<AbortController>();
  constructor(public dir: string) {}
  get configured() {
    return existsSync(path.join(this.dir, "vault.json"));
  }
  initDir() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
  }
  atomic(name: string, data: Buffer | string) {
    this.initDir();
    const tmp = path.join(this.dir, `${randomUUID()}.tmp`);
    writeFileSync(tmp, data, { mode: 0o600 });
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path.join(this.dir, name));
  }
  unlock(passphrase: string, create = false) {
    this.failures = this.failures.filter((t) => Date.now() - t < 600_000);
    if (this.failures.length >= 8)
      throw new AppError("Too many unlock attempts. Wait ten minutes.", 429);
    if (passphrase.length < 14 || passphrase.length > 256)
      throw new AppError("Use a passphrase of 14–256 characters.");
    if (create === this.configured)
      throw new AppError(
        create
          ? "A vault already exists. Unlock it instead."
          : "Create a vault first.",
      );
    let salt: Buffer, key: Buffer;
    if (create) {
      salt = randomBytes(32);
      key = scryptSync(passphrase, salt, 32, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      });
      this.atomic(
        "vault.json",
        JSON.stringify({
          version: 1,
          salt: salt.toString("base64"),
          check: encrypt(Buffer.from("agreement-logic-vault"), key).toString(
            "base64",
          ),
        }),
      );
    } else {
      const config = JSON.parse(
        readFileSync(path.join(this.dir, "vault.json"), "utf8"),
      );
      salt = Buffer.from(config.salt, "base64");
      key = scryptSync(passphrase, salt, 32, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      });
      try {
        if (
          decrypt(Buffer.from(config.check, "base64"), key).toString() !==
          "agreement-logic-vault"
        )
          throw new Error();
      } catch {
        key.fill(0);
        this.failures.push(Date.now());
        throw new AppError("The passphrase did not unlock this vault.", 401);
      }
    }
    this.lock();
    this.key = key;
    this.token = randomBytes(32).toString("hex");
    this.failures = [];
    this.touch();
    return this.token;
  }
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock(), 30 * 60 * 1000);
    this.timer.unref();
  }
  authorize(token: string | undefined) {
    if (
      !this.key ||
      !this.token ||
      !token ||
      token.length !== this.token.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))
    )
      throw new AppError("Unlock your vault to continue.", 401);
    this.touch();
  }
  lock() {
    clearTimeout(this.timer);
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    this.key?.fill(0);
    this.key = undefined;
    this.token = undefined;
  }
  read(id: string): Matter {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new AppError("Matter not found.", 404);
    if (!this.key) throw new AppError("Unlock your vault.", 401);
    const file = path.join(this.dir, id + ".vault");
    if (!existsSync(file)) throw new AppError("Matter not found.", 404);
    return JSON.parse(decrypt(readFileSync(file), this.key).toString("utf8"));
  }
  save(matter: Matter, expectedRevision: number) {
    if (!this.key) throw new AppError("Unlock your vault.", 401);
    const file = path.join(this.dir, matter.id + ".vault");
    const current = existsSync(file) ? this.read(matter.id).revision : 0;
    if (current !== expectedRevision)
      throw new AppError(
        "This matter changed in another window. Reload and try again.",
        409,
      );
    matter.revision = current + 1;
    this.atomic(
      matter.id + ".vault",
      encrypt(Buffer.from(JSON.stringify(matter)), this.key),
    );
  }
  list(): Matter[] {
    if (!this.key) throw new AppError("Unlock your vault.", 401);
    return readdirSync(this.dir)
      .filter((n) => n.endsWith(".vault"))
      .map((n) => this.read(n.slice(0, -6)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
const globalVault = globalThis as typeof globalThis & {
  agreementVault?: Vault;
};
export const vault = (globalVault.agreementVault ??= new Vault(
  path.resolve(
    /* turbopackIgnore: true */ process.env.AGREEMENT_DATA_DIR ||
      ".private-data",
  ),
));
export function view(m: Matter): MatterView {
  const { original, ...source } = m.source;
  void original;
  return { ...m, source };
}
