#!/usr/bin/env bash
set -euo pipefail

# Interactive LingyaAI script generator (mirrors lib/aiServer.ts prompt + message structure).
#
# Usage:
#   API_KEY=xxx ./scripts/lingya_generate_script.sh
#   ./scripts/lingya_generate_script.sh --raw
#
# Options:
#   --base-url   API base (default: https://api.lingyaai.cn)
#   --model      Chat model (default:gemini-2.5-flash)
#   --raw        Print full JSON response (default prints choices[0].message.content)

BASE_URL="https://api.lingyaai.cn"
MODEL="gemini-2.5-flash"
PRINT_RAW="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --raw)
      PRINT_RAW="1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

API_KEY="${API_KEY:-${LINGYAAI_API_KEY:-}}"
if [[ -z "${API_KEY}" ]]; then
  read -r -p "API_KEY: " API_KEY
fi

read -r -p "Protagonist name (default: Player): " PROTAGONIST_NAME
PROTAGONIST_NAME="${PROTAGONIST_NAME:-Player}"

read -r -p "Heroine name (default: Yuki): " HEROINE_NAME
HEROINE_NAME="${HEROINE_NAME:-Yuki}"

read -r -p "Plot description (optional): " PLOT_DESCRIPTION

DEVELOPER_MESSAGE="${LINGYAAI_DEVELOPER_MESSAGE:-你是一个有帮助的助手。}"

tmp="$(mktemp -t lingya-chat.XXXXXX.json)"
trap 'rm -f "$tmp"' EXIT

export PROTAGONIST_NAME HEROINE_NAME PLOT_DESCRIPTION DEVELOPER_MESSAGE MODEL
python3 - <<'PY' >"$tmp"
import json
import os

protagonist_name = os.environ["PROTAGONIST_NAME"]
heroine_name = os.environ["HEROINE_NAME"]
plot_description = os.environ.get("PLOT_DESCRIPTION") or ""
developer_message = os.environ["DEVELOPER_MESSAGE"]
model = os.environ["MODEL"]

target_heroine = heroine_name.strip() if heroine_name else "Yuki"
custom_plot = f'Specific Situation: "{plot_description}"' if plot_description.strip() else "A fateful encounter at school."

# Prompt text below mirrors lib/aiServer.ts (generateScriptRaw).
prompt = f"""
    You are the LEAD SCENARIO WRITER for a Japanese school romance visual novel (Galgame), like Senren * Banka (千恋＊万花).
    MISSION: Create a sweet, immersive, otaku-friendly school romance scene (classic galgame vibes).
    MODE: Episodic. Generate the FIRST EPISODE only (we will continue later via player input).
    GENRE: School Romance / Slice of Life / Youth / Moe-ge.
    TARGET AUDIENCE: Otaku who love sweet, doki-doki, and comedic moments.

    CHARACTERS:
    1. {protagonist_name} (Protagonist): A high school student.
    2. {target_heroine} (Heroine): The main love interest. Deeply cares about {protagonist_name}.

    PLOT: {custom_plot}

    VISUAL & AUDIO DIRECTION:
    - BACKGROUNDS (SCENE CONTROL, VERY IMPORTANT):
      - HARD LIMIT: Use AT MOST 3 unique backgrounds for the entire story and REUSE them heavily.
      - DEFAULT: Keep the same background for many consecutive nodes; do NOT change backgrounds frequently.
      - SCENE SWITCH RULE: ONLY change background when BOTH the Protagonist and the Heroine clearly move to a different physical location (for example: classroom → rooftop, school → home).
      - DO NOT change background just for mood, angle, or small actions. Treat location changes as rare, important events.
      - Overall goal: As few distinct scenes as possible while keeping the story coherent.
    - BGM: Select appropriate 'bgm' from: 'bgm_bossa', 'bgm_playful', 'bgm_piano', 'bgm_night', 'bgm_sad', 'bgm_dream', 'bgm_morning'.

    WRITING GUIDELINES (STRICT):
    - LENGTH: The story MUST be substantial.
    - DIALOGUE: Heroine must sound like a classic Anime Girl.
    - PACING: Slow burn.

    TECHNICAL REQUIREMENTS:
    - Nodes: Generate between 8 and 12 STORY NODES. Do NOT exceed 12 nodes.
    - Language: textCN (Chinese), textJP (Japanese for Heroine).
    - OUTPUT FORMAT: RAW JSON ONLY.
      - The ENTIRE response must be a single valid JSON object, no markdown, no code fences, no comments, no extra text.
      - The JSON must strictly follow the schema, no trailing commas and correct value types.
      - IMPORTANT: Use the TOP-LEVEL KEY "nodes" (NOT "scene").
      - IMPORTANT: Every node MUST include a unique string "id".
      - IMPORTANT: The LAST node MUST be a user input decision point:
        - Set "nodeType" to "user_choice"
        - The LAST node MUST be spoken by the Heroine and MUST be a question in classic galgame style
        - Add "choicePromptCN" to ask the player to click “新建”, type their option, and start continuation (galgame UI)
        - Do NOT provide predefined choices.

    SCHEMA CONSTRAINTS:
    - speaker: "Heroine" or "Protagonist".
    - emotion: "normal", "happy", "surprised", "angry", "shy".
  """

payload = {
  "model": model,
  "messages": [
    # Some models (e.g. Gemini) only accept roles: user/model.
    # For those, we merge the developer instruction into a single user message.
    {
      "role": "user" if "gemini" in model.lower() else "developer",
      "content": (developer_message + "\n\n" + prompt).strip() if "gemini" in model.lower() else developer_message,
    },
    *([] if "gemini" in model.lower() else [{"role": "user", "content": prompt}]),
  ],
  "temperature": 0.6,
  "max_tokens": 8192,
  "stream": False,
}

print(json.dumps(payload, ensure_ascii=False))
PY

resp="$(mktemp -t lingya-resp.XXXXXX.json)"
trap 'rm -f "$tmp" "$resp"' EXIT

curl -sS "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  --data-binary @"$tmp" >"$resp"

if [[ "$PRINT_RAW" == "1" ]]; then
  cat "$resp"
  exit 0
fi

python3 - <<'PY' <"$resp"
import json
import sys

data = json.load(sys.stdin)
err = data.get("error")
if err:
  if isinstance(err, dict) and isinstance(err.get("message"), str):
    raise SystemExit(err["message"])
  raise SystemExit(str(err))

choices = data.get("choices") or []
choice0 = choices[0] if choices else {}
msg = choice0.get("message") or {}
content = msg.get("content")
if not isinstance(content, str):
  content = choice0.get("text")
if not isinstance(content, str) or not content.strip():
  raise SystemExit("No content in response (choices[0].message.content is empty).")

sys.stdout.write(content)
PY
