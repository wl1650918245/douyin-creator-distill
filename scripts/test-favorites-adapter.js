const assert = require("assert/strict");
const { normalizeCollections, parseArgs } = require("../src/adapters/douyin/favorites-crawler");

const collections = normalizeCollections({
  collects_list: [
    { collects_id: 101, name: "AI 工具", count: 12 },
    { collects_id_str: "101", collects_name: "重复目录" },
    { collects_info: { collects_id_str: "202", name: "写作" }, aweme_count: 4 },
    { name: "缺少 ID" },
  ],
});
assert.deepEqual(collections, [
  { id: "101", name: "AI 工具", count: 12 },
  { id: "202", name: "写作", count: 4 },
]);
assert.deepEqual(parseArgs(["--list-only", "--profile=C:\\Chrome\\Favorites", "--collection-ids=101,202,101"]), {
  listOnly: true,
  profile: "C:\\Chrome\\Favorites",
  collectionIds: ["101", "202", "101"],
});
console.log("favorites adapter tests passed");
