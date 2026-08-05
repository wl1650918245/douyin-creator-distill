const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-distill-semantic-models-"));
process.env.SEMANTIC_SEARCH_CONFIG_PATH = path.join(temporaryDirectory, "semantic-search.config.json");
process.env.EMBEDDING_MODELS_DIR = path.join(temporaryDirectory, "models");
process.env.ANALYSIS_MODEL_CONFIG_PATH = path.join(temporaryDirectory, "model.config.json");

const service = require("../src/services/semantic-model-service");

(async () => {
  try {
    fs.writeFileSync(process.env.ANALYSIS_MODEL_CONFIG_PATH, JSON.stringify({ baseUrl: "https://model.example", apiKey: "secret-value", model: "analysis-test-model" }), "utf8");
    let settings = service.getSettings();
    assert.equal(settings.activeModel, "lightweight");
    assert.equal(settings.models.length, 2);
    assert.equal(settings.reranker.configured, true);
    assert.equal(settings.reranker.model, "analysis-test-model");
    assert.equal(JSON.stringify(settings).includes("secret-value"), false);

    const lightweightDirectory = service.modelDirectory("lightweight");
    fs.mkdirSync(lightweightDirectory, { recursive: true });
    fs.writeFileSync(path.join(lightweightDirectory, "config.json"), "{}", "utf8");
    fs.writeFileSync(path.join(lightweightDirectory, "model.safetensors"), "fake-weights", "utf8");
    fs.writeFileSync(path.join(lightweightDirectory, ".download-complete.json"), "{}", "utf8");
    assert.equal(service.installationState("lightweight").installed, true);

    settings = service.saveSettings({ activeModel: "high_precision" });
    assert.equal(settings.activeModel, "high_precision");
    assert.equal(settings.models.find((model) => model.id === "high_precision").selected, true);
    assert.throws(() => service.saveSettings({ activeModel: "unknown" }), /未知/);

    await service.deleteModel("lightweight");
    assert.equal(fs.existsSync(lightweightDirectory), false);
    assert.equal(service.installationState("lightweight").installed, false);
    console.log("semantic model settings contract ok");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
