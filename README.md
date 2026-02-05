# gs-copilot

Chrome MV3 extension that reads Gradescope rubric items, sends the student answer to an AI model, and suggests which rubric items to select.

## Setup

1. Load the extension in Chrome: `chrome://extensions` > Enable Developer Mode > Load unpacked > select this folder.
2. Open the options page to configure your AI endpoint, API key (if needed), and model.
3. Navigate to a Gradescope grading page. The assistant panel appears in the bottom-right.

## Usage

- Click **Refresh Rubric** to re-scan rubric items.
- Click **Refresh Answer** to re-scan the student answer text, or use **Use Selection** to paste from a selection.
- Click **Send** to get suggestions.
- Click **Apply** to select a suggested rubric item, or **Apply All** to select all suggestions.

## Notes

- The default endpoint is the Ollama OpenAI-compatible endpoint: `http://localhost:11434/v1/chat/completions`.
- If your AI endpoint is remote, make sure it allows browser access and CORS.
