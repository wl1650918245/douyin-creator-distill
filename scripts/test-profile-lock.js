const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  RUNTIME_DIR,
  acquireProfileLock,
  acquireProfileLockWithRetry,
} = require("../src/config/runtime-config");

const profilePath = path.join(os.tmpdir(), `douyin-profile-lock-${crypto.randomUUID()}`);
const fingerprint = crypto.createHash("sha1").update(path.resolve(profilePath)).digest("hex");
const lockFile = path.join(RUNTIME_DIR, "profile-locks", `${fingerprint}.lock.json`);

(async () => {
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, profilePath }), "utf8");
    const recovered = acquireProfileLock(profilePath);
    assert.throws(() => acquireProfileLock(profilePath), (error) => error.code === "PROFILE_LOCK_BUSY");

    const waiting = acquireProfileLockWithRetry(profilePath, { timeoutMs: 500, retryIntervalMs: 20 });
    setTimeout(() => recovered.release(), 60);
    const resumed = await waiting;
    resumed.release();

    assert.equal(fs.existsSync(lockFile), false);
    console.log("profile lock recovery and serialization ok");
  } finally {
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
