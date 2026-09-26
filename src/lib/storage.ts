import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { aiConfig } from "@/config/ai";

// Local stand-in for object storage (see DECISIONS.md). The rest of the app only ever sees a
// storage KEY like "receipts/<uuid>.jpg"; swapping in S3/R2 means rewriting only this file.
// Keys are generated here, never from user input, so a key can't point outside the storage dir.

// turbopackIgnore: the storage dir is runtime data, not code; without it the build traces the whole project.
const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), aiConfig.storage.localDir);

function resolveKey(key: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ root, key);
  // Defence in depth: keys are ours, but refuse anything that would escape the storage root.
  if (!full.startsWith(root + path.sep)) throw new Error(`invalid storage key: ${key}`);
  return full;
}

export function newReceiptKey(extension: string): string {
  return `receipts/${randomUUID()}.${extension}`;
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  // "wx": fail rather than overwrite if the key somehow already exists.
  await writeFile(full, bytes, { flag: "wx" });
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}
