# GradeBridge MQ Assignment Maker

Build encrypted, timed multiple-choice assignments from a SQLite question bank — entirely in your browser.

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live Demo](https://veriqai.github.io/GradeBridge-MQ-Assignment-Maker/)**

---

## The Problem

**LMS quiz banks** lock you into a single platform, struggle with LaTeX, and break when the LMS goes down.

**GradeBridge MQ workflow:** keep your question bank in a portable SQLite database you control. Generate encrypted assignment files in the browser. Distribute them to students. Grade automatically through Gradescope.

**The three-component workflow:**

1. **MQ Assignment Maker** (this app) — Instructor builds the question pool and exports an encrypted assignment file.
2. **[MQ Student Submission](https://github.com/VeriQAi/GradeBridge-MQ-Student-Submission)** — Student takes the timed quiz and produces an encrypted submission ZIP.
3. **MQ Autograder** (Python, Docker) — Runs in Gradescope, decrypts the submission, scores, returns Gradescope `results.json`.

All three share a single AES-256-GCM key so encrypted files round-trip safely between browser and server.

---

## Key Features

- **100% Browser-Based** — No backend, no account, no data leaves your machine. Question bank `.db` is read in-browser via sql.js (WebAssembly).
- **Filter and select** — Browse modules → chapters → questions. Filter by status (approved / draft / failed) and difficulty. Bulk select-all and deselect controls for fast pool building.
- **Random per student** — Define a pool of N questions; each student gets a random subset (size you specify) with optional answer-choice shuffling.
- **AES-256-GCM encryption** — Exported assignment files cannot be inspected or edited in a text editor; tampering is detected automatically.
- **Accommodation variants** — One click to generate 1.25x, 1.5x, 2x, or custom-time variants for SDC students. All variants share the same `assignment_id` so the autograder grades them identically.
- **KaTeX math** — Questions with `katex_present=true` render correctly throughout the pipeline.
- **Live demo data not required** — The app expects a SQLite question bank with the standard VeriQAI schema (`modules → chapters → topics → questions`). See "Assignment JSON Format" below for the exported shape.

---

## Quick Start

### Build an Assignment

1. Go to the [Live Demo](https://veriqai.github.io/GradeBridge-MQ-Assignment-Maker/).
2. Click **Choose File** under "Question bank (.db)" and pick your SQLite database.
3. Browse modules and chapters in the left panel. Pick a chapter to view its questions.
4. Filter by status (default: Approved) and difficulty if desired.
5. Tick the questions you want in the pool, or click **Select all N** to grab the whole filtered set.
6. In the right panel, set the course code, title, due date/time, time limit, and **N per student**.
7. Click **Export standard .json** to download the encrypted assignment file (`{course}_{title}_mq.json`).
8. Optionally generate accommodation variants (1.25x, 1.5x, 2x, or custom). Each variant downloads as a separate file with the same answer key.

### Local Development

```bash
git clone https://github.com/VeriQAi/GradeBridge-MQ-Assignment-Maker.git
cd GradeBridge-MQ-Assignment-Maker
npm install
npm run dev
```

The dev server opens at `http://localhost:5173` (Vite default).

### Deploy

```bash
npm run deploy
```

Builds with the `/GradeBridge-MQ-Assignment-Maker/` base path and pushes the `dist/` folder to the `gh-pages` branch. Live URL is automatic if Pages is enabled in repo settings.

---

## Assignment JSON Format

After decryption (`gb1:` prefix removed, AES-256-GCM decoded), the exported assignment file is:

```json
{
  "schema_version": 1,
  "id": "uuid-shared-with-variants",
  "courseCode": "EEC1",
  "title": "Module 7 Reading Check",
  "dueDate": "2026-05-15",
  "dueTime": "12:00",
  "timeLimitMinutes": 15,
  "questionsPerStudent": 5,
  "shuffleQuestions": true,
  "shuffleChoices": true,
  "preamble": "Instructions shown before the quiz starts...",
  "questionPool": [
    {
      "id": 123,
      "type": "multiple_choice",
      "title": "Five op-amp terminals",
      "question_text": "Which of the following...",
      "choices": ["A...", "B...", "C...", "D..."],
      "correct_answer_index": 0,
      "points": 1,
      "tolerance": 0.0,
      "feedback_correct": "Correct. ...",
      "feedback_incorrect": "An op-amp has...",
      "bloom_level": "Remember",
      "difficulty": 1,
      "katex_present": false,
      "module_number": 6,
      "chapter_number": "10.1",
      "chapter_title": "Op-Amps Part 1",
      "topic_title": "Op-Amp Device",
      "subtopic": "Five terminals"
    }
  ],
  "variant_label": "1.5x accommodation",
  "variant_multiplier": 1.5,
  "createdAt": 1715000000000,
  "updatedAt": 1715000000000
}
```

`variant_label` and `variant_multiplier` are present only on accommodation variants, not on the standard file.

---

## Crypto Contract

This app encrypts every export with AES-256-GCM using a shared 256-bit hex key. The same key lives in:

- `GradeBridge-MQ-Student-Submission/cryptoService.ts` (decodes spec, encodes submission)
- `GradeBridge-MQ-Autograder/crypto_utils.py` (Python, Docker; decodes submission)
- `CCAssignmentMaker/crypto_utils.py` (lab autograder; same key shared across the GradeBridge suite)

Wire format: `gb1:` + base64(IV[12 bytes] || ciphertext || GCM tag[16 bytes]).

To rotate the key, generate a new 64-character hex string, update all four locations, redeploy the web apps, and rebuild every Docker autograder image. Older encoded files will no longer decode after rotation.

---

## Question Bank Schema

The expected SQLite schema (from the VeriQAI question bank tooling):

```
modules     (id, number, title, course)
chapters    (id, module_id, number, title)
topics      (id, chapter_id, title, subtopic, learning_objective, bloom_level, difficulty)
questions   (id, topic_id, question_number, type, title, question_text, choices,
             correct_answer_index, points, tolerance, feedback_correct, feedback_incorrect,
             bloom_level, difficulty, katex_present, status, module_id, chapter_id)
```

`choices` is stored as a JSON array of strings.
`status` is one of `draft`, `approved`, `failed`.
`type` is one of `multiple_choice`, `true_false`, `numeric`.

---

## Tech

- TypeScript + React 18 + Vite
- Tailwind CSS (via CDN at runtime)
- KaTeX (via CDN at runtime)
- sql.js (via CDN at runtime — WebAssembly SQLite)
- lucide-react icons
- Web Crypto API (browser native)
- gh-pages for deployment

---

## License

MIT
