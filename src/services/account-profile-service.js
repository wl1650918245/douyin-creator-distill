const path = require("path");
const { spawn } = require("child_process");
const {
  publicAccountProfiles,
  readRoleStatus,
  resolveAccountRole,
  saveAccountProfiles,
  writeRoleStatus,
} = require("../config/account-profiles");
const { isProcessAlive } = require("../config/runtime-config");

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
  const currentStatus = readRoleStatus(role);
  if (
    currentStatus.helperPid
    && isProcessAlive(currentStatus.helperPid)
    && ["launching_login", "waiting_for_login", "login_ready"].includes(currentStatus.phase)
  ) {
    return {
      ok: true,
      role,
      effectiveProfileId: profile.profileId,
      shared: profile.shared,
      status: "login_window_already_open",
    };
  }
  const child = spawn(process.execPath, [LOGIN_SCRIPT, `--role=${role}`], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  writeRoleStatus(role, { ready: false, phase: "launching_login", helperPid: child.pid });
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
