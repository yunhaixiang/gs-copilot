const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:11434/v1/chat/completions",
  apiKey: "",
  model: "qwen2.5:7b-instruct",
  systemPrompt:
    "You are a grading assistant. Given rubric items and a student answer, pick the best matching rubric item indices. Return JSON only.",
  questionText: "",
  solutionText: "",
  temperature: 0.2,
  maxTokens: 512
};

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById("endpoint").value = settings.endpoint;
  document.getElementById("apiKey").value = settings.apiKey;
  document.getElementById("model").value = settings.model;
  document.getElementById("systemPrompt").value = settings.systemPrompt;
  document.getElementById("questionText").value = settings.questionText;
  document.getElementById("solutionText").value = settings.solutionText;
  document.getElementById("temperature").value = settings.temperature;
  document.getElementById("maxTokens").value = settings.maxTokens;
}

async function saveSettings() {
  const settings = {
    endpoint: document.getElementById("endpoint").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim(),
    systemPrompt: document.getElementById("systemPrompt").value.trim(),
    questionText: document.getElementById("questionText").value.trim(),
    solutionText: document.getElementById("solutionText").value.trim(),
    temperature: Number(document.getElementById("temperature").value),
    maxTokens: Number(document.getElementById("maxTokens").value)
  };

  await chrome.storage.sync.set(settings);
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

document.getElementById("save").addEventListener("click", () => {
  saveSettings();
});

loadSettings();
