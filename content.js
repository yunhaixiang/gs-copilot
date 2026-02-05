const PANEL_ID = "gs-copilot-panel";
const HIGHLIGHT_CLASS = "gs-copilot-highlight";
const STORAGE_KEYS = {
  rubricSelector: "gs-copilot-rubric-selector",
  panelPosition: "gs-copilot-panel-position",
  panelSize: "gs-copilot-panel-size",
  panelCollapsed: "gs-copilot-panel-collapsed"
};

const DEFAULT_SETTINGS = {
  systemPrompt:
    "You are a grading assistant. Given rubric items and a student answer image, pick the best matching rubric item indices. Return JSON only."
};

let rubricItems = [];
let lastSuggestions = [];
let preferredRubricSelector = sessionStorage.getItem(STORAGE_KEYS.rubricSelector);
let setStatusFn = null;
let groupKeyMap = new Map();

function setStatus(message, isError) {
  if (setStatusFn) {
    setStatusFn(message, isError);
  }
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function findRubricContainer() {
  if (preferredRubricSelector) {
    const preferred = document.querySelector(preferredRubricSelector);
    if (preferred) return preferred;
  }

  const candidates = Array.from(
    document.querySelectorAll(
      "[class*='rubric'], [id*='rubric'], [data-qa*='rubric']"
    )
  );
  if (!candidates.length) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const buttons = candidate.querySelectorAll(
      "button, [role='button'], input[type='checkbox'], input[type='radio']"
    );
    const textLength = cleanText(candidate.textContent || "").length;
    const score = buttons.length * 5 + Math.min(textLength, 1000) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function findAssociatedLabel(input) {
  if (!input || !input.id) return null;
  return document.querySelector(`label[for='${input.id}']`);
}

function getElementText(el) {
  if (el instanceof HTMLInputElement) {
    const label = findAssociatedLabel(el) || el.closest("label");
    if (label) {
      return cleanText(label.innerText || label.textContent || "");
    }
  }
  return cleanText(el.innerText || el.textContent || "");
}

function collectRubricItems() {
  const container = findRubricContainer() || document.body;
  const rubricFromProps = getRubricFromReactProps();
  if (rubricFromProps.length) {
    const domEntries = getRubricDomEntries(container);
    groupKeyMap = getGroupToggleKeyMap(document);
    return rubricFromProps.map((item) => {
      const element =
        findRubricElementById(item.id, container) ||
        matchRubricDomEntry(item, domEntries) ||
        findRubricElementByGroupText(item.groupLabel, item.description, item.weight, container) ||
        findRubricElementByText(item.description, item.weight, container);
      return {
        id: item.id,
        text: item.display,
        element,
        description: item.description,
        weight: item.weight,
        groupId: item.groupId,
        groupLabel: item.groupLabel,
        position: item.position,
        key: getRubricKeyForItem(item, element, container)
      };
    });
  }

  return collectRubricItemsFromDom(container);
}

function collectRubricItemsFromDom(container) {
  const pointsPattern = /[+-]\\s*\\d+(?:\\.\\d+)?/;
  const blacklist = [
    "add rubric item",
    "create group",
    "import",
    "point adjustment",
    "provide comments",
    "rubric settings",
    "grid view",
    "collapse view",
    "grading comment"
  ];

  const pointsNodes = Array.from(container.querySelectorAll("*")).filter((node) => {
    const text = cleanText(node.textContent || "");
    return text.length > 0 && pointsPattern.test(text);
  });

  const seen = new Set();
  const items = [];

  for (const node of pointsNodes) {
    let row = node.closest("li, tr, [role='listitem'], [class*='rubric'], [data-qa*='rubric']");
    if (!row) {
      row = node.parentElement;
    }
    if (!row) continue;
    const rowText = cleanText(row.textContent || "");
    if (!rowText || rowText.length < 3) continue;
    const lower = rowText.toLowerCase();
    if (blacklist.some((entry) => lower.includes(entry))) continue;
    if (seen.has(lower)) continue;

    const clickable =
      row.querySelector("button, [role='button'], label, input[type='checkbox'], input[type='radio']") ||
      row;

    seen.add(lower);
    items.push({ text: rowText, element: clickable });
  }

  return items;
}

function getRubricFromReactProps() {
  const node = document.querySelector("[data-react-class='SubmissionGrader']");
  if (!node) return [];
  const raw = node.getAttribute("data-react-props");
  if (!raw) return [];
  try {
    let props;
    try {
      props = JSON.parse(raw);
    } catch (_error) {
      const normalized = raw.replace(/&quot;/g, '"');
      props = JSON.parse(normalized);
    }
    const items = Array.isArray(props.rubric_items) ? props.rubric_items : [];
    const groups = Array.isArray(props.rubric_item_groups) ? props.rubric_item_groups : [];
    const groupMap = new Map(
      groups.map((group) => [group.id, group.description || "Group"])
    );
    if (!items.length) return [];
    return items
      .filter((item) => item && item.description)
      .map((item) => {
        const weight = item.weight || "0.0";
        const groupLabel = item.group_id ? groupMap.get(item.group_id) : null;
        const display = `${formatPoints(weight)} ${item.description}`;
        return {
          id: item.id,
          description: item.description,
          weight,
          groupId: item.group_id || null,
          groupLabel,
          position: item.position,
          display
        };
      });
  } catch (_error) {
    return [];
  }
}

function formatPoints(weight) {
  const value = Number.parseFloat(weight);
  if (Number.isNaN(value)) return String(weight);
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function findRubricElementById(id, container) {
  if (!id || !container) return null;
  const selectors = [
    `[data-rubric-item-id="${id}"]`,
    `[data-rubric-id="${id}"]`,
    `[data-rubric-entry-id="${id}"]`,
    `[data-rubric_entry_id="${id}"]`,
    `[data-id="${id}"]`
  ];
  for (const selector of selectors) {
    const found = container.querySelector(selector);
    if (found) {
      return (
        found.closest("button, [role='button'], label, input[type='checkbox'], input[type='radio']") ||
        found
      );
    }
  }
  return null;
}

function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

function findRubricElementByText(description, weight, container) {
  if (!container || !description) return null;
  const normalizedDescription = normalizeText(description);
  const pointsText = formatPoints(weight);
  const candidates = Array.from(
    container.querySelectorAll("button, [role='button'], label, input[type='checkbox'], input[type='radio']")
  );

  let best = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const text = normalizeText(candidate.textContent || "");
    if (!text) continue;
    if (!text.includes(normalizedDescription)) continue;
    let score = normalizedDescription.length;
    if (text.includes(pointsText.toLowerCase())) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function findRubricElementByGroupText(groupLabel, description, weight, container) {
  if (!groupLabel || !container) return null;
  const groupMatches = Array.from(container.querySelectorAll("*")).filter((node) =>
    normalizeText(node.textContent || "").includes(normalizeText(groupLabel))
  );
  if (!groupMatches.length) return null;

  for (const groupNode of groupMatches) {
    const scope = groupNode.closest("section, div, li") || groupNode.parentElement || container;
    const candidate = findRubricElementByText(description, weight, scope);
    if (candidate) return candidate;
  }
  return null;
}

function getRubricDomEntries(container) {
  if (!container) return [];
  const entries = Array.from(container.querySelectorAll(".rubricEntry"));
  if (entries.length) {
    return entries
      .map((entry, index) => {
        const button = entry.querySelector("button.rubricItem--key");
        if (!button) return null;
        const pointsEl = entry.querySelector(".rubricField-points");
        const descEl = entry.querySelector(".markdownText");
        const points = pointsEl ? cleanText(pointsEl.textContent || "") : "";
        const desc = descEl ? cleanText(descEl.textContent || "") : "";
        const text = cleanText(`${points} ${desc}`);
        const groupLabel = findGroupLabelForButton(button);
        return {
          index,
          button,
          text,
          points,
          description: desc,
          groupLabel
        };
      })
      .filter(Boolean);
  }

  const buttons = Array.from(container.querySelectorAll("button.rubricItem--key"));
  return buttons.map((button, index) => {
    const itemRoot =
      button.closest(".rubricItem") ||
      button.closest(".rubricEntry") ||
      button.parentElement;
    const pointsDesc =
      itemRoot && itemRoot.querySelector(".rubricItem--pointsAndDescription")
        ? itemRoot.querySelector(".rubricItem--pointsAndDescription")
        : itemRoot || button;
    const text = cleanText(pointsDesc.textContent || "");
    const points = extractPoints(text);
    const groupLabel = findGroupLabelForButton(button);
    return {
      index,
      button,
      text,
      points,
      description: text,
      groupLabel
    };
  });
}

function extractPoints(text) {
  const match = text.match(/[+-]\\s*\\d+(?:\\.\\d+)?/);
  return match ? match[0].replace(/\\s+/g, "") : "";
}

function findGroupLabelForButton(button) {
  if (!button) return null;
  const groupItems = button.closest(".rubricItemGroup--rubricItems");
  if (!groupItems) return null;
  const headerId = groupItems.getAttribute("aria-describedby");
  if (!headerId) return null;
  const header = document.getElementById(headerId);
  if (!header) return null;
  const desc =
    header.querySelector(".rubricField-description") ||
    header.querySelector(".markdownText") ||
    header;
  const label = cleanText(desc.textContent || "");
  return label || null;
}

function matchRubricDomEntry(item, domEntries) {
  if (!domEntries || !domEntries.length) return null;
  const descNeedle = normalizeText(item.description);
  const pointsNeedle = formatPoints(item.weight).toLowerCase();
  const groupNeedle = item.groupLabel ? normalizeText(item.groupLabel) : "";

  let best = null;
  let bestScore = 0;

  for (const entry of domEntries) {
    const descText = normalizeText(entry.description || entry.text || "");
    if (!descText.includes(descNeedle)) continue;
    let score = descNeedle.length;
    if (entry.points && entry.points.toLowerCase() === pointsNeedle) score += 50;
    if (groupNeedle && entry.groupLabel) {
      const entryGroup = normalizeText(entry.groupLabel);
      if (entryGroup.includes(groupNeedle)) score += 25;
      else continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best ? best.button : null;
}

function getRubricKeyForItem(item, element, container) {
  const target = findRubricToggleButton(element || null);
  if (target) {
    const text = cleanText(target.textContent || "");
    if (text) return text;
    const aria = target.getAttribute("aria-label") || "";
    const match = aria.match(/Toggle rubric item\\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  if (item.groupId) {
    const groupRegion = getGroupRegionById(item.groupId, container || document.body);
    if (groupRegion) {
      const match = matchRubricDomEntry(item, getRubricDomEntries(groupRegion));
      const keyEl = match ? findRubricToggleButton(match) : null;
      if (keyEl) {
        const text = cleanText(keyEl.textContent || "");
        if (text) return text;
      }
    }
  }
  return "";
}

function getGroupToggleKeyMap(container) {
  const map = new Map();
  const buttons = Array.from(container.querySelectorAll("button.rubricItemGroup--key"));
  buttons.forEach((button) => {
    const controls = button.getAttribute("aria-controls");
    const match = controls ? controls.match(/rubric-items-group-(\\d+)/) : null;
    if (!match) return;
    const groupId = match[1];
    const key = cleanText(button.textContent || "");
    if (groupId && key) {
      map.set(groupId, key);
    }
  });
  return map;
}

function extractAnswerText(rubricContainer) {
  const selectors = [
    "[data-qa*='submission']",
    "[data-qa*='answer']",
    "[class*='submission']",
    "[class*='answer']",
    "[class*='response']",
    "main",
    "#main",
    ".content"
  ];

  const candidates = [];
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      if (rubricContainer && rubricContainer.contains(node)) continue;
      const text = cleanText(node.textContent || "");
      if (text.length < 30) continue;
      candidates.push({ node, text });
    }
  }

  if (!candidates.length) return "";

  candidates.sort((a, b) => b.text.length - a.text.length);
  return candidates[0].text.slice(0, 4000);
}

function clearHighlights() {}

function applyHighlight(_indices) {}

function applyRubricItem(index) {
  const item = rubricItems[index];
  if (!item) return false;
  const controlsId = item.groupId ? ensureGroupExpanded(item.groupId, item.groupLabel) : null;
  const clickItem = (attemptsLeft) => {
    let resolved = resolveRubricElement(item);
    if (!resolved && controlsId) {
      const region = document.getElementById(controlsId);
      if (region) {
        resolved = findRubricElementByText(item.description, item.weight, region);
      }
    }
    if (resolved) {
      resolved.scrollIntoView({ block: "center", behavior: "smooth" });
      const targets = [];
      const key = findRubricToggleButton(resolved);
      if (key) targets.push(key);
      const points = resolved.closest(".rubricItem")?.querySelector(".rubricItem--pointsAndDescription");
      if (points) targets.push(points);
      const row = resolved.closest(".rubricItem") || resolved.closest(".rubricEntry") || resolved;
      if (row) targets.push(row);
      const fallback = resolved.querySelector("button, [role='button']") || resolved;
      targets.push(fallback);
      for (const target of targets) {
        simulateClick(target);
      }
      const statusTarget = key || resolved;
      if (statusTarget && setStatusFn) {
        const pressed = statusTarget.getAttribute("aria-pressed");
        setStatusFn(
          `Clicked (synthetic): ${statusTarget.tagName.toLowerCase()} aria-pressed=${pressed || "n/a"}`
        );
      }
      return;
    }
    if (attemptsLeft > 0) {
      setTimeout(() => clickItem(attemptsLeft - 1), 200);
    }
  };
  if (item.groupId) {
    setTimeout(() => clickItem(5), 200);
  } else {
    clickItem(0);
  }
  return true;
}

function ensureGroupExpanded(groupId, groupLabel) {
  if (!groupId) return;
  const selectors = [
    `button.rubricItemGroup--key[aria-controls$="rubric-items-group-${groupId}"]`,
    `button.rubricItemGroup--key[id$="accordion-header-${groupId}"]`,
    `button.rubricItemGroup--key[aria-label*="rubric item group"][aria-label*="${groupId}"]`
  ];
  let button = null;
  for (const selector of selectors) {
    button = document.querySelector(selector);
    if (button) break;
  }
  if (!button && groupLabel) {
    const groupButtons = Array.from(document.querySelectorAll("button.rubricItemGroup--key"));
    button =
      groupButtons.find((btn) => {
        const controls = btn.getAttribute("aria-controls");
        if (!controls) return false;
        const groupRegion = document.getElementById(controls);
        if (!groupRegion) return false;
        const headerId = groupRegion.getAttribute("aria-describedby");
        const header = headerId ? document.getElementById(headerId) : null;
        const label =
          header && header.querySelector(".markdownText")
            ? header.querySelector(".markdownText").textContent
            : header ? header.textContent : "";
        return normalizeText(label).includes(normalizeText(groupLabel));
      }) || null;
  }
  if (!button) return;
  const expanded = button.getAttribute("aria-expanded");
  if (expanded === "false") {
    simulateClick(button);
  }
  return button.getAttribute("aria-controls") || null;
}

function resolveRubricElement(item) {
  if (item.element) return item.element;
  const container = findRubricContainer() || document.body;

  if (item.groupId) {
    const groupRegion = getGroupRegionById(item.groupId, container);
    if (groupRegion) {
      const groupEntries = getRubricDomEntries(groupRegion);
      const matchedInGroup = matchRubricDomEntry(item, groupEntries);
      if (matchedInGroup) {
        item.element = matchedInGroup;
        return matchedInGroup;
      }
      const pos = Number.parseInt(item.position, 10);
      if (!Number.isNaN(pos) && groupEntries[pos]) {
        item.element = groupEntries[pos].button;
        return groupEntries[pos].button;
      }
    }
    return null;
  }

  const domEntries = getRubricDomEntries(container);
  const matched = matchRubricDomEntry(item, domEntries);
  if (matched) {
    item.element = matched;
    return matched;
  }
  return null;
}

function getQuestionIdFromPage() {
  const node = document.querySelector("[data-react-class='SubmissionGrader']");
  if (!node) return "";
  const raw = node.getAttribute("data-react-props");
  if (!raw) return "";
  try {
    const props = JSON.parse(raw);
    return props?.question?.id ? String(props.question.id) : "";
  } catch (_e) {
    try {
      const normalized = raw.replace(/&quot;/g, '"');
      const props = JSON.parse(normalized);
      return props?.question?.id ? String(props.question.id) : "";
    } catch (_err) {
      return "";
    }
  }
}

function getGroupRegionById(groupId, container) {
  if (!groupId) return null;
  return (
    container.querySelector(`.rubricItemGroup--rubricItems#question-${getQuestionIdFromPage()}-rubric-items-group-${groupId}`) ||
    container.querySelector(`.rubricItemGroup--rubricItems[id$="rubric-items-group-${groupId}"]`)
  );
}

function findRubricToggleButton(root) {
  if (!root) return null;
  if (root.classList && root.classList.contains("rubricItem--key")) {
    return root;
  }
  const direct = root.querySelector("button.rubricItem--key");
  if (direct) return direct;
  const ariaMatch = root.querySelector("button[aria-label^='Toggle rubric item']");
  if (ariaMatch) return ariaMatch;
  const ancestor = root.closest("button.rubricItem--key");
  if (ancestor) return ancestor;
  return null;
}

function simulateClick(target) {
  if (!target) return;
  try {
    target.focus();
  } catch (_e) {
    // ignore focus errors
  }
  try {
    if (typeof target.click === "function") {
      target.click();
    }
  } catch (_e) {
    // ignore click errors
  }
  const events = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"];
  events.forEach((type) => {
    const event =
      type.startsWith("pointer") && typeof PointerEvent !== "undefined"
        ? new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerType: "mouse",
            isPrimary: true
          })
        : new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: 1
          });
    target.dispatchEvent(event);
  });
}

function simulateGroupClick(target) {
  if (!target) return;
  try {
    if (typeof target.click === "function") {
      target.click();
    }
  } catch (_e) {
    // ignore click errors
  }
  const events = ["pointerdown", "mousedown", "mouseup", "click"];
  events.forEach((type) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1
      })
    );
  });
}

function installClickDebugListener() {
  if (installClickDebugListener.installed) return;
  installClickDebugListener.installed = true;
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.classList.contains("rubricItem--key") ||
        target.classList.contains("rubricItemGroup--key")
      ) {
        const pressed = target.getAttribute("aria-pressed");
        const expanded = target.getAttribute("aria-expanded");
        if (setStatusFn) {
          setStatusFn(
            `User click (trusted=${event.isTrusted}): ${target.className} pressed=${pressed || "n/a"} expanded=${expanded || "n/a"}`
          );
        }
      }
    },
    true
  );
}

function createPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="gs-copilot-header">
      <div class="gs-copilot-title">gs-copilot</div>
      <button class="gs-copilot-link" id="gs-copilot-options">Configure</button>
      <button class="gs-copilot-icon" id="gs-copilot-collapse" title="Collapse">−</button>
    </div>
    <div class="gs-copilot-section">
      <div class="gs-copilot-section-title gs-copilot-section-title--shots">Screenshot</div>
      <div class="gs-copilot-row">
        <button id="gs-copilot-take-shot" class="gs-copilot-action">Screenshot</button>
        <button id="gs-copilot-clear-shot" class="gs-copilot-action">Clear</button>
        <button id="gs-copilot-send-ai" class="gs-copilot-action">Send</button>
      </div>
      <div id="gs-copilot-shot-count" class="gs-copilot-note">0 Screenshots Taken</div>
      <div class="gs-copilot-note">Please keep the image visible.</div>
      <div class="gs-copilot-divider"></div>
      <div class="gs-copilot-section-title gs-copilot-section-title--ai">AI Suggestion</div>
      <div class="gs-copilot-row">
        <div id="gs-copilot-suggestion" class="gs-copilot-suggestion">—</div>
      </div>
      <div id="gs-copilot-status"></div>
      <div class="gs-copilot-divider"></div>
      <div class="gs-copilot-section-title gs-copilot-section-title--rubrics">Rubrics</div>
      <div id="gs-copilot-rubric-preview" class="gs-copilot-list"></div>
    </div>
  `;

  const rightEdge = document.createElement("div");
  rightEdge.className = "gs-copilot-resize-edge edge-right";
  const bottomEdge = document.createElement("div");
  bottomEdge.className = "gs-copilot-resize-edge edge-bottom";
  const cornerEdge = document.createElement("div");
  cornerEdge.className = "gs-copilot-resize-edge edge-corner";
  panel.appendChild(rightEdge);
  panel.appendChild(bottomEdge);
  panel.appendChild(cornerEdge);

  document.body.appendChild(panel);

  const optionsButton = panel.querySelector("#gs-copilot-options");
  const collapseButton = panel.querySelector("#gs-copilot-collapse");
  const statusEl = panel.querySelector("#gs-copilot-status");
  const suggestionEl = panel.querySelector("#gs-copilot-suggestion");
  const takeShotButton = panel.querySelector("#gs-copilot-take-shot");
  const sendAiButton = panel.querySelector("#gs-copilot-send-ai");
  const clearShotButton = panel.querySelector("#gs-copilot-clear-shot");
  const shotCountEl = panel.querySelector("#gs-copilot-shot-count");

  function setStatus(message, isError) {
    if (isError && message === "Failed to fetch") {
      // Suppress noisy network error; UI already shows config error.
      return;
    }
    if (isError) {
      console.error(`[gs-copilot] ${message}`);
    } else {
      console.log(`[gs-copilot] ${message}`);
    }
    statusEl.textContent = "";
    statusEl.className = "";
  }
  setStatusFn = setStatus;

  function updateRubric() {
    rubricItems = collectRubricItems();
  }

  function setSuggestionLine(state, payload = "") {
    suggestionEl.innerHTML = "";
    if (state === "asking") {
      const text = document.createElement("span");
      text.textContent = "Asking AI...";
      suggestionEl.appendChild(text);
      return;
    }

    if (state === "failed") {
      const text = document.createElement("span");
      text.className = "gs-copilot-suggestion-error";
      text.textContent = "AI Connection Failed: ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "gs-copilot-link gs-copilot-suggestion-retry";
      retry.textContent = "Retry?";
      retry.addEventListener("click", () => {
        requestAiSuggestions(true);
      });
      suggestionEl.appendChild(text);
      suggestionEl.appendChild(retry);
      return;
    }

    const text = document.createElement("span");
    text.textContent = payload || "—";
    if (payload === "AI Configuration Error") {
      text.className = "gs-copilot-suggestion-error";
    }
    suggestionEl.appendChild(text);
  }

  let aiInFlight = false;
  const screenshots = [];
  const updateShotCount = () => {
    shotCountEl.textContent = `${screenshots.length} Screenshots Taken`;
  };
  updateShotCount();

  async function captureScreenshot() {
    const response = await sendMessage({ type: "captureScreenshot" });
    if (!response.ok || !response.data) {
      throw new Error(response.error || "Screenshot failed");
    }
    screenshots.push(response.data);
    updateShotCount();
  }
  let aiRetryCount = 0;
  async function requestAiSuggestions(force = false) {
    if (aiInFlight && !force) return;
    if (!rubricItems.length) {
      aiRetryCount += 1;
      if (aiRetryCount <= 5) {
        setStatus("No rubric items found yet. Retrying...");
        setTimeout(() => {
          updateRubric();
          renderRubricPreview(panel, rubricItems, lastSuggestions);
          requestAiSuggestions(true);
        }, 800);
      } else {
        setStatus("No rubric items found.");
      }
      return;
    }
    aiRetryCount = 0;
    aiInFlight = true;
    setSuggestionLine("asking");
    try {
      if (!screenshots.length) {
        setSuggestionLine("ready", "No Screenshots Taken");
        return;
      }
      const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      const { systemPrompt, userPrompt } = buildPromptText(rubricItems, settings.systemPrompt);
      const response = await sendMessage({
        type: "aiSuggestWithScreenshot",
        payload: { systemPrompt, userPrompt, screenshots }
      });

      if (!response.ok) {
        throw new Error(response.error || "AI error");
      }

      const content = getResponseContent(response.data);
      if (!content) {
        throw new Error("AI Configuration Error");
      }
      lastSuggestions = parseSuggestions(content, rubricItems);
      renderRubricPreview(panel, rubricItems, lastSuggestions);
      applyHighlight(lastSuggestions.map((item) => item.index));
      const keySequence = buildSuggestionKeySequence(rubricItems, lastSuggestions);
      setSuggestionLine("ready", keySequence || "—");
      setStatus("Suggestions ready.");
      screenshots.length = 0;
      updateShotCount();
    } catch (error) {
      setSuggestionLine("ready", "AI Configuration Error");
      setStatus(error.message, true);
    } finally {
      aiInFlight = false;
    }
  }

  optionsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openOptions" });
  });

  collapseButton.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("gs-copilot-collapsed");
    collapseButton.textContent = collapsed ? "+" : "−";
    if (collapsed) {
      panel.dataset.prevHeight = panel.style.height || "";
      panel.dataset.prevMinHeight = panel.style.minHeight || "";
      panel.dataset.prevMaxHeight = panel.style.maxHeight || "";
      const header = panel.querySelector(".gs-copilot-header");
      const headerHeight = header ? header.getBoundingClientRect().height : 52;
      panel.style.height = `${headerHeight}px`;
      panel.style.minHeight = `${headerHeight}px`;
      panel.style.maxHeight = `${headerHeight}px`;
    } else if (panel.dataset.prevHeight !== undefined) {
      panel.style.height = panel.dataset.prevHeight;
      panel.style.minHeight = panel.dataset.prevMinHeight || "";
      panel.style.maxHeight = panel.dataset.prevMaxHeight || "";
      delete panel.dataset.prevHeight;
      delete panel.dataset.prevMinHeight;
      delete panel.dataset.prevMaxHeight;
    }
    sessionStorage.setItem(STORAGE_KEYS.panelCollapsed, collapsed ? "1" : "0");
  });

  enablePanelDrag(panel);
  enablePanelResize(panel);
  restorePanelState(panel, collapseButton);

  updateRubric();
  renderRubricPreview(panel, rubricItems, lastSuggestions);
  setSuggestionLine("ready", "—");
  setStatus("Ready.");
  // AI request is user-triggered via "Send to AI"
  installClickDebugListener();

  takeShotButton.addEventListener("click", async () => {
    try {
      await captureScreenshot();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  clearShotButton.addEventListener("click", () => {
    screenshots.length = 0;
    updateShotCount();
  });

  sendAiButton.addEventListener("click", () => {
    requestAiSuggestions(true);
  });
}

function buildPromptText(items, systemPrompt) {
  const rubricText = items
    .map((item, index) => {
      const groupPrefix = item.groupLabel ? `[${item.groupLabel}] ` : "";
      return `${index + 1}. ${groupPrefix}${item.text}`;
    })
    .join("\n");

  const userPrompt = `Rubric items:\n${rubricText}\n\nUse the provided screenshot of the student's handwritten answer.\n\nReturn JSON only with this shape:\n{\n  "items": [\n    { "index": 1, "reason": "short reason" }\n  ]\n}\nUse 1-based indices.`;

  return { systemPrompt: systemPrompt || DEFAULT_SETTINGS.systemPrompt, userPrompt };
}

function getResponseContent(data) {
  if (!data || !data.choices || !data.choices.length) return "";
  const message = data.choices[0].message;
  return message && message.content ? message.content : "";
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function extractJson(text) {
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  return null;
}

function matchIndexFromText(text, items) {
  const needle = text.toLowerCase();
  let bestIndex = -1;
  let bestScore = 0;
  items.forEach((item, index) => {
    const hay = item.text.toLowerCase();
    if (hay.includes(needle)) {
      const score = needle.length / hay.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    } else if (needle.includes(hay)) {
      const score = hay.length / needle.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  });
  return bestIndex;
}

function parseSuggestions(rawContent, items) {
  let data = tryParseJson(rawContent);
  if (!data) {
    const extracted = extractJson(rawContent || "");
    if (extracted) data = tryParseJson(extracted);
  }

  const results = [];
  const pushIndex = (index, reason) => {
    if (Number.isNaN(index)) return;
    if (index < 0 || index >= items.length) return;
    if (results.find((r) => r.index === index)) return;
    results.push({ index, reason: reason || "" });
  };

  if (Array.isArray(data)) {
    data.forEach((entry) => {
      if (typeof entry === "number") {
        pushIndex(entry - 1, "");
      } else if (typeof entry === "string") {
        const idx = matchIndexFromText(entry, items);
        if (idx >= 0) pushIndex(idx, "");
      } else if (entry && typeof entry === "object") {
        const idx =
          typeof entry.index === "number" ? entry.index - 1 : matchIndexFromText(entry.text || "", items);
        pushIndex(idx, entry.reason || "");
      }
    });
  } else if (data && typeof data === "object") {
    const list = Array.isArray(data.items) ? data.items : [];
    list.forEach((entry) => {
      if (typeof entry === "number") {
        pushIndex(entry - 1, "");
      } else if (typeof entry === "string") {
        const idx = matchIndexFromText(entry, items);
        if (idx >= 0) pushIndex(idx, "");
      } else if (entry && typeof entry === "object") {
        const idx =
          typeof entry.index === "number" ? entry.index - 1 : matchIndexFromText(entry.text || "", items);
        pushIndex(idx, entry.reason || "");
      }
    });
  }

  return results;
}


function chooseContainerFromElement(startEl) {
  if (!startEl) return null;
  let best = null;
  let bestScore = 0;
  let current = startEl;

  while (current && current !== document.body) {
    if (!(current instanceof HTMLElement)) {
      current = current.parentElement;
      continue;
    }
    const buttons = current.querySelectorAll(
      "button, [role='button'], input[type='checkbox'], input[type='radio']"
    );
    const textLength = cleanText(current.textContent || "").length;
    const score = buttons.length * 5 + Math.min(textLength, 1000) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = current;
    }
    current = current.parentElement;
  }

  return best;
}

function buildSelector(el) {
  if (!el || !(el instanceof HTMLElement)) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset && el.dataset.qa) return `[data-qa="${CSS.escape(el.dataset.qa)}"]`;
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    if (!current.parentElement) break;
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement.children).filter(
      (child) => child.tagName.toLowerCase() === tag
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return parts.length ? parts.join(" > ") : "";
}

function enableRubricPicker(panel) {
  const handler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const picked = chooseContainerFromElement(event.target);
    if (picked) {
      const selector = buildSelector(picked);
      if (selector) {
        preferredRubricSelector = selector;
        sessionStorage.setItem(STORAGE_KEYS.rubricSelector, selector);
      }
    }
    document.removeEventListener("click", handler, true);
    updateRubricAfterPick(panel);
  };
  document.addEventListener("click", handler, true);
}

function updateRubricAfterPick(panel) {
  rubricItems = collectRubricItems();
  panel.querySelector("#gs-copilot-rubric-count").textContent =
    `Rubric: ${rubricItems.length}`;
  renderRubricPreview(panel, rubricItems);
}

function enablePanelDrag(panel) {
  const header = panel.querySelector(".gs-copilot-header");
  if (!header) return;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (event) => {
    if (event.target && event.target.closest("button")) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.classList.add("gs-copilot-dragging");
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const left = Math.max(10, event.clientX - offsetX);
    const top = Math.max(10, event.clientY - offsetY);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("gs-copilot-dragging");
    const rect = panel.getBoundingClientRect();
    sessionStorage.setItem(
      STORAGE_KEYS.panelPosition,
      JSON.stringify({ left: rect.left, top: rect.top })
    );
  });
}

function restorePanelState(panel, collapseButton) {
  const stored = sessionStorage.getItem(STORAGE_KEYS.panelPosition);
  if (stored) {
    try {
      const pos = JSON.parse(stored);
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
    } catch (_error) {
      // ignore invalid stored state
    }
  }
  const sizeStored = sessionStorage.getItem(STORAGE_KEYS.panelSize);
  if (sizeStored) {
    try {
      const size = JSON.parse(sizeStored);
      if (size && typeof size.width === "number" && typeof size.height === "number") {
        panel.style.width = `${size.width}px`;
        const maxHeight = Math.max(180, window.innerHeight - 20);
        panel.style.height = `${Math.min(size.height, maxHeight)}px`;
      }
    } catch (_error) {
      // ignore invalid stored size
    }
  }
  const collapsed = sessionStorage.getItem(STORAGE_KEYS.panelCollapsed) === "1";
  if (collapsed) {
    panel.classList.add("gs-copilot-collapsed");
    if (collapseButton) collapseButton.textContent = "+";
  }
}

function enablePanelResize(panel) {
  const edges = panel.querySelectorAll(".gs-copilot-resize-edge");
  if (!edges.length) return;
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeMode = "corner";

  edges.forEach((edge) => {
    edge.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resizing = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      if (edge.classList.contains("edge-right")) resizeMode = "right";
      else if (edge.classList.contains("edge-bottom")) resizeMode = "bottom";
      else resizeMode = "corner";
    });
  });

  document.addEventListener("mousemove", (event) => {
    if (!resizing) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    let newWidth = startWidth;
    let newHeight = startHeight;
    if (resizeMode === "right" || resizeMode === "corner") {
      newWidth = Math.max(220, startWidth + dx);
    }
    if (resizeMode === "bottom" || resizeMode === "corner") {
      const maxHeight = Math.max(180, window.innerHeight - 20);
      newHeight = Math.max(180, Math.min(maxHeight, startHeight + dy));
    }
    panel.style.width = `${newWidth}px`;
    panel.style.height = `${newHeight}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    const rect = panel.getBoundingClientRect();
    sessionStorage.setItem(
      STORAGE_KEYS.panelSize,
      JSON.stringify({ width: rect.width, height: rect.height })
    );
  });
}
function renderRubricPreview(panel, items, suggestions = []) {
  const container = panel.querySelector("#gs-copilot-rubric-preview");
  container.innerHTML = "";

  if (!items.length) {
    container.textContent = "No rubric items found.";
    return;
  }

  const grouped = new Map();
  const ungrouped = [];
  items.forEach((item, index) => {
    if (item.groupLabel) {
      if (!grouped.has(item.groupLabel)) grouped.set(item.groupLabel, []);
      grouped.get(item.groupLabel).push({ item, index });
    } else {
      ungrouped.push({ item, index });
    }
  });

  const suggestedSet = new Set((suggestions || []).map((s) => s.index));
  const qwertyOrder = "QWERTYUIOPASDFGHJKLZXCVBNM";
  const renderGroup = (label, entries, groupId) => {
    const groupKey = getGroupKeyForHeader(groupId, label);
    const headerLabel = groupKey ? `${groupKey}. ${label}` : label;
    const header = document.createElement("div");
    header.className = "gs-copilot-group-title";
    header.textContent = headerLabel;
    container.appendChild(header);

    const groupRegion = groupId ? getGroupRegionById(groupId, document.body) : null;
    const groupEntries = groupRegion ? getRubricDomEntries(groupRegion) : [];
    const groupKeyMap = new Map();
    groupEntries.forEach((entry, idx) => {
      const keyText = cleanText(entry.button?.textContent || "");
      if (keyText) groupKeyMap.set(idx, keyText);
    });

    const sorted = entries.slice().sort((a, b) => {
      const aKey = getDisplayKey(a.item, groupRegion, groupEntries, groupKeyMap).toUpperCase();
      const bKey = getDisplayKey(b.item, groupRegion, groupEntries, groupKeyMap).toUpperCase();
      const aIdx = qwertyOrder.indexOf(aKey);
      const bIdx = qwertyOrder.indexOf(bKey);
      if (aIdx !== -1 || bIdx !== -1) {
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      }
      const aPos = a.item.position ?? 0;
      const bPos = b.item.position ?? 0;
      return aPos - bPos;
    });

    sorted.forEach(({ item, index }, localIndex) => {
      const keyLabel = getDisplayKey(item, groupRegion, groupEntries, groupKeyMap);
      const prefix =
        label === "Ungrouped"
          ? `${localIndex + 1}. `
          : keyLabel
            ? `${keyLabel}. `
            : `${localIndex + 1}. `;
      const row = document.createElement("div");
      row.className = "gs-copilot-item gs-copilot-item--compact";
      if (suggestedSet.has(index)) {
        row.classList.add("gs-copilot-item--suggested");
      }
      row.innerHTML = `
        <div class="gs-copilot-item-text">
        <div class="gs-copilot-item-title">${prefix}${item.text}</div>
        <div class="gs-copilot-item-reason">${item.element ? "Matched on page" : "Not matched on page"}</div>
      </div>
    `;
      container.appendChild(row);
    });
  };

  if (ungrouped.length) {
    renderGroup("Ungrouped", ungrouped, null);
  }

  Array.from(grouped.entries()).forEach(([label, entries]) => {
    const groupId = entries[0]?.item?.groupId ? String(entries[0].item.groupId) : "";
    renderGroup(label, entries, groupId);
  });
}

function getGroupKeyForHeader(groupId, label) {
  if (groupId) {
    const groupRegion = getGroupRegionById(groupId, document.body);
    if (groupRegion) {
      const headerId = groupRegion.getAttribute("aria-describedby");
      if (headerId) {
        const headerEl = document.getElementById(headerId);
        if (headerEl) {
          const keyBtn = headerEl.matches("button.rubricItemGroup--key")
            ? headerEl
            : headerEl.querySelector("button.rubricItemGroup--key");
          const keyText = cleanText(keyBtn?.textContent || "");
          if (keyText) return keyText;
        }
      }
    }
  }

  const mapKey = groupId ? getGroupToggleKeyMap(document).get(String(groupId)) : "";
  if (mapKey) return mapKey;
  // fallback: find group header by label text and read its key button text
  const labelNeedle = cleanText(label || "").toLowerCase();
  if (!labelNeedle) return "";
  const headers = Array.from(document.querySelectorAll(".rubricItemGroup--row"));
  for (const header of headers) {
    const labelEl = header.querySelector(".markdownText");
    const text = cleanText(labelEl?.textContent || "").toLowerCase();
    if (!text.includes(labelNeedle)) continue;
    const keyBtn = header.querySelector("button.rubricItemGroup--key");
    const keyText = cleanText(keyBtn?.textContent || "");
    if (keyText) return keyText;
  }
  return "";
}

function getDisplayKey(item, keyMap, groupEntries = [], groupKeyMap = new Map()) {
  if (item.key) return item.key;
  const pos = Number.parseInt(item.position, 10);
  if (!Number.isNaN(pos)) {
    const mapped = groupKeyMap.get(pos);
    if (mapped) return mapped;
    if (groupEntries[pos] && groupEntries[pos].button) {
      const keyText = cleanText(groupEntries[pos].button.textContent || "");
      if (keyText) return keyText;
    }
    const qwertyOrder = "QWERTYUIOPASDFGHJKLZXCVBNM";
    if (qwertyOrder[pos]) return qwertyOrder[pos];
  }
  if (!keyMap) return "";
  const pointsNeedle = cleanText(formatPoints(item.weight) || "").toLowerCase();
  const descNeedle = cleanText(item.description || "").toLowerCase();
  const entries = keyMap.querySelectorAll(".rubricEntry");
  for (const entry of entries) {
    const keyBtn = entry.querySelector("button.rubricItem--key");
    const keyText = cleanText(keyBtn?.textContent || "");
    if (!keyText) continue;
    const pointsText = cleanText(entry.querySelector(".rubricField-points")?.textContent || "").toLowerCase();
    const descText = cleanText(entry.querySelector(".markdownText")?.textContent || "").toLowerCase();
    if (pointsText.includes(pointsNeedle) && descText.includes(descNeedle)) {
      return keyText;
    }
  }
  return "";
}

function buildSuggestionKeySequence(items, suggestions) {
  if (!items || !items.length || !suggestions || !suggestions.length) return "";
  const itemMap = new Map(items.map((item, index) => [index, item]));
  const ungroupedOrder = items.filter((item) => !item.groupId);
  const ungroupedFallback = new Map();
  ungroupedOrder.forEach((item, index) => {
    if (!item.key) {
      ungroupedFallback.set(item, String(index + 1));
    }
  });

  const ungrouped = [];
  const grouped = new Map();
  suggestions.forEach((suggestion) => {
    const item = itemMap.get(suggestion.index);
    if (!item) return;
    if (item.groupId) {
      const groupId = String(item.groupId);
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId).push(item);
    } else {
      ungrouped.push(item);
    }
  });

  const qwertyOrder = "QWERTYUIOPASDFGHJKLZXCVBNM";
  const groupCache = new Map();
  const resolveGroupCache = (groupId, item) => {
    if (groupCache.has(groupId)) return groupCache.get(groupId);
    const region = getGroupRegionById(groupId, document.body);
    const entries = region ? getRubricDomEntries(region) : [];
    const keyMap = new Map();
    entries.forEach((entry, index) => {
      const keyText = cleanText(entry.button?.textContent || "");
      if (keyText) keyMap.set(index, keyText);
    });
    const groupKey = getGroupKeyForHeader(groupId, item.groupLabel);
    const cache = { region, entries, keyMap, groupKey };
    groupCache.set(groupId, cache);
    return cache;
  };

  const resolveItemKey = (item) => {
    if (item.groupId) {
      const groupId = String(item.groupId);
      const cache = resolveGroupCache(groupId, item);
      return getDisplayKey(item, cache.region, cache.entries, cache.keyMap);
    }
    return cleanText(item.key || "") || ungroupedFallback.get(item) || "";
  };

  ungrouped.sort((a, b) => {
    const aKey = resolveItemKey(a);
    const bKey = resolveItemKey(b);
    const aNum = Number.parseInt(aKey, 10);
    const bNum = Number.parseInt(bKey, 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return aKey.localeCompare(bKey);
  });

  const parts = [];
  ungrouped.forEach((item) => {
    const key = resolveItemKey(item);
    if (key) parts.push(key);
  });

  const groupedList = Array.from(grouped.entries()).map(([groupId, list]) => {
    const groupKey = list.length ? getGroupKeyForHeader(groupId, list[0].groupLabel) : "";
    return { groupId, groupKey, items: list };
  });

  groupedList.sort((a, b) => {
    const aNum = Number.parseInt(a.groupKey, 10);
    const bNum = Number.parseInt(b.groupKey, 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return a.groupKey.localeCompare(b.groupKey);
  });

  groupedList.forEach((group) => {
    const cache = resolveGroupCache(group.groupId, group.items[0]);
    const sortedItems = group.items.slice().sort((a, b) => {
      const aKey = resolveItemKey(a).toUpperCase();
      const bKey = resolveItemKey(b).toUpperCase();
      const aIdx = qwertyOrder.indexOf(aKey);
      const bIdx = qwertyOrder.indexOf(bKey);
      if (aIdx !== -1 || bIdx !== -1) {
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      }
      const aPos = a.position ?? 0;
      const bPos = b.position ?? 0;
      return aPos - bPos;
    });
    const keys = sortedItems.map((item) => resolveItemKey(item)).filter(Boolean);
    if (keys.length) {
      const groupKey = cache.groupKey || "";
      parts.push(`${groupKey}${keys.join("")}`);
    }
  });

  return parts.join("");
}


function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, error: "No response" });
    });
  });
}

function init() {
  createPanel();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
