// Prints a GUARDIAN_SIGNING_KEY line for .env (Ed25519 private key, newlines escaped as \n).
import { generateKeyPairSync } from "node:crypto";

const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
console.log(`GUARDIAN_SIGNING_KEY=${pem.replace(/\n/g, "\\n")}`);
