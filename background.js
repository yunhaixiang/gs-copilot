const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:11434/v1/chat/completions",
  apiKey: "",
  model: "qwen2.5:7b-instruct",
  systemPrompt:
    "You are a grading assistant. Given rubric items and a student answer, pick the best matching rubric item indices. Return JSON only.",
  temperature: 0.2,
  maxTokens: 512
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function callQwen(payload) {
  const settings = await getSettings();
  const headers = {
    "Content-Type": "application/json"
  };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  let endpoint = settings.endpoint.trim();
  if (endpoint.endsWith("/v1")) {
    endpoint = `${endpoint}/chat/completions`;
  } else if (endpoint.endsWith("/v1/")) {
    endpoint = `${endpoint}chat/completions`;
  }

  const body = {
    model: settings.model,
    messages: payload.messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "qwenSuggest") {
    callQwen(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({ ok: false, error: error.message.replace("Qwen", "AI") })
      );
    return true;
  }
  if (message && message.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (message && message.type === "captureScreenshot") {
    const windowId =
      sender.tab && sender.tab.windowId ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (!dataUrl) {
        sendResponse({ ok: false, error: "Failed to capture screenshot." });
        return;
      }
      sendResponse({ ok: true, data: dataUrl });
    });
    return true;
  }
  if (message && message.type === "aiSuggestWithScreenshot") {
    const windowId = sender.tab && sender.tab.windowId ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, async (dataUrl) => {
      try {
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }
        if (!dataUrl) {
          throw new Error("Failed to capture screenshot.");
        }

        const screenshots = Array.isArray(message.payload.screenshots)
          ? message.payload.screenshots
          : [];
        const images = screenshots.length ? screenshots : [dataUrl];
        const payload = {
          messages: [
            { role: "system", content: message.payload.systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: message.payload.userPrompt },
                ...images.map((url) => ({ type: "image_url", image_url: { url } }))
              ]
            }
          ]
        };

        const data = await callQwen(payload);
        sendResponse({ ok: true, data });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }
  return false;
});
