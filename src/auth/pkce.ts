import { createHash, randomBytes } from "node:crypto";

/** Creates the verifier, challenge, and state used by one local OAuth login. */
export function createPkceLogin(): {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
} {
  const codeVerifier = randomBytes(48).toString("base64url");
  return {
    codeVerifier,
    codeChallenge: createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
    state: randomBytes(24).toString("base64url"),
  };
}
