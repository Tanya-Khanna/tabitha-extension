# Tabitha

**Meet Tabitha, your voice-powered tab manager. 
Because Ctrl + W is so last decade - talk to your tabs instead!**

**Private. On-Device. [Gemini Nano Powered](https://developer.chrome.com/docs/ai/built-in)**

---

## 🎯 What is Tabitha?

Tabitha is an intelligent Chrome extension that transforms how you interact with your browser tabs. Instead of clicking through dozens of tabs or using keyboard shortcuts, simply **chat or speak** to Tabitha, and she'll understand what you need and do it instantly.

### Key Features

- 🗣️ **Voice Control**: Speak naturally to manage your tabs ("Open Gmail", "Close all YouTube tabs")
- 💬 **Chat Interface**: Type commands in a conversational chat interface
- 🧠 **AI-Powered**: Uses on-device Gemini Nano (Prompt API) for understanding and context
- 🔍 **Smart Search**: Finds tabs by title, domain, or even content you remember
- 📁 **Tab Organization**: Automatically groups tabs by workflow or topic
- 🔒 **100% Private**: Everything runs on-device, no data leaves your computer
- ⚡ **Lightning Fast**: Optimized for speed (< 500ms for high-confidence queries)

---

## 🚀 Installation

### Prerequisites

- Chrome Browser (version 138+ recommended)
- Origin Trial Tokens for experimental AI APIs (see below)

### Step 1: Get Origin Trial Tokens

1. Visit [Chrome Origin Trials](https://developer.chrome.com/origintrials/#/trials/active)
2. Sign up for the following trials:
   - **Prompt API** (required - intent parsing, semantic search)
   - **Summarizer API** (optional - tab content summaries)
   - **Proofreader API** (required - grammar correction)
   - **Translator API** (optional - multilingual support)
   - **Language Detector API** (optional - language detection)
   - **Rewriter API** (required - query rewriting)
3. Copy your tokens and add them to `manifest.json` → `trial_tokens` array

**Note:** Extension includes pre-configured trial tokens in `manifest.json` (lines 81-84). For production, replace with your own tokens.

### Step 2: Clone the Repository

```bash
git clone <repository-url>
cd tabitha-extension
```

### Step 3: Load Extension in Chrome

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `tabitha-extension` folder
5. ✅ Done! Tabitha is now ready to use.

### Step 4: Enable Origin Trial (Required)

1. Open Chrome DevTools (F12)
2. Go to **Application** tab → **Storage** → **Origin trials**
3. Add your origin trial token for your domain
4. Reload the extension

---

## 📖 Features & Usage

### 1. Voice Control ("Talk to your Tabs")

Click the microphone icon in the extension popup to start voice mode.

**Examples:**
- "Open Gmail" - Opens or switches to Gmail
- "Close all YouTube tabs" - Closes all YouTube tabs
- "Find my cover letter document" - Locates a specific tab
- "Mute all except Zoom" - Mutes all tabs except Zoom
- "Show me my Notion tabs" - Lists all Notion tabs

**How it works:**
- Uses Web Speech API for speech recognition (ASR)
- Transcribes your speech to text
- Parses intent using Prompt API (on-device Gemini Nano)
- Executes actions via Chrome Extension APIs
- Provides spoken feedback via SpeechSynthesis (TTS)

### 2. Chat Interface ("Chat with your Tabs")

Type commands in the chat interface for precise control.

**Examples:**
- `open substack` - Opens or switches to Substack
- `close those` - Closes previously mentioned tabs (anaphora)
- `pin my Gmail tab` - Pins the Gmail tab
- `save these five as research-project` - Bookmarks 5 tabs
- `move Design Sprint group to new window` - Group operations
- `reopen last closed tab` - Restores recently closed tab

**Intents Supported:**
- `open` - Open/switch to a tab
- `close` - Close tabs
- `find_open` - Find open tabs without switching
- `save` - Bookmark tabs
- `list`/`show` - List tabs
- `mute`/`unmute` - Mute/unmute tabs
- `pin`/`unpin` - Pin/unpin tabs
- `reload` - Reload tabs
- `discard` - Discard tabs (sleep)
- `reopen` - Restore closed tabs
- `ask` - Ask questions about browsing history

### 3. Tab Organization

Tabitha offers multiple intelligent grouping modes to organize your tabs automatically:

#### Organization Modes

**By Intent** (`intent`):
- AI classifies tabs into semantic groups: Deep Work, Comms, Reading & Reference, Tasks & Planning, Media, Shopping, Social, Dev Tools
- Uses Prompt API to analyze tab content, title, and domain
- Creates color-coded groups with emoji labels
- **Example:** All Gmail, Slack, and Zoom tabs → "💬 Comms" group

**By Activity** (`activity`):
- Groups tabs by browsing activity patterns
- Uses history data to detect frequently visited sites together
- **Example:** Tabs you use together often → grouped automatically

**By Domain** (`domain`):
- Simple grouping by base domain (e.g., all google.com tabs together)
- Fast and predictable grouping
- **Example:** mail.google.com, docs.google.com, calendar.google.com → "google.com" group

**By Session** (`session`):
- Groups tabs by when they were opened (current session vs. older tabs)
- Separates "active work" from "background tabs"
- **Example:** Tabs opened today → "Active Session", older tabs → "Background"

#### Organization Features

- **Preview Mode:** See groups before applying (for intent mode)
- **Undo Support:** Restore previous layout after organizing
- **User Hints:** Teach Tabitha domain-to-group mappings
- **Layout Snapshots:** Automatic snapshots for undo functionality

**Usage Examples:**
```
Chat: "organize my tabs by intent"
Voice: "group tabs by activity"
Chat: "organize by domain"
Chat: "undo last organization"
```

### 4. Smart Tab Muting

Tabitha automatically manages tab audio to prevent interruptions during meetings and focus work:

#### Auto-Mute During Meetings

- **Meeting Detection:** Automatically detects when you're in a meeting (Zoom, Meet, Teams, etc.)
- **Smart Muting:** Mutes all other tabs except the meeting tab
- **Learning:** Learns your preferences - if you manually mute a domain during meetings 3+ times, it auto-mutes that domain in future meetings
- **Notifications:** Shows notifications when meetings are detected

#### Mute Dashboard

View all tabs' audio status at a glance:
- **Priority Tabs** (meeting tabs) - Always kept live
- **Sounding** - Currently playing audio
- **Muted by Tabitha** - Auto-muted tabs (can be unmuted)
- **Muted by User** - Manually muted tabs
- **Quiet (likely to chime)** - Domains known to play sounds (notifications, ads, etc.)

#### Manual Control

- Mute/unmute individual tabs via chat or voice
- "Mute all except Zoom" - Mutes everything except specified domain
- "Unmute all" - Restores all auto-muted tabs
- Toggle auto-mute feature on/off

**Usage Examples:**
```
Chat: "mute all except zoom"
Voice: "unmute tab number 5"
Chat: "show mute dashboard"
Chat: "toggle auto mute"
```

**Settings:**
- Enable/disable auto-mute during meetings
- Customize buzzy domains (domains likely to make noise)
- View and manage learned mute preferences

### 5. Smart Search & Disambiguation

When multiple tabs match your query, Tabitha shows a disambiguation list:
- Click to select
- Or say "the first one", "number 2", etc. for voice

**Accuracy Features:**
- Exact domain matching (substack → substack.com only)
- Same-title-different-domains detection (shows both)
- Follow-up understanding (remembers previous context)
- Anaphora resolution ("close those" understands "those")

---

## 🏗️ Architecture

### Core Components

```
tabitha-extension/
├── manifest.json              # Extension configuration
├── background.js              # Service worker (main orchestrator)
├── offscreen.js               # Offscreen document (Prompt API execution)
├── popup/
│   ├── popup.html            # UI markup
│   ├── popup.css             # Styling
│   ├── popup.js              # UI logic, chat interface
│   └── voice-hub.js          # Voice interface
├── features/
│   ├── chat-for-tabs/        # Chat interface core
│   │   ├── index.js          # Message routing
│   │   ├── intent-parsing.js # AI intent parsing
│   │   ├── search.js         # Candidate search & ranking
│   │   ├── actions.js        # Action executors (open/close/etc)
│   │   ├── conversation.js   # Conversation memory
│   │   └── conversation-responses.js # AI response generation
│   ├── talk-to-tabs/         # Voice interface
│   │   ├── index.js          # Voice query handling
│   │   ├── asr.js            # Speech recognition
│   │   └── tts.js            # Text-to-speech
│   ├── organize-tabs/        # Tab organization
│   │   ├── index.js          # Main organizer dispatcher
│   │   ├── by-intent.js      # AI-powered intent-based grouping
│   │   ├── by-activity.js    # Activity-based grouping
│   │   ├── by-domain.js      # Domain-based grouping
│   │   ├── by-session.js     # Session-based grouping
│   │   ├── state.js          # Layout snapshots & undo
│   │   ├── metadata.js       # Tab metadata tracking
│   │   └── utils.js          # Group creation helpers
│   └── mute-tabs/            # Smart mute management
│       ├── index.js          # Message handlers
│       ├── core.js           # Meeting detection & auto-mute
│       ├── state.js          # Mute state management
│       └── notifications.js  # Meeting notifications
└── shared/
    ├── indexer.js             # IndexedDB search engine
    └── utils.js              # Shared utilities
```

### Data Flow

1. **User Input** (voice or chat)
2. **Preprocessing** (optional): Language detection → Translation → Proofreading
3. **Intent Parsing** (Prompt API → structured JSON intent)
4. **Lexical Search** (IndexedDB → candidate tabs)
5. **Semantic Re-ranking** (Prompt API → relevance scoring)
6. **Action Execution** (Chrome APIs → tab manipulation)
7. **Response Generation** (Prompt API → conversational message)

---

## 🔌 Complete Technology Stack

### Chrome Extension APIs (Manifest V3)

#### Tab Management APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.tabs` | `query()`, `get()`, `create()`, `update()`, `remove()`, `move()`, `reload()`, `discard()` | Query tabs by filters, create/update/remove tabs, move tabs, reload/discard tabs | `actions.js`, `popup.js`, `features/chat-for-tabs/actions.js`, `features/organize-tabs/*.js`, `features/mute-tabs/*.js` |
| `chrome.tabs.onUpdated` | Event listener | Track tab changes (title, URL, muted state, audible state) | `features/mute-tabs/index.js`, `features/chat-for-tabs/indexer.js` |
| `chrome.tabs.onActivated` | Event listener | Track when user switches tabs | `features/mute-tabs/index.js` |
| `chrome.tabs.onRemoved` | Event listener | Clean up when tabs are closed | `features/mute-tabs/index.js`, `features/chat-for-tabs/indexer.js` |

#### Tab Group APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.tabGroups` | `query()`, `create()`, `update()`, `move()` | Create, query, update, and move tab groups | `features/organize-tabs/*.js`, `features/chat-for-tabs/actions.js` |
| `chrome.tabGroups.onUpdated` | Event listener | Track group changes | `features/mute-tabs/index.js` |

#### Window Management APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.windows` | `get()`, `create()`, `update()`, `getAll()`, `getLastFocused()` | Window management, focus windows, create new windows for groups | `features/chat-for-tabs/actions.js`, `features/organize-tabs/utils.js` |

#### Storage APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.storage.local` | `get()`, `set()`, `remove()` | Store user preferences, conversation hints, layout snapshots, mute preferences, cached classifications | `features/chat-for-tabs/conversation.js`, `features/chat-for-tabs/indexer.js`, `features/organize-tabs/state.js`, `features/mute-tabs/state.js`, `features/chat-for-tabs/utils.js` |
| `chrome.storage.sync` | `get()`, `set()` | Sync settings across devices (if configured) | N/A (local storage preferred) |

#### History & Bookmarks APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.history` | `search()`, `getVisits()` | Search browsing history, get visit timestamps | `features/chat-for-tabs/search.js`, `features/chat-for-tabs/indexer.js`, `features/organize-tabs/by-activity.js` |
| `chrome.bookmarks` | `create()`, `getTree()`, `search()` | Save tabs as bookmarks, search existing bookmarks | `features/chat-for-tabs/actions.js` |
| `chrome.sessions` | `getRecentlyClosed()`, `restore()` | Restore recently closed tabs/windows | `features/chat-for-tabs/actions.js` |

#### Communication APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.runtime.sendMessage()` | Send messages between popup, background, content scripts | Inter-module communication | **All modules** |
| `chrome.runtime.onMessage` | Event listener | Receive messages in background script | `background.js`, `offscreen.js` |
| `chrome.runtime.onStartup` | Event listener | Run on Chrome startup | `features/mute-tabs/index.js` |
| `chrome.runtime.onInstalled` | Event listener | Run on extension install/update | `features/mute-tabs/index.js` |
| `chrome.runtime.getURL()` | Get extension resource URLs | Load offscreen.html, icons, etc. | `features/chat-for-tabs/utils.js` |

#### Offscreen Document APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.offscreen` | `createDocument()`, `hasDocument()`, `closeDocument()` | Create offscreen document for Prompt/Summarizer API (requires DOM context) | `features/chat-for-tabs/utils.js`, `offscreen.js` |

#### Notification APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.notifications` | `create()`, `onClicked`, `onButtonClicked` | Show system notifications for meetings, action confirmations | `features/mute-tabs/notifications.js`, `features/chat-for-tabs/actions.js` |

#### Text-to-Speech APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.tts` | `speak()`, `stop()`, `getVoices()` | Chrome's built-in TTS (preferred over Web Speech API) | `features/talk-to-tabs/tts.js`, `offscreen.js` |

#### Scheduling APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.alarms` | `create()`, `onAlarm` | Periodic heartbeat for mute detection (every 1 minute) | `features/mute-tabs/index.js` |

#### Keyboard Shortcuts APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.commands` | `getAll()`, `onCommand` | Register and handle keyboard shortcuts (Alt+Space for voice) | `background.js`, `manifest.json` |

#### Permissions APIs
| API | Methods Used | Usage | Files |
|-----|--------------|-------|-------|
| `chrome.permissions` | `getAll()`, `contains()`, `request()` | Check and request permissions | `background.js` (startup diagnostics) |

---

### Web APIs (Browser Native)

#### IndexedDB (Client-Side Database)
| API | Usage | Files |
|-----|-------|-------|
| **IndexedDB** | Persistent storage for tab index, metadata, gists. Stores card objects with title, domain, URL, tabId, windowId, gist, lastVisitedAt, type hints. Used for fast lexical search across all tabs. | `features/chat-for-tabs/indexer.js` |
| **IDBDatabase** | Database connection (`open()`, `transaction()`) | `features/chat-for-tabs/indexer.js` |
| **IDBObjectStore** | Object stores: `cards`, `metadata`. Operations: `put()`, `get()`, `getAll()`, `delete()`, `index()` | `features/chat-for-tabs/indexer.js` |
| **IDBIndex** | Indexes on `domain`, `title`, `type`, `lastVisitedAt` for fast queries | `features/chat-for-tabs/indexer.js` |

#### Web Speech API
| API | Usage | Files |
|-----|-------|-------|
| **SpeechRecognition** (or `webkitSpeechRecognition`) | Voice input recognition for "Talk to your Tabs" feature. Continuous recognition with interim results. Configured with language, continuous mode, interim results. | `features/talk-to-tabs/asr.js` |
| **SpeechRecognition Events** | `start`, `end`, `result`, `error`, `audiostart`, `audioend`, `soundstart`, `soundend`, `speechstart`, `speechend`, `nomatch` | `features/talk-to-tabs/asr.js` |
| **SpeechSynthesis** | Text-to-speech output (fallback when `chrome.tts` unavailable). Uses `speak()`, `cancel()`, `getVoices()`, `onvoiceschanged`. | `features/talk-to-tabs/tts.js`, `offscreen.js` |
| **SpeechSynthesisUtterance** | Configure speech (text, voice, rate, pitch, volume) | `features/talk-to-tabs/tts.js`, `offscreen.js` |
| **speechSynthesis.getVoices()** | Get available TTS voices | `features/talk-to-tabs/tts.js`, `offscreen.js` |

#### AI APIs (On-Device Gemini Nano)

All AI APIs require an offscreen document (DOM context) and are accessed via `window.ai.*` or `self.ai.*`.

| API | Access Pattern | Methods | Usage | Files |
|-----|----------------|---------|-------|-------|
| **Prompt API** (`window.ai.languageModel`) | `self.ai?.languageModel` or `self.LanguageModel` | `create()`, `prompt()`, `availability()`, `params()` | Intent parsing, semantic search, conversational responses, workflow clustering, spoken summaries. Primary AI model for understanding user queries. | `features/chat-for-tabs/intent-parsing.js`, `features/chat-for-tabs/search.js`, `features/chat-for-tabs/conversation-responses.js`, `offscreen.js`, `features/organize-tabs/by-intent.js`, `background.js` |
| **Summarizer API** (`window.ai.summarizer`) | `self.ai?.summarizer` or `self.Summarizer` | `create()`, `summarize()`, `availability()` | Generate tab content summaries/gists (1-2 sentence intent descriptions). Cached in IndexedDB with TTL for performance. Used for tab classification and organization. | `features/chat-for-tabs/indexer.js`, `offscreen.js`, `features/organize-tabs/by-intent.js` |
| **Proofreader API** (`window.ai.proofreader`) | `self.ai?.proofreader` or `self.Proofreader` | `create()`, `proofread()`, `availability()` | Fix grammar and spelling mistakes in user queries. Used in preprocessing step for queries ≥6 words. Returns `correctedText` or `corrections` array. | `features/chat-for-tabs/intent-parsing.js` (line 545), `offscreen.js` (line 308) |
| **Translator API** (`window.ai.translator`) | `self.ai?.translator` or `self.Translator` | `create()`, `translate()`, `availability()` | Translate non-English queries to English. Used in preprocessing: detects language first, then translates if not English (confidence > 0.5). Supports `sourceLanguage` and `targetLanguage` params. | `features/chat-for-tabs/intent-parsing.js` (line 522), `offscreen.js` (line 231) |
| **Language Detector API** (`window.ai.languageDetector`) | `self.ai?.languageDetector` or `self.LanguageDetector` | `create()`, `detectLanguage()`, `availability()` | Detect language of user query. Returns detected language code (e.g., 'en', 'es', 'fr') with confidence scores. Used in preprocessing step (queries ≥6 words) before translation. | `features/chat-for-tabs/intent-parsing.js` (line 515), `offscreen.js` (line 186) |
| **Rewriter API** (`window.ai.rewriter`) | `self.ai?.rewriter` or `self.Rewriter` | `create()`, `rewrite()`, `availability()` | Rewrite queries for clarity (optional step). Handler exists in `offscreen.js` but not actively used in preprocessing pipeline. Can be enabled for unclear queries. Supports `sharedContext` parameter. | `offscreen.js` (line 272) - handler exists but not called |
| **Origin Trial Tokens** | `manifest.json` → `trial_tokens` array | N/A | Required for all experimental AI APIs. Configured in manifest. Enable in DevTools → Application → Origin trials. | `manifest.json` (lines 81-84) |

**Message Handlers in `offscreen.js`:**
- `DETECT_LANGUAGE` → Language Detector API
- `TRANSLATE_QUERY` → Translator API
- `PROOFREAD_QUERY` → Proofreader API
- `REWRITE_QUERY` → Rewriter API (handler exists, not actively called)
- `OFFSCREEN_RUN_PROMPT_LM` → Prompt API (intent parsing, semantic search, conversational responses)
- `OFFSCREEN_SUMMARIZE` → Summarizer API (tab gists)
- `CLUSTER_WORKFLOWS` → Prompt API (workflow grouping)
- `GENERATE_SPOKEN_SUMMARY` → Prompt API (voice responses)
- `CHECK_PROMPT_AVAILABILITY` → Prompt API availability check

**Usage Locations:**
- **Preprocessing Pipeline** (`features/chat-for-tabs/intent-parsing.js` → `preprocessQuery()`):
  1. Language Detection (line 515) → `DETECT_LANGUAGE`
  2. Translation (line 522) → `TRANSLATE_QUERY` (if not English)
  3. Proofreading (line 545) → `PROOFREAD_QUERY` (queries ≥6 words)
  4. Rewrite (not enabled) → `REWRITE_QUERY`
- **Intent Parsing**: `features/chat-for-tabs/intent-parsing.js` → `parseIntentWithPrompt()` → Prompt API
- **Semantic Search**: `features/chat-for-tabs/search.js` → `semanticRerank()` → Prompt API
- **Conversational Responses**: `features/chat-for-tabs/conversation-responses.js` → Prompt API
- **Tab Summaries**: `features/chat-for-tabs/indexer.js` → `fetchGistForTab()` → Summarizer API
- **Workflow Clustering**: `features/organize-tabs/by-intent.js` → Summarizer API for gists
- **Voice Summaries**: `features/talk-to-tabs/index.js` → `GENERATE_SPOKEN_SUMMARY` → Prompt API

**All AI processing happens on-device** - no data is sent to external servers.

#### DOM APIs
| API | Usage | Files |
|-----|-------|-------|
| **document** | DOM manipulation for popup UI, creating elements, event listeners | `popup/popup.js`, `popup/popup.html`, `content.js` |
| **document.createElement()** | Create UI elements dynamically | `popup/popup.js`, `content.js` |
| **document.querySelector()** | Select DOM elements | `popup/popup.js` |
| **document.body.appendChild()** | Append elements to DOM | `content.js` (voice chip overlay) |
| **document.head.appendChild()** | Inject styles into page | `content.js` |
| **Event Listeners** | `addEventListener()` for click, input, keydown, scroll, keydown events | `popup/popup.js`, `content.js` |
| **classList** | Add/remove CSS classes for UI state | `popup/popup.js`, `content.js` |
| **querySelector()** | Select elements within DOM | `popup/popup.js`, `content.js` |
| **textContent** | Set/get text content | `popup/popup.js`, `content.js` |

#### Performance APIs
| API | Usage | Files |
|-----|-------|-------|
| **performance.now()** | High-resolution timing for performance measurement | `features/chat-for-tabs/intent-parsing.js`, `features/chat-for-tabs/search.js` |

#### Console APIs
| API | Usage | Files |
|-----|-------|-------|
| **console.log()** | Structured logging with prefixes (`[Tabitha::*]`) | All modules |
| **console.group()** | Grouped logging for startup diagnostics | `background.js` |

#### URL APIs
| API | Usage | Files |
|-----|-------|-------|
| **URL()** | Parse and normalize URLs, extract domains | `shared/utils.js`, `features/chat-for-tabs/search.js` |
| **URLSearchParams** | Parse query parameters | N/A |

#### Fetch API
| API | Usage | Files |
|-----|-------|-------|
| **fetch()** | HTTP requests (if needed for external APIs) | `features/organize-tabs/by-intent.js` (for gist fetching) |

#### CSS & Styling APIs
| API/Feature | Usage | Files |
|-------------|-------|-------|
| **CSS Flexbox** | Layout for popup UI, disambiguation lists, buttons | `popup/popup.css` |
| **CSS Grid** | Grid layouts (if used) | `popup/popup.css` |
| **CSS Animations** | `@keyframes`, `animation` property for UI transitions | `popup/popup.css`, `content.js` (voice chip animations) |
| **CSS Transitions** | Smooth state transitions | `popup/popup.css` |
| **backdrop-filter** | Frosted glass effect for UI overlays | `popup/popup.css`, `content.js` |
| **CSS Variables** | Custom properties for theming (if used) | `popup/popup.css` |
| **media queries** | Responsive design, `@media (prefers-reduced-motion)` | `popup/popup.css`, `content.js` |
| **scrollbar-width** | Custom scrollbar styling | `popup/popup.css` |
| **scrollbar-color** | Custom scrollbar colors | `popup/popup.css` |
| **injectStyles()** | Dynamically inject CSS into pages | `content.js` (voice chip styles) |

#### Content Script APIs
| API | Usage | Files |
|-----|-------|-------|
| **chrome.runtime.onMessage** | Receive messages in content script | `content.js` |
| **chrome.runtime.sendMessage** | Send messages from content script | `content.js` |
| **DOM Injection** | Create floating UI overlays on web pages | `content.js` (voice chip) |

#### Storage APIs (Web)
| API | Usage | Files |
|-----|-------|-------|
| **Not used** | We use `chrome.storage.local` instead of `localStorage` for extension storage | N/A |

---

### JavaScript Language Features

| Feature | Usage | Files |
|---------|-------|-------|
| **ES6 Modules** (`import`/`export`) | Module system throughout | All `.js` files |
| **async/await** | Asynchronous operations | All modules |
| **Promises** | `Promise.all()`, `Promise.race()`, `Promise.allSettled()` for parallel execution | `features/chat-for-tabs/actions.js`, `features/chat-for-tabs/search.js`, `popup/popup.js` |
| **Map/Set** | Data structures for tab tracking, caching | `features/mute-tabs/state.js`, `features/chat-for-tabs/conversation.js` |
| **Array Methods** | `filter()`, `map()`, `reduce()`, `slice()`, `find()`, `some()`, `every()` | All modules |
| **String Methods** | `toLowerCase()`, `trim()`, `replace()`, `match()`, `split()`, `includes()` | All modules |
| **Regular Expressions** | Pattern matching for intent parsing, domain extraction | `features/chat-for-tabs/intent-parsing.js`, `popup/popup.js` |
| **JSON** | `JSON.parse()`, `JSON.stringify()` for data serialization | All modules |
| **setTimeout/setInterval** | Debouncing, timeouts, periodic tasks | `features/chat-for-tabs/search.js`, `features/mute-tabs/index.js` |
| **Error Handling** | `try/catch`, `Promise.catch()` for error handling | All modules |
| **Arrow Functions** | Concise function syntax | All modules |
| **Destructuring** | Object/array destructuring | All modules |
| **Template Literals** | String interpolation | All modules |
| **Optional Chaining** | `?.` for safe property access | All modules |
| **Nullish Coalescing** | `??` for default values | All modules |

---

### Chrome Extension Architecture

| Component | Technology | Usage |
|-----------|------------|-------|
| **Service Worker** | `background.js` (Manifest V3) | Main orchestrator, message routing, lifecycle management |
| **Popup UI** | HTML/CSS/JavaScript | User interface (`popup/popup.html`, `popup.js`, `popup.css`) |
| **Content Scripts** | `content.js` | Run in page context - creates floating voice chip overlay on all pages, handles keyboard shortcuts (Esc to dismiss), communicates with background script |
| **Offscreen Document** | `offscreen.html`, `offscreen.js` | Required for Prompt/Summarizer API (needs DOM context) |
| **Options Page** | `options/options.html`, `options.js` | Extension settings page |
| **Web Accessible Resources** | Static files (icons, CSS) | Resources accessible from web pages |

---

### Manifest V3 Features

| Feature | Usage |
|---------|-------|
| **Permissions** | `tabs`, `tabGroups`, `storage`, `history`, `bookmarks`, `sessions`, `notifications`, `offscreen`, `alarms`, `scripting`, `contextMenus`, `activeTab` |
| **Host Permissions** | `<all_urls>` for accessing tab content |
| **Commands** | Keyboard shortcut registration (`Alt+Space` for voice) |
| **Action** | Extension icon and popup configuration |
| **Content Scripts** | Inject scripts into web pages |
| **Origin Trial Tokens** | Enable experimental AI APIs (configured in `manifest.json`) |

---

## 🧪 Testing

### Manual Testing Checklist

#### Basic Actions

1. **Open Tab:**
   ```
   Test: "open gmail"
   Expected: Opens Gmail tab (or switches if already open)
   Time: < 500ms (high confidence)
   ```

2. **Close Tabs:**
   ```
   Test: "close all youtube tabs"
   Expected: Closes all YouTube tabs
   Time: < 1s
   ```

3. **Find Tab:**
   ```
   Test: "find my cover letter document"
   Expected: Shows disambiguation if multiple matches
   Time: < 2s (with semantic rerank)
   ```

4. **Mute/Unmute:**
   ```
   Test: "mute all except zoom"
   Expected: Mutes all tabs except zoom.us
   Time: < 1s
   ```

5. **Pin/Unpin:**
   ```
   Test: "pin my Gmail tab"
   Expected: Pins the Gmail tab
   Time: < 1s
   ```

#### Advanced Features

6. **Anaphora Resolution:**
   ```
   Test: "open gmail" → "close those"
   Expected: Closes Gmail tab (understands "those")
   ```

7. **Disambiguation:**
   ```
   Test: "open google docs"
   Expected: Shows list if multiple docs tabs
   User: "the first one"
   Expected: Opens first tab (cardId-based, not index)
   ```

8. **Group Operations:**
   ```
   Test: "move Design Sprint group to new window"
   Expected: Creates new window with group tabs
   ```

9. **Tab Organization:**
   ```
   Test: "organize my tabs by intent"
   Expected: Groups tabs into intent categories (Comms, Deep Work, etc.)
   Test: "organize by domain"
   Expected: Groups tabs by base domain
   Test: "undo last organization"
   Expected: Restores previous tab layout
   ```

10. **Mute Management:**
    ```
    Test: Join Zoom meeting → Auto-mute all other tabs
    Expected: All tabs muted except Zoom
    Test: "mute all except zoom"
    Expected: Mutes all tabs except zoom.us domain
    Test: "show mute dashboard"
    Expected: Shows dashboard with all tab audio status
    ```

11. **Voice Mode:**
    ```
    Test: Voice → "open wikipedia"
    Expected: Opens Wikipedia tab with spoken confirmation
    ```

12. **Conversational Context:**
    ```
    Test: "what google doc was i working on yesterday?"
    Expected: Searches history, shows relevant doc
    ```

### Debugging

Enable debug logging:
1. Open DevTools → Console
2. Look for `[Tabitha::*]` log prefixes:
   - `[Tabitha::chat]` - Chat interface
   - `[Tabitha::voice]` - Voice interface
   - `[Tabitha::asr]` - Speech recognition
   - `[Tabitha::bg]` - Background script

**Structured Logs:**
All operations log structured events:
```
[Tabitha::chat] [Phase 3] parse_intent_complete: {method: 'prompt_api', intent: 'open', durationMs: '1234.5'}
[Tabitha::chat] [Phase 4] process_candidates_complete: {autoExecute: true, topScore: 0.91}
[Tabitha::chat] [Phase 6] action_completed: {intent: 'open', success: true}
```

---

## 🎨 Customization

### Keyboard Shortcuts

Default shortcuts (configured in `manifest.json`):
- `Ctrl+Shift+T` (or `Cmd+Shift+T` on Mac): Open Tabitha popup
- `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac): Start voice mode

### Settings

Settings are stored in `chrome.storage.local`:
- Conversation history (last 20 messages per session)
- User hints (phrase → domain/type mappings)
- Cached topic groups (15-minute TTL)

---

## 🐛 Troubleshooting

### "Prompt API unavailable"

**Cause:** Origin trial token not configured or expired.

**Fix:**
1. Verify origin trial token is active
2. Check DevTools → Application → Origin trials
3. Reload extension

### "No matches found" for obvious queries

**Cause:** Indexer not booted or tabs not indexed.

**Fix:**
1. Refresh tabs (reload extension)
2. Wait 2-3 seconds for indexer to boot
3. Try query again

### Voice not working

**Cause:** Microphone permissions not granted.

**Fix:**
1. Click microphone icon
2. Grant microphone permission when prompted
3. Check Chrome settings → Privacy → Microphone

### Slow responses (> 5 seconds)

**Cause:** Prompt API timeout or network issues.

**Fix:**
1. Check offscreen document is created (DevTools → Application → Background Service)
2. Verify Prompt API is available
3. Check console for timeout errors

---

## 📚 Development


### Key Modules

**`features/chat-for-tabs/intent-parsing.js`:**
- Parses user queries into structured intents
- Uses Prompt API for natural language understanding
- Fast fallback for common patterns

**`features/chat-for-tabs/search.js`:**
- Lexical search (IndexedDB)
- Semantic re-ranking (Prompt API)
- Candidate filtering and deduplication

**`features/chat-for-tabs/actions.js`:**
- Executes tab actions (open, close, mute, etc.)
- Parallel Chrome API calls for speed
- Error handling and undo support

**`shared/indexer.js`:**
- IndexedDB-based search engine
- Stores tab metadata (title, domain, gist)
- Real-time index updates

**`features/organize-tabs/by-intent.js`:**
- AI-powered intent-based grouping
- Classifies tabs into semantic categories using Prompt API
- Deterministic caching for consistent grouping

**`features/organize-tabs/by-activity.js`:**
- Groups tabs based on browsing activity patterns
- Uses history data to detect frequently co-visited sites

**`features/organize-tabs/by-domain.js`:**
- Simple domain-based grouping
- Fast and predictable organization

**`features/organize-tabs/by-session.js`:**
- Session-based grouping (current vs. older tabs)
- Separates active work from background tabs

**`features/organize-tabs/state.js`:**
- Layout snapshot management for undo
- User hint storage (domain-to-group mappings)

**`features/mute-tabs/core.js`:**
- Meeting detection (Zoom, Meet, Teams, etc.)
- Auto-mute logic with learning preferences
- Noise situation computation

**`features/mute-tabs/notifications.js`:**
- Meeting detection notifications
- User notification handlers

**`features/mute-tabs/state.js`:**
- Mute state management
- Learned domain preferences
- Settings persistence

### Adding New Actions

1. Add intent to router prompt (`intent-parsing.js`)
2. Add executor function (`actions.js`)
3. Add message handler (`index.js`)
4. Add UI handler (`popup.js`)

Example:
```javascript
// actions.js
export async function executeNewAction(cardId, intent, requestId) {
  // Implementation
  return { ok: true, result: 'success' };
}

// index.js
case 'new_action':
  result = await executeNewAction(cardId, intentObj, requestId);
  break;
```

---

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📝 License

[Your License Here]

---

## 🙏 Acknowledgments

- **Gemini Nano** by Google for on-device AI
- **Chrome Extension APIs** for tab management
- **Web Speech API** for voice recognition

---

## 📞 Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing documentation
- Review console logs for debugging

---

**Made with ❤️ for people who have too many tabs open.**
