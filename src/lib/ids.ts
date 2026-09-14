import { createHash, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return prefix + "_" + randomUUID().replaceAll("-", "");
}

export const newId = createId;

export function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return prefix + "_" + digest;
}

export function hashPayload(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const hashText = hashPayload;
