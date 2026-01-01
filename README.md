# RenYuki

**AI-Native Galgame Engine: Turn Imagination into Playable Visual Novels**

RenYuki is a Progressive Web Application (PWA) that empowers users to generate fully playable Galgames (Bishōjo games) from simple text prompts. It integrates Large Language Models (LLMs) and generative imagery into a seamless "Imagine-to-Play" workflow.

## 🎯 Core Experience

### 1. Generate (The Factory)
Input a plot idea or character archetype, and RenYuki's backend orchestration pipeline creates:
- **Dynamic Script:** Branching dialogue, narration, and user choices powered by LLMs.
- **Consistent Assets:** Character sprites (with emotion variations: happy, angry, shy) and scenic backgrounds using Stable Diffusion/Flux.
- **Audio:** Context-aware background music and voice synthesis (TTS).

### 2. Play (The Engine)
A robust, browser-based Visual Novel engine offering:
- **Interactive Storytelling:** Affinity/relationship systems that react to user choices.
- **Immersive UI:** Typewriter effects, auto-play, log history, and immersive full-screen mode.
- **Cross-Platform:** Installable as a native-like app on iOS and Android via PWA standards.

---

## 🛠 Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Frontend:** Tailwind CSS, Framer Motion, React Hooks
- **Backend:** Serverless API Routes (Node.js)
- **Storage:** MinIO (S3-compatible) for asset persistence
- **AI Ops:** Custom orchestration for LLM (Scripting) + SD/Flux (Imaging)

## 🚀 Local Development

### Prerequisites
- Node.js 18+
- Access to MinIO or S3 storage

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup Environment
# Create .env.local with LINGYAAI_API_KEY and MINIO credentials

# 3. Run Development Server
npm run dev
```

Visit `http://localhost:3000` to start creating.

## 📂 Project Structure

- **`app/`**: Next.js routing. `api/generate-*` endpoints handle the AI creation pipeline.
- **`components/VisualNovelPlayer.tsx`**: The core game engine component.
- **`components/GameCreationWizard.tsx`**: UI for guiding users through the prompt-to-game process.
- **`lib/gameGenerationWorker.ts`**: Asynchronous job handler for managing multi-step generation tasks.

## 🤝 Contributing

- **Code Style:** TypeScript strict mode. Functional components with Hooks.
- **Conventions:** `PascalCase` for React components, `camelCase` for logic.
- **Workflow:** Run `npm run lint` before PRs.

---

*This project is for demonstration and entertainment purposes using AI-generated content.*
