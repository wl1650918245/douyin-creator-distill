const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "self-media-account-profiles-"));
process.env.ACCOUNT_PROFILES_CONFIG_PATH = path.join(temporaryDirectory, "account-profiles.config.json");

const {
  publicAccountProfiles,
  resolveAccountRole,
  saveAccountProfiles,
} = require("../src/config/account-profiles");

try {
  const shared = publicAccountProfiles();
  assert.equal(shared.favoritesBinding, "shared");
  assert.equal(shared.roles.content.effectiveProfileId, shared.roles.favorites.effectiveProfileId);
  assert.equal(shared.roles.favorites.shared, true);
  assert.equal(JSON.stringify(shared).includes("profilePath"), false);
  assert.equal(JSON.stringify(shared).includes("DouyinScraper"), false);

  saveAccountProfiles({ favoritesBinding: "independent" });
  const independent = publicAccountProfiles();
  assert.equal(independent.favoritesBinding, "independent");
  assert.notEqual(independent.roles.content.effectiveProfileId, independent.roles.favorites.effectiveProfileId);
  assert.equal(independent.roles.favorites.shared, false);

  assert.throws(() => saveAccountProfiles({ favoritesBinding: "invalid" }), /shared 或 independent/);
  assert.throws(() => resolveAccountRole("unknown"), /content 或 favorites/);
  console.log("account profile contract ok");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
