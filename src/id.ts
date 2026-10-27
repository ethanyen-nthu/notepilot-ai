// getRandomValues is available on LAN HTTP too; randomUUID requires HTTPS.
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
