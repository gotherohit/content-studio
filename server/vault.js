// Encryption for stored secrets, borrowed from the desktop shell.
//
// This server runs as a child of the Electron main process, and only the main process can
// reach Electron's safeStorage — on Windows that is DPAPI, which ties the ciphertext to
// the logged-in Windows account. So the server does not hold an encryption key of its
// own: it hands a secret up the existing IPC channel, and gets back an opaque blob that
// nothing outside this Windows account can read, not even another account on the same
// machine.
//
// Run without the desktop shell (`npm run dev`) and there is nothing to borrow. In that
// case `available()` is false, the caller writes plaintext to an owner-only file as
// before, and the UI says so rather than implying a protection that is not there.

const TIMEOUT = 4000;

export function createVault() {
  const pending = new Map();
  let seq = 0;
  let availability = null;

  if (process.send) {
    process.on("message", (msg) => {
      if (msg?.type !== "vault:result") return;
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(msg.error)) : waiter.resolve(msg.value);
    });
  }

  /** One round trip to the shell. A shell that never answers must not hang a request. */
  function ask(op, value) {
    if (!process.send) return Promise.reject(new Error("no desktop shell to encrypt with"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("the desktop shell did not answer"));
      }, TIMEOUT);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      process.send({ type: "vault", id, op, value });
    });
  }

  /** Asked once and remembered: it cannot change while the app is running. */
  async function available() {
    availability ??= ask("available").then((v) => Boolean(v)).catch(() => false);
    return availability;
  }

  /** @returns base64 ciphertext, or null when there is nothing to encrypt with. */
  async function encrypt(plaintext) {
    if (!plaintext || !(await available())) return null;
    return ask("encrypt", plaintext).catch(() => null);
  }

  /**
   * @returns the secret, or null if this blob cannot be read — which is what happens to
   * a credentials file copied from another machine or another Windows account.
   */
  async function decrypt(ciphertext) {
    if (!ciphertext || !(await available())) return null;
    return ask("decrypt", ciphertext).catch(() => null);
  }

  return { available, encrypt, decrypt };
}
