const { chromium } = require('playwright');
const {
  acquireProfileLock,
  buildChromeLaunchArgs,
  findChromePath,
  resolveChromeProfile,
} = require('../../config/runtime-config');
const { resolveAccountRole, writeRoleStatus } = require('../../config/account-profiles');

const roleArg = process.argv.find((arg) => arg.startsWith('--role='));
const role = roleArg ? roleArg.slice('--role='.length) : 'content';
const account = resolveAccountRole(role);

function writeStatus(status) {
  return writeRoleStatus(role, { helperPid: process.pid, ...status });
}

async function checkLoginReady(page) {
  try {
    return await page.evaluate(async () => {
      const response = await fetch(
        '/aweme/v1/web/general/search/single/?keyword=douyin&search_channel=user&offset=0&count=1&aid=6383&device_platform=webapp&channel=channel_pc_web',
        { credentials: 'include' }
      );
      const payload = await response.json();
      return {
        ok: response.ok,
        statusCode: payload?.status_code ?? null,
        statusMsg: payload?.status_msg || '',
        ready: payload?.status_code !== 2483,
      };
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      statusMsg: error.message,
      ready: false,
    };
  }
}

async function main() {
  const profileConfig = resolveChromeProfile(account.profilePath);
  const profileLock = acquireProfileLock(profileConfig.profilePath);
  process.once('exit', () => profileLock.release());

  let context = null;

  try {
    context = await chromium.launchPersistentContext(profileConfig.userDataDir, {
      executablePath: findChromePath(),
      headless: false,
      args: buildChromeLaunchArgs(profileConfig.profileDirectory),
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.douyin.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    console.log('DouyinScraper profile browser is open.');
    console.log(`Log in for role=${role}, profile=${account.profileId}.`);
    console.log('Only run one task at a time against this profile.');
    console.log('This helper will close automatically after login is verified.');

    writeStatus({
      ready: false,
      phase: 'waiting_for_login',
    });

    const deadline = Date.now() + 15 * 60 * 1000;
    let verified = false;

    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);

      if (page.isClosed()) {
        writeStatus({
          ready: false,
          phase: 'browser_closed',
        });
        return;
      }

      const status = await checkLoginReady(page);
      writeStatus({
        ready: status.ready,
        phase: status.ready ? 'login_ready' : 'waiting_for_login',
        statusCode: status.statusCode,
        statusMsg: status.statusMsg,
      });

      if (status.ready) {
        verified = true;
        console.log('Dedicated Douyin profile is logged in and ready.');
        console.log('Login state is being saved; the browser will close automatically.');
        writeStatus({
          ready: true,
          phase: 'login_ready',
          verifiedAt: new Date().toISOString(),
          statusCode: status.statusCode,
          statusMsg: status.statusMsg,
        });
        // Give Chrome a short window to flush cookies before releasing the profile lock.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        break;
      }
    }

    if (!verified) writeStatus({ ready: false, phase: 'helper_timeout' });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    profileLock.release();
  }
}

main().catch((error) => {
  writeStatus({
    ready: false,
    phase: 'helper_error',
    error: error.message,
  });
  console.error(error);
  process.exit(1);
});
