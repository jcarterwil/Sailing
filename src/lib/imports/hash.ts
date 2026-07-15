import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 over raw uploaded bytes. */
export function sha256HexBytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
