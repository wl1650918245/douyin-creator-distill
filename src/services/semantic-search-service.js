const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { RUNTIME_DIR, ensureDir } = require("../config/runtime-config");
const semanticModels = require("./semantic-model-service");
const {
  appendLog,
  createTask,
  getTask,
  listTasks,
  updateTask,
  updateTaskProgress,
} = require("./task-store");
const { sourceKeyFromTask } = require("./work-ledger-store");
const { chunkText, contentHash, normalizeText } = require("./semantic-text");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PYTHON_PATH = path.join(PROJECT_ROOT, "runtime", "python", ".venv", "Scripts", "python.exe");
const WORKER_PATH = path.join(PROJECT_ROOT, "scripts", "semantic_embedding_worker.py");
const JOB_DIR = path.join(RUNTIME_DIR, "semantic-jobs");
const MODEL_CONFIG_PATH = path.join(PROJECT_ROOT, "config", "model.config.json");
const db = new DatabaseSync(path.join(RUNTIME_DIR, "agent-state.sqlite"));

db.exec(`PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS semantic_documents (
  source_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  transcript_path TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_key, video_id)
);
CREATE TABLE IF NOT EXISTS semantic_embeddings (
  source_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  text_excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key, video_id, model_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_semantic_embeddings_source_model
  ON semantic_embeddings(source_key, model_id);`);

function now() { return new Date().toISOString(); }

function bufferToFloat32(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}

function dotProduct(left, right) {
  const size = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < size; index += 1) score += left[index] * right[index];
  return score;
}

function inferenceReady() {
  return fs.existsSync(PYTHON_PATH)
    && fs.existsSync(WORKER_PATH)
    && fs.existsSync(path.join(PROJECT_ROOT, "runtime", "python", ".venv", "Lib", "site-packages", "sentence_transformers"));
}

function activeModel() {
  const settings = semanticModels.getSettings();
  const model = settings.models.find((entry) => entry.id === settings.activeModel);
  if (!model?.installed) throw new Error("当前智能筛选模型尚未安装，请先到设置中心下载。");
  if (!inferenceReady()) throw new Error("智能搜索推理环境尚未安装，请先运行项目依赖诊断。");
  return model;
}

function readCrawlData(task) {
  if (!task?.output_path || !fs.existsSync(task.output_path)) throw new Error("当前目录没有可读取的审核 JSON。");
  const data = JSON.parse(fs.readFileSync(task.output_path, "utf8").replace(/^\uFEFF/, ""));
  return { ...data, works: Array.isArray(data.works) ? data.works : [] };
}

function preferredTranscriptArtifacts(sourceKey) {
  const jobs = db.prepare(`SELECT video_id,provider,output_path,updated_at FROM artifacts
    WHERE source_key=? AND artifact_type='transcript-markdown' AND status='completed'
      AND video_id IS NOT NULL
    ORDER BY CASE WHEN LOWER(COALESCE(provider,'')) LIKE '%whisper%' THEN 0 ELSE 1 END,
      updated_at DESC`).all(sourceKey)
    .filter((job) => job.output_path && fs.existsSync(job.output_path));
  const byVideo = new Map();
  for (const job of jobs) {
    const key = String(job.video_id);
    if (!byVideo.has(key)) byVideo.set(key, job);
  }
  return byVideo;
}

function documentForWork(work, transcriptJob) {
  const videoId = String(work.videoId || work.awemeId || work.id || "").trim();
  if (!videoId) return null;
  const title = normalizeText(work.title || work.desc || `未命名作品 ${videoId}`);
  const description = normalizeText(work.desc || work.title || "");
  const transcript = transcriptJob?.output_path
    ? normalizeText(fs.readFileSync(transcriptJob.output_path, "utf8")).slice(0, 80000)
    : "";
  const base = [`标题：${title}`, description ? `简介：${description}` : ""].filter(Boolean).join("\n");
  const transcriptChunks = chunkText(transcript);
  const chunks = transcriptChunks.length
    ? transcriptChunks.map((part) => `${base}\n正文片段：${part}`)
    : [base];
  return {
    videoId,
    title,
    description,
    transcriptPath: transcriptJob?.output_path || null,
    contentHash: contentHash(`${base}\n${transcript}`),
    chunks,
  };
}

function taskContext(crawlTaskId) {
  const task = getTask(crawlTaskId);
  if (!task) throw new Error("目录任务不存在。");
  if (!task.audit_status || !["passed", "partial"].includes(task.audit_status)) throw new Error("只有已完成 JSON 审核的目录才能建立智能索引。");
  if (task.audit_status === "partial") throw new Error("当前目录仍在待复核状态，不能建立智能索引。");
  const sourceKey = sourceKeyFromTask(task);
  if (!sourceKey) throw new Error("当前目录缺少稳定来源标识。");
  return { task, sourceKey, data: readCrawlData(task) };
}

function writeInput(records) {
  ensureDir(JOB_DIR);
  const filepath = path.join(JOB_DIR, `${crypto.randomUUID()}.jsonl`);
  fs.writeFileSync(filepath, records.map((record) => JSON.stringify(record)).join("\n"), "utf8");
  return filepath;
}

function runEmbeddings({ model, records, kind = "document", onEmbedding = () => {}, onProgress = () => {} }) {
  if (!records.length) return Promise.resolve({ total: 0, dimension: 0 });
  const inputPath = writeInput(records);
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, [WORKER_PATH, "--model", model.directory, "--input", inputPath, "--kind", kind], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    let stdout = "";
    let stderr = "";
    let result = { total: 0, dimension: 0 };
    const consume = (flush = false) => {
      const lines = stdout.split(/\r?\n/);
      stdout = flush ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "embedding") onEmbedding(event);
        if (event.type === "progress") onProgress(event);
        if (event.type === "completed") result = event;
        if (event.type === "error") stderr = `${stderr}\n${event.error}`;
      }
    };
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); consume(); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdout.trim()) stdout += "\n";
      consume(true);
      fs.promises.unlink(inputPath).catch(() => {});
      if (code === 0) resolve(result);
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(" ") || `智能搜索推理进程异常退出（${code}）。`));
    });
  });
}

function upsertDocument(sourceKey, document) {
  db.prepare(`INSERT INTO semantic_documents (source_key,video_id,title,description,transcript_path,content_hash,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_key,video_id) DO UPDATE SET title=excluded.title,
      description=excluded.description,transcript_path=excluded.transcript_path,
      content_hash=excluded.content_hash,updated_at=excluded.updated_at`)
    .run(sourceKey, document.videoId, document.title, document.description, document.transcriptPath, document.contentHash, now());
}

function indexStatus(crawlTaskId) {
  const { task, sourceKey, data } = taskContext(crawlTaskId);
  const settings = semanticModels.getSettings();
  const model = settings.models.find((entry) => entry.id === settings.activeModel);
  const row = db.prepare(`SELECT COUNT(DISTINCT video_id) AS indexed_works, COUNT(*) AS chunks, MAX(created_at) AS indexed_at
    FROM semantic_embeddings WHERE source_key=? AND model_id=?`).get(sourceKey, settings.activeModel);
  const activeTask = listTasks().find((entry) => entry.summary?.provider === "semantic-index"
    && entry.summary?.crawlTaskId === crawlTaskId && ["queued", "running"].includes(entry.status));
  return {
    crawlTaskId,
    sourceKey,
    creatorName: task.creator_name || task.source,
    modelId: settings.activeModel,
    modelLabel: model?.label || settings.activeModel,
    modelInstalled: Boolean(model?.installed),
    inferenceReady: inferenceReady(),
    totalWorks: data.works.length,
    indexedWorks: Number(row?.indexed_works || 0),
    chunks: Number(row?.chunks || 0),
    indexedAt: row?.indexed_at || null,
    activeTaskId: activeTask?.id || null,
  };
}

async function runIndexTask(taskId, crawlTaskId) {
  try {
    const { task, sourceKey, data } = taskContext(crawlTaskId);
    const model = activeModel();
    const transcripts = preferredTranscriptArtifacts(sourceKey);
    const documents = data.works
      .map((work) => documentForWork(work, transcripts.get(String(work.videoId || work.awemeId || work.id))))
      .filter(Boolean);
    updateTask(taskId, { status: "running", phase: "正在准备作品语义索引" });
    appendLog(taskId, `使用 ${model.label} 建立索引，共 ${documents.length} 条作品。`);
    const pending = [];
    const documentByKey = new Map();
    let reused = 0;
    for (const document of documents) {
      upsertDocument(sourceKey, document);
      const existing = db.prepare(`SELECT COUNT(*) AS total FROM semantic_embeddings
        WHERE source_key=? AND video_id=? AND model_id=? AND content_hash=?`)
        .get(sourceKey, document.videoId, model.id, document.contentHash);
      if (Number(existing?.total || 0) === document.chunks.length) {
        reused += 1;
        continue;
      }
      db.prepare("DELETE FROM semantic_embeddings WHERE source_key=? AND video_id=? AND model_id=?")
        .run(sourceKey, document.videoId, model.id);
      document.chunks.forEach((text, chunkIndex) => {
        const key = `${document.videoId}:${chunkIndex}`;
        documentByKey.set(key, { document, chunkIndex, text });
        pending.push({ key, text });
      });
    }
    updateTask(taskId, {
      summary_json: JSON.stringify({ provider: "semantic-index", crawlTaskId, modelId: model.id, total: documents.length, completed: reused, reused, pendingChunks: pending.length }),
    });
    let embeddedChunks = 0;
    let lastProgress = 0;
    await runEmbeddings({
      model,
      records: pending,
      onEmbedding(event) {
        const entry = documentByKey.get(event.key);
        if (!entry) return;
        db.prepare(`INSERT OR REPLACE INTO semantic_embeddings
          (source_key,video_id,model_id,chunk_index,content_hash,dimension,embedding,text_excerpt,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(sourceKey, entry.document.videoId, model.id, entry.chunkIndex, entry.document.contentHash,
            Number(event.dimension), Buffer.from(event.vector, "base64"), entry.text.slice(0, 1600), now());
        embeddedChunks += 1;
      },
      onProgress(event) {
        if (event.completed - lastProgress < 8 && event.completed !== event.total) return;
        lastProgress = event.completed;
        updateTaskProgress(taskId, {
          stage: "semantic_index",
          label: "正在生成作品语义索引",
          discovered: event.completed,
          expectedTotal: event.total,
          detail: `${model.label} · 已复用 ${reused} 条作品`,
        });
      },
    });
    const status = indexStatus(crawlTaskId);
    updateTask(taskId, {
      status: "waiting_for_user",
      phase: "智能索引已就绪",
      summary_json: JSON.stringify({ provider: "semantic-index", crawlTaskId, modelId: model.id, total: documents.length, completed: status.indexedWorks, reused, embeddedChunks, chunks: status.chunks }),
    });
    appendLog(taskId, `智能索引完成：${status.indexedWorks} 条作品，${status.chunks} 个语义片段。`);
  } catch (error) {
    updateTask(taskId, { status: "failed", phase: "智能索引失败", error_message: error.message });
    appendLog(taskId, `智能索引失败：${error.message}`);
  }
}

function submitIndex(crawlTaskId) {
  const { task } = taskContext(crawlTaskId);
  const model = activeModel();
  const existing = listTasks().find((entry) => entry.summary?.provider === "semantic-index"
    && entry.summary?.crawlTaskId === crawlTaskId && entry.summary?.modelId === model.id
    && ["queued", "running"].includes(entry.status));
  if (existing) return { taskId: existing.id, reusedTask: true };
  const taskId = crypto.randomUUID();
  createTask(taskId, `智能索引 / ${task.creator_name || task.source}`, {
    sourceMode: task.source_mode,
    accountRole: task.account_role,
    profileId: task.profile_id,
    options: { crawlTaskId, modelId: model.id },
  });
  updateTask(taskId, {
    phase: "等待本地语义模型",
    creator_name: task.creator_name || task.source,
    summary_json: JSON.stringify({ provider: "semantic-index", crawlTaskId, modelId: model.id, total: 0, completed: 0 }),
  });
  setImmediate(() => runIndexTask(taskId, crawlTaskId));
  return { taskId, reusedTask: false };
}

async function queryVector(model, query) {
  let vector = null;
  await runEmbeddings({
    model,
    kind: "query",
    records: [{ key: "query", text: query }],
    onEmbedding(event) { vector = bufferToFloat32(Buffer.from(event.vector, "base64")); },
  });
  if (!vector) throw new Error("本地模型没有返回查询向量。");
  return vector;
}

function loadModelConfig() {
  if (!fs.existsSync(MODEL_CONFIG_PATH)) throw new Error("精排复核需要先在设置中心配置分析模型。");
  const config = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "").trim();
  if (!baseUrl || !apiKey || !model || apiKey.startsWith("replace-")) throw new Error("精排复核的分析模型配置不完整。");
  return { baseUrl, apiKey, model };
}

function parseJsonObject(value) {
  const cleaned = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

async function rerankResults(query, results) {
  const config = loadModelConfig();
  const endpoint = config.baseUrl.endsWith("/v1") ? `${config.baseUrl}/chat/completions` : `${config.baseUrl}/v1/chat/completions`;
  const candidates = results.slice(0, 20).map((item) => ({
    resultKey: item.resultKey || item.videoId,
    title: item.title,
    description: item.description,
    evidence: item.excerpt,
  }));
  const response = await axios.post(endpoint, {
    model: config.model,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "你是检索精排器。只能根据候选证据排序，不得新增或改写 resultKey。只输出 JSON。" },
      { role: "user", content: `查询：${query}\n候选：${JSON.stringify(candidates)}\n输出格式：{\"orderedResultKeys\":[\"...\"]}` },
    ],
  }, { timeout: 60000, headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" } });
  const content = response.data?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(content);
  const ordered = parsed.orderedResultKeys || parsed.orderedVideoIds || [];
  const ranks = new Map(ordered.map((id, index) => [String(id), index]));
  return {
    model: config.model,
    results: [...results].sort((left, right) => (ranks.get(left.resultKey || left.videoId) ?? 9999) - (ranks.get(right.resultKey || right.videoId) ?? 9999)),
  };
}

function listSources() {
  const settings = semanticModels.getSettings();
  const model = settings.models.find((entry) => entry.id === settings.activeModel);
  const sources = db.prepare(`SELECT embeddings.source_key,
      COUNT(DISTINCT embeddings.video_id) AS indexed_works,
      COUNT(*) AS chunks,
      MAX(embeddings.created_at) AS indexed_at,
      MAX(NULLIF(works.creator_name,'')) AS creator_name,
      MAX(NULLIF(works.source_type,'')) AS source_type
    FROM semantic_embeddings embeddings
    LEFT JOIN works ON works.source_key=embeddings.source_key AND works.video_id=embeddings.video_id
    WHERE embeddings.model_id=?
    GROUP BY embeddings.source_key
    ORDER BY indexed_at DESC`).all(settings.activeModel).map((row) => {
    const favorite = String(row.source_key).startsWith("favorites:");
    return {
      sourceKey: row.source_key,
      sourceType: row.source_type || (favorite ? "favorites" : "creator"),
      displayName: favorite ? "我的收藏夹" : row.creator_name || String(row.source_key).replace(/^creator:/, ""),
      indexedWorks: Number(row.indexed_works || 0),
      chunks: Number(row.chunks || 0),
      indexedAt: row.indexed_at,
    };
  });
  return {
    modelId: settings.activeModel,
    modelLabel: model?.label || settings.activeModel,
    modelInstalled: Boolean(model?.installed),
    inferenceReady: inferenceReady(),
    sources,
    totalWorks: sources.reduce((total, source) => total + source.indexedWorks, 0),
    totalChunks: sources.reduce((total, source) => total + source.chunks, 0),
  };
}

async function searchAcross({ query, sourceKeys = [], limit = 50, rerank = false }) {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length < 2 || normalizedQuery.length > 200) throw new Error("请输入 2 至 200 个字符的搜索内容。");
  if (!Array.isArray(sourceKeys) || sourceKeys.length > 100) throw new Error("搜索来源参数不正确。");
  const model = activeModel();
  const selectedKeys = [...new Set(sourceKeys.map((value) => String(value).trim()).filter(Boolean))];
  const sourceClause = selectedKeys.length ? ` AND embeddings.source_key IN (${selectedKeys.map(() => "?").join(",")})` : "";
  const rows = db.prepare(`SELECT embeddings.source_key,embeddings.video_id,embeddings.dimension,
      embeddings.embedding,embeddings.text_excerpt,documents.title,documents.description,
      works.video_url,works.creator_name,works.source_type
    FROM semantic_embeddings embeddings
    JOIN semantic_documents documents ON documents.source_key=embeddings.source_key AND documents.video_id=embeddings.video_id
    LEFT JOIN works ON works.source_key=embeddings.source_key AND works.video_id=embeddings.video_id
    WHERE embeddings.model_id=?${sourceClause}`).all(model.id, ...selectedKeys);
  if (!rows.length) throw new Error(selectedKeys.length ? "所选来源尚未建立当前模型的智能索引。" : "还没有可供跨资产搜索的智能索引。");
  const queryEmbedding = await queryVector(model, normalizedQuery);
  const bestByWork = new Map();
  for (const row of rows) {
    if (Number(row.dimension) !== queryEmbedding.length) continue;
    const resultKey = `${row.source_key}::${row.video_id}`;
    const score = dotProduct(queryEmbedding, bufferToFloat32(row.embedding));
    const current = bestByWork.get(resultKey);
    if (!current || score > current.score) bestByWork.set(resultKey, { row, score });
  }
  const results = [...bestByWork.entries()].map(([resultKey, match]) => {
    const favorite = String(match.row.source_key).startsWith("favorites:");
    return {
      resultKey,
      sourceKey: match.row.source_key,
      sourceType: match.row.source_type || (favorite ? "favorites" : "creator"),
      sourceName: favorite ? "我的收藏夹" : match.row.creator_name || String(match.row.source_key).replace(/^creator:/, ""),
      videoId: String(match.row.video_id),
      videoUrl: match.row.video_url || `https://www.douyin.com/video/${match.row.video_id}`,
      score: Math.round(match.score * 10000) / 10000,
      title: match.row.title || `未命名作品 ${match.row.video_id}`,
      description: match.row.description || "",
      excerpt: match.row.text_excerpt,
    };
  }).sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  if (!rerank) return { query: normalizedQuery, modelId: model.id, reranked: false, searchedSources: selectedKeys, results };
  const ranked = await rerankResults(normalizedQuery, results);
  return { query: normalizedQuery, modelId: model.id, reranked: true, rerankerModel: ranked.model, searchedSources: selectedKeys, results: ranked.results };
}

async function search({ crawlTaskId, query, limit = 50, rerank = false }) {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length < 2 || normalizedQuery.length > 200) throw new Error("请输入 2 至 200 个字符的搜索内容。");
  const { sourceKey, data } = taskContext(crawlTaskId);
  const model = activeModel();
  const rows = db.prepare(`SELECT video_id,dimension,embedding,text_excerpt FROM semantic_embeddings
    WHERE source_key=? AND model_id=?`).all(sourceKey, model.id);
  if (!rows.length) throw new Error("当前目录尚未建立该模型的智能索引。");
  const queryEmbedding = await queryVector(model, normalizedQuery);
  const bestByVideo = new Map();
  for (const row of rows) {
    if (Number(row.dimension) !== queryEmbedding.length) continue;
    const score = dotProduct(queryEmbedding, bufferToFloat32(row.embedding));
    const current = bestByVideo.get(String(row.video_id));
    if (!current || score > current.score) bestByVideo.set(String(row.video_id), { score, excerpt: row.text_excerpt });
  }
  const worksById = new Map(data.works.map((work) => [String(work.videoId || work.awemeId || work.id), work]));
  const results = [...bestByVideo.entries()]
    .filter(([videoId]) => worksById.has(videoId))
    .map(([videoId, match]) => {
      const work = worksById.get(videoId);
      return {
        videoId,
        score: Math.round(match.score * 10000) / 10000,
        title: work.title || work.desc || `未命名作品 ${videoId}`,
        description: work.desc || work.title || "",
        excerpt: match.excerpt,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  if (!rerank) return { query: normalizedQuery, modelId: model.id, reranked: false, results };
  const ranked = await rerankResults(normalizedQuery, results);
  return { query: normalizedQuery, modelId: model.id, reranked: true, rerankerModel: ranked.model, results: ranked.results };
}

module.exports = {
  chunkText,
  contentHash,
  indexStatus,
  inferenceReady,
  listSources,
  normalizeText,
  search,
  searchAcross,
  submitIndex,
};
