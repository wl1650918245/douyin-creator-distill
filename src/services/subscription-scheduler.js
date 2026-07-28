const { submit } = require("./directory-crawl-service");
const {
  failSubscriptionCheck,
  getSubscription,
  hasActiveSubscriptionTask,
  listDueSubscriptions,
  markSubscriptionStarted,
} = require("./task-store");

const TICK_INTERVAL_MS = 60000;
let timer = null;
let ticking = false;

function submitSubscriptionCheck(subscription) {
  if (!subscription || !subscription.enabled) throw new Error("该关注规则已暂停");
  if (hasActiveSubscriptionTask(subscription.id)) throw new Error("该来源已有检查任务正在运行或排队");
  markSubscriptionStarted(subscription.id);
  try {
    return submit(subscription.source, {
      sourceMode: subscription.source_type === "favorites" ? "favorites" : "profile",
      accountRole: subscription.account_role,
      collectionIds: subscription.collectionIds,
      subscriptionId: subscription.id,
      triggerMode: "subscription",
    });
  } catch (error) {
    failSubscriptionCheck(subscription.id, error.message);
    throw error;
  }
}

function runSubscriptionNow(id) {
  const subscription = getSubscription(id);
  if (!subscription) throw new Error("关注规则不存在");
  return submitSubscriptionCheck(subscription);
}

function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const subscription of listDueSubscriptions()) {
      try { submitSubscriptionCheck(subscription); } catch { /* 状态已由提交函数记录。 */ }
    }
  } finally {
    ticking = false;
  }
}

function startSubscriptionScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_INTERVAL_MS);
  timer.unref?.();
}

function stopSubscriptionScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { runSubscriptionNow, startSubscriptionScheduler, stopSubscriptionScheduler, submitSubscriptionCheck };
