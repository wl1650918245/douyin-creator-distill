const path = require("path");
const { spawn } = require("child_process");
const {
  publicAccountProfiles,
  resolveAccountRole,
  saveAccountProfiles,
  writeRoleStatus,
} = require("../config/account-profiles");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const LOGIN_SCRIPT = path.join(PROJECT_ROOT, "src", "adapters", "douyin", "profile-login.js");

function getAccountProfiles() {
  return publicAccountProfiles();
}

function updateAccountProfiles(input) {
  saveAccountProfiles(input);
  return publicAccountProfiles();
}

function launchAccountLogin(role) {
  const profile = resolveAccountRole(role);
  writeRoleStatus(role, { ready: false, phase: "launching_login" });
  const child = spawn(process.execPath, [LOGIN_SCRIPT, `--role=${role}`], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return {
    ok: true,
    role,
    effectiveProfileId: profile.profileId,
    shared: profile.shared,
    status: "launching_login",
  };
}

module.exports = {
  getAccountProfiles,
  launchAccountLogin,
  updateAccountProfiles,
};
