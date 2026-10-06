# Meeting-to-Tickets

Local-first, privacy-preserving meeting transcription, grounded task extraction, and human review ticket drafting.

Turn meeting recordings or notes into validated tickets grounded in meeting transcripts and versioned project knowledge documents.

---

## 1. System Architecture

The application is structured into a modular, local-first pipeline:

```
[Audio/Video / Notes] ──> [Whisper / OpenAI Whisper] ──> [Canonical Transcript Segments]
                                                                  │
[Project Documents] ──> [Extracted Text / Chunks] ────────────────┼──> [Candidate Detection]
                                                                  │           │
[Project Profiles]  ──> [Roster / Rules / Surfaces] ──────────────┤           ▼
                                                                  ├──> [Intent Reconciliation]
                                                                  │           │
                                                                  │           ▼
                                                                  ├──> [Task Drafting & Assignment]
                                                                  │           │
                                                                  │           ▼
                                                                  ├──> [Human Review UI]
                                                                  │           │
                                                                  ▼           ▼
                                                             [Internal Ticket Provider]
                                                                  │
                                                       (Jira / Linear Ready)
```

1. **Audio Ingestion & Transcription**: Converts uploaded audio/video to mono 16 kHz WAV via FFmpeg, followed by GPU-accelerated local transcription (`whisper.cpp` with Vulkan backend) or OpenAI Whisper API. Timestamps and speakers are preserved per segment.
2. **Project Profiling & RAG Retrieval**: Project instructions, glossaries, custom task types, surfaces/components, work areas, team members, assignment rules, and documents (PDF, CSV, TXT, MD, Code) are versioned and indexed into chunked SQLite tables.
3. **Meeting Intelligence Engine**:
   - Multi-chunk candidate detection with overlap.
   - Whole-meeting intent reconciliation (`committed`, `proposed`, `rejected`, `cancelled`, `deferred`, `unclear`).
   - Grounded task drafting citing transcript segment quotes and document chunks.
   - Multi-tier assignee resolution: explicit meeting agreement $\to$ project rule $\to$ responsibility match $\to$ skill match $\to$ component ownership $\to$ AI recommendation.
4. **Human Review & Ticket Creation**:
   - Tasks progress through explicit states: `detected` / `review_required` $\to$ `approved` / `rejected` $\to$ `created`.
   - Review UI with clickable transcript evidence jumps, project reference excerpts, profile-validated editor, and optional rejection reason.
   - Idempotent ticket creation with duplicate prevention via provider abstraction (`InternalTicketProvider`, extensible to Jira, Linear, GitHub Issues).

---

## 2. Requirements

- **Node.js**: 20.x or higher
- **FFmpeg**: Installed and available on system `PATH`
- **AI Backend**:
  - **Ollama** (recommended for local use): Running at `http://localhost:11434` with model `qwen3:8b` or `llama3.2:latest`.
  - **OpenAI** (optional): Valid `OPENAI_API_KEY` for cloud transcription and analysis.
- **Local Transcription (Vulkan)**:
  - Linux or Windows with Vulkan-compatible AMD or NVIDIA GPU driver.
  - `whisper.cpp` built with Vulkan (`GGML_VULKAN=1`).

---

## 3. Installation & Quick Start

```bash
# 1. Clone the repository and enter directory
cd "Meeting transcriber"

# 2. Configure environment
cp .env.example .env.local

# 3. Install dependencies
npm install

# 4. Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

- Local uploads: Stored in `./uploads/`
- Database: Local SQLite file at `./data/meeting-transcriber.sqlite`
- Versioned project documents: `./data/project-documents/`

---

## 4. AI & Transcription Setup

### Local Ollama Setup (Default)

1. Install Ollama from [ollama.com](https://ollama.com).
2. Pull the recommended analysis model:
   ```bash
   ollama pull qwen3:8b
   ```
3. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. Configure in `.env.local`:
   ```env
   AI_PROVIDER=ollama
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_NUM_CTX=8192
   ```

### Local Whisper with Vulkan GPU Acceleration

Whisper transcription runs locally via `whisper.cpp`'s Vulkan backend (compatible with both AMD and NVIDIA GPUs):

```bash
# On Ubuntu / Debian:
sudo apt install build-essential cmake git libvulkan-dev vulkan-tools
vulkaninfo --summary

# Run the automated build script:
./scripts/setup-whisper-vulkan.sh
```

The script builds `whisper-cli` with `GGML_VULKAN=ON` and downloads the `small` Whisper model (`ggml-small.bin`).

### OpenAI Setup (Cloud Alternative)

In `.env.local`:
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key-here
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

---

## 5. Speaker Diarization (pyannote.audio Community-1)

The application features local speaker diarization using `whisper.cpp` for speech recognition and `pyannote/speaker-diarization-community-1` for speaker separation, synchronized through a dedicated alignment layer.

### Core Architecture & Philosophy: Strictly Anonymous Diarization

- **NEVER AUTOMATICALLY IDENTIFY SPEAKERS**: The system NEVER infers or guesses real identities (e.g. `SPEAKER_00 = John`) based on voice characteristics, names mentioned in the meeting, conversational context, job responsibilities, task assignments, speaker embeddings, or LLM reasoning.
- **Anonymous Identifiers Only**: Diarization produces purely anonymous labels: `SPEAKER_00`, `SPEAKER_01`, `SPEAKER_02`, etc.
- **Explicit User Control**: Real participant identity mapping is strictly manual and per-meeting. The user may optionally map `SPEAKER_00` to an active project team member in the UI.
- **Task Assignment Separation**: Resolving an assignee for a task (e.g. `assignee: 'Alice'`) does NOT modify speaker turn labels.

### Dedicated Alignment Layer (`lib/alignment.ts`)

Whisper segments and pyannote diarization turns have different timing boundaries:
1. Associates Whisper transcript segments with overlapping speaker turns based on temporal intersection.
2. If multiple speakers speak during a single Whisper segment, it cleanly splits the segment at sentence or clause boundaries (`.`, `!`, `?`, `,`) without dropping, altering, or hallucinating words.
3. Handles overlapping speech by selecting the dominant speaker by temporal duration.
4. Normalizes audio once via FFmpeg, sharing the 16 kHz mono WAV between Whisper and pyannote without duplicate conversion.

### Graceful Fallback

If `pyannote.audio` is not installed or Hugging Face credentials are not configured:
- The system automatically marks `diarizationStatus: 'unavailable'`.
- Audio transcription and meeting intelligence analysis continue normally without speaker labels.
- No transcription or task extraction functionality is interrupted or blocked.

### Installation & Setup

1. **Install Python Dependencies**:
   ```bash
   pip install pyannote.audio torch torchaudio
   ```

2. **Hugging Face Model Access**:
   - Create a Hugging Face account and generate a User Access Token.
   - Accept the user conditions on Hugging Face for the models:
     - [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1)
     - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)

3. **Configure Environment (`.env.local`)**:
   ```env
   # Diarization settings
   ENABLE_DIARIZATION=true
   HF_TOKEN=hf_your_huggingface_access_token_here
   PYTHON_BIN=python3
   PYANNOTE_MODEL=pyannote/speaker-diarization-community-1
   # Optional device override: 'cuda', 'mps', or 'cpu'
   DIARIZATION_DEVICE=cuda
   ```

4. **Verify Diarization Worker**:
   ```bash
   python3 scripts/diarize.py --check-available --hf-token "$HF_TOKEN"
   ```

5. **Manual Mapping in UI**:
   - In the Meeting Detail page, inspect the "Detected Speakers" card in the sidebar.
   - Use the dropdown to map anonymous speakers to active project members.
   - Transcript segments immediately update to show `Name (SPEAKER_XX): [user-mapped]`.
   - Click "Clear" at any time to return to anonymous attribution.

---

## 6. Supported Formats

### Audio & Video Files
- **Extensions**: `.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.webm`, `.aac`
- **Validation**: Strict magic byte verification, format sniffing, size limits (up to 100 MB configurable).
- **Processing**: Automatically converted to 16 kHz mono WAV for optimal transcription accuracy.

### Knowledge Documents
- **Extensions**: `.pdf`, `.csv`, `.txt`, `.md`, `.mdx`, `.json`, `.yaml`, `.yml`, `.toml`, `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.sql`
- **Size limit**: Up to 25 MB per document.
- **PDF Extraction**: Text extracted per page with page numbers preserved. (Scanned PDFs without text layers are detected and flagged).
- **CSV Extraction**: Validated headers, row indices, and column metadata preserved per row chunk.

---

## 7. End-to-End User Workflow

```
PROJECT ──> KNOWLEDGE ──> MEETING ──> ANALYSIS ──> REVIEW ──> TICKETS
```

1. **Project Setup**:
   - Define project name, instructions, and domain glossary.
   - Configure custom task types (`Feature`, `Bug`, `Backend`, `Frontend`, etc.).
   - Configure product surfaces and components (`Web Platform` $\to$ `Authentication`, `Payments`, `Dashboard`).
   - Define work areas (`Payments`, `Infrastructure`).
   - Add team members with skills, responsibilities, and aliases.
   - Define assignment rules (e.g. `Payments backend` $\to$ `John`).
2. **Knowledge Upload**:
   - Upload reference documents (`Architecture.pdf`, `team.csv`, `API.md`).
   - Documents are extracted, chunked, and indexed with SQLite full-text retrieval.
3. **Meeting Upload**:
   - Upload audio/video recording or paste meeting notes.
   - Select the target project profile. The meeting captures an immutable snapshot of the project profile and documents.
4. **Analysis**:
   - Meeting status transitions: `uploaded` $\to$ `queued` $\to$ `transcribing` $\to$ `transcribed` $\to$ `analyzing` $\to$ `review_required` / `complete`.
   - Long meetings are chunked to prevent context limit errors while preserving timestamps.
5. **Human Review**:
   - Review cards show candidate summary, confidence bar, review reason alerts, assigned person, priority, and deadline.
   - Click timestamps to jump directly to the exact highlighted transcript passage.
   - Inspect PDF page or CSV row citations.
   - Edit any task field with real-time validation against the project profile.
   - Reject items with optional rejection rationale.
   - Safe bulk approval available for high-confidence ($\ge 0.75$) committed tasks.
6. **Ticket Creation**:
   - Click "Create Ticket" to synthesize concise, actionable tickets without hallucinated requirements.
   - Tickets are stored in the local repository and prevent duplicates idempotently.

---

## 8. Storage & Data Integrity

- **Database**: SQLite with `better-sqlite3`.
- **Integrity**:
  - `PRAGMA foreign_keys = ON;` strictly enforced.
  - `PRAGMA journal_mode = WAL;` for concurrent reading and write safety.
  - `PRAGMA busy_timeout = 5000;` prevents lock contention during parallel Next.js workers.
  - All multi-table updates are wrapped in `db.transaction(...)`.
- **Unique Indexes**:
  - `idx_created_tickets_source_task` ensures one ticket per task candidate.
  - `idx_meeting_speakers` ensures unique `(meeting_id, speaker_id)` speaker mapping pairs.
  - Scoped unique names for members, surfaces, components, and project documents.
- **Project Snapshotting**:
  - Meetings store immutable JSON snapshots of the project configuration at meeting creation time.

---

## 9. Testing & Evaluation

### Running Tests

```bash
# Run all unit, integration, and evaluation suites
npm test

# Run TypeScript type safety verification
npx tsc --noEmit

# Run ESLint check
npm run lint

# Run production build
npm run build
```

### Evaluation Dataset (15 Benchmark Scenarios)

The test suite in [`lib/evaluation.test.ts`](file:///home/ashray/Random%20Projects/Meeting%20transcriber/lib/evaluation.test.ts) runs 15 realistic meeting scenarios and verifies quality metrics:

1. Clear task
2. Discussion (non-action)
3. Proposal without commitment
4. Explicit rejection
5. Deferment
6. Explicit assignment
7. No assignee
8. Unknown person
9. Multi-speaker task
10. Repeated task (merging duplicate mentions)
11. PDF-dependent task
12. CSV-dependent task
13. Ambiguous deadline
14. Conflicting information
15. Long meeting multi-chunk handling

**Target Metrics Verified**:
- Task Precision: $\ge 90\%$
- Task Recall: $\ge 90\%$
- Intent Accuracy: $100\%$
- Assignee Resolution Accuracy: $100\%$
- Duplicate Rate on Repeated Items: $0\%$

---

## 10. Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `Cannot connect to Ollama` | Ollama daemon not running | Run `ollama serve` or start Ollama app. Check `http://localhost:11434`. |
| `Model not found` | Selected model has not been pulled | Run `ollama pull qwen3:8b`. |
| `Diarization unavailable` | Missing `pyannote.audio` or `HF_TOKEN` | Run `pip install pyannote.audio torch` and set `HF_TOKEN` in `.env.local`. Accept user agreement on Hugging Face. |
| `Diarization permission denied (401/403)` | HF token lacks model access | Accept conditions for `pyannote/speaker-diarization-community-1` and `pyannote/segmentation-3.0` on Hugging Face. |
| `No speech detected` | Empty audio or microphone muted | Verify input audio file in an external player. |
| `Unsupported format` | Non-media file or invalid header | Upload MP3, WAV, M4A, MP4, MOV, or WebM files with valid magic bytes. |
| `PDF has no extractable text` | Scanned image PDF without text layer | Upload searchable PDFs or text/markdown equivalents. OCR is intentionally not run. |
| `Vulkan device not found` | Missing Vulkan driver or headers | Verify with `vulkaninfo --summary`. Install proprietary or Mesa Vulkan drivers. |
