const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-creator-distill-subscriptions-"));
process.env.KNOWLEDGE_ASSET_ROOT = root;

const store = require("../src/services/task-store");

function writeCatalog(name, ids) {
  const filepath = path.join(root, `${name}.json`);
  fs.writeFileSync(filepath, JSON.stringify({ works: ids.map((videoId) => ({ videoId })) }), "utf8");
  return filepath;
}

const cache = store.saveFavoritesDirectoryCache("favorites-owner", [{ id: "101", name: "AI", count: 12 }], "collections.json");
assert.equal(cache.collections.length, 1);
assert.equal(store.getFavoritesDirectoryCache("favorites-owner", 1440).collections[0].id, "101");

const firstCatalog = writeCatalog("first", ["1", "2"]);
store.createTask("creator-task", "demo_creator", { sourceMode: "profile", accountRole: "content", profileId: "content-collector", options: { kind: "profile-crawl" } });
store.updateTask("creator-task", { status: "waiting_for_user", creator_name: "示例博主", output_path: firstCatalog });
const creatorSubscription = store.upsertSubscriptionFromTask("creator-task");
assert.equal(creatorSubscription.source_key, "creator:demo_creator");
assert.equal(store.listSubscriptions().length, 1);

store.deleteSubscription(creatorSubscription.id);
store.upsertSubscriptionFromTask("creator-task", { reactivate: false });
assert.equal(store.listSubscriptions().length, 0, "历史回填不能复活已取消的关注");
store.upsertSubscriptionFromTask("creator-task");
assert.equal(store.listSubscriptions().length, 1, "用户再次手动抓取后可以重新关注");

const secondCatalog = writeCatalog("second", ["1", "2", "3"]);
const completed = store.completeSubscriptionCheck(creatorSubscription.id, secondCatalog);
assert.deepEqual(completed.lastResult, { totalCount: 3, newCount: 1, removedCount: 0 });

for (const [taskId, source] of [["favorite-old", "?????"], ["favorite-new", "我的收藏夹"]]) {
  store.createTask(taskId, source, { sourceMode: "favorites", accountRole: "favorites", profileId: "favorites-owner", options: { kind: "favorites-crawl", collectionIds: ["101"] } });
  store.updateTask(taskId, { status: "waiting_for_user", output_path: firstCatalog });
  store.upsertSubscriptionFromTask(taskId);
}
assert.equal(store.listSubscriptions().filter((item) => item.source_type === "favorites").length, 1, "收藏夹按 Profile 稳定身份去重");

store.closeTaskStore();
fs.rmSync(root, { recursive: true, force: true });
console.log("subscription and favorites cache tests passed");
