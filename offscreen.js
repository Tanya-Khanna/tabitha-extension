// offscreen.js — DOM context for built-in AI APIs
// Exposes: Summarizer, Prompt, Rewriter, Proofreader, Translator, Language Detector APIs

const log = (...a) => console.log('[Tabitha::offscreen]', ...a);

// Helper: progress bar hookup for any create() call
function withMonitor(updateBar) {
  return {
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        const pct = Math.round((e.loaded || 0) * 100);
        updateBar(pct);
      });
    }
  };
}

const setBar = (el, pct) => {
  if (el) el.style.width = `${pct}%`;
};

// ============================== SUMMARIZER API ==============================
async function ensureSummarizer(opts = {}) {
  const settings = {
    type: 'tldr',
    length: 'short',
    format: 'plain-text',
    outputLanguage: 'en',
    sharedContext: 'Produce a concise, 1–2 sentence intent gist of a browser tab (title + URL).',
    ...opts
  };
  return settings;
}

async function summarizeOnce(text, opts) {
  try {
    const Summarizer = self.Summarizer || self.ai?.summarizer;
    if (!Summarizer) {
      log('Summarizer API unavailable in offscreen');
      return '';
    }
    const cfg = await ensureSummarizer(opts);
    const avail = await Summarizer.availability?.(cfg);
    if (avail === 'unavailable') {
      log('Summarizer model unavailable');
      return '';
    }
    const summarizer = await Summarizer.create({
      type: cfg.type,
      length: cfg.length,
      format: cfg.format,
      outputLanguage: cfg.outputLanguage,
      sharedContext: cfg.sharedContext
    });
    const res = await summarizer.summarize(String(text || '').slice(0, 1200));
    return typeof res === 'string' ? res : JSON.stringify(res);
  } catch (e) {
    log('Summarizer error', e);
    return '';
  }
}

// =====================================================================================
// Strict JSON-only path for Workflow clustering using window.ai (optional new protocol)
// =====================================================================================
let session;
async function ensureSession() {
  if (session) return session;
  if (!('ai' in self) || !self.ai?.languageModel) throw new Error('Prompt API unavailable');
  session = await self.ai.languageModel.create({
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor(m){ m?.addEventListener?.('downloadprogress', e => console.log(`[Tabitha::ai] model download ${Math.round(e.loaded*100)}%`)); }
  });
  console.log('[Tabitha::ai] session ready ✅');
  return session;
}

function buildWorkflowPrompt(payload) {
  const { tabs, hints } = payload;
  const header = `
You are a clustering engine for browser tabs.

- Output MUST be valid JSON only. No prose, no markdown, no code fences.
- Schema:
{
  "groups": [
    {"name": "string", "rationale": "string", "tabIds": [integers]}
  ],
  "ungrouped": [integers]
}
- Constraints:
  * Use ONLY tabIds that appear in the input.
  * 2–6 groups total. If more, merge the smallest by topic.
  * Avoid singleton groups unless there are ≤2 groups overall.
  * Prefer concise Title Case names. No emojis.
  * If unsure, place tabs in "ungrouped".
`;
  const hintText = (hints?.length ? `User hints: ${hints.join('; ')}\n` : '');
  const lines = tabs.map(t => `#${t.id} ${t.domain} | "${t.title}" | ${t.type} | lastActive=${t.lastActiveMins}m | gist=${t.gist || 'n/a'}`).join('\n');
  return `${header}\n${hintText}\nHere are the open tabs:\n${lines}\n\nReturn JSON now.`;
}

function extractFirstJSON(text) {
  const stripped = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = stripped.slice(start, i + 1);
        try { return JSON.parse(slice); } catch {}
        break;
      }
    }
  }
  return null;
}

function toTitleCase(s){ return s.replace(/\w\S*/g, t => t[0].toUpperCase()+t.slice(1).toLowerCase()); }
function mergeNames(a,b){ const [short,long] = a.length <= b.length ? [a,b] : [b,a]; return (a===b?a:`${short} + ${long}`).slice(0,40); }

function validateClusters(obj, allowedIds) {
  const out = { groups: [], ungrouped: [] };
  if (!obj || typeof obj !== 'object') return out;
  const setAllowed = new Set(allowedIds);
  if (Array.isArray(obj.groups)) {
    for (const g of obj.groups) {
      const name = String(g?.name || '').trim();
      const rationale = String(g?.rationale || '').trim();
      const tabIds = Array.isArray(g?.tabIds) ? g.tabIds.filter(n => setAllowed.has(n)) : [];
      if (!name || tabIds.length === 0) continue;
      out.groups.push({ name: toTitleCase(name).slice(0, 40), rationale: rationale.slice(0, 160), tabIds });
    }
  }
  if (Array.isArray(obj.ungrouped)) {
    out.ungrouped = obj.ungrouped.filter(n => setAllowed.has(n));
  }
  if (out.groups.length > 6) {
    out.groups.sort((a,b)=>a.tabIds.length-b.tabIds.length);
    while (out.groups.length > 6) {
      const a = out.groups.shift();
      const b = out.groups.shift();
      out.groups.push({ name: mergeNames(a.name,b.name), rationale: 'Merged small related groups', tabIds: [...a.tabIds, ...b.tabIds] });
      out.groups.sort((x,y)=>x.tabIds.length-y.tabIds.length);
    }
  }
  if (out.groups.length >= 3) {
    const keep = [];
    for (const g of out.groups) { if (g.tabIds.length === 1) out.ungrouped.push(g.tabIds[0]); else keep.push(g); }
    out.groups = keep;
  }
  const inGroup = new Set(out.groups.flatMap(g=>g.tabIds));
  out.ungrouped = out.ungrouped.filter(id => !inGroup.has(id));
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Only handle messages targeted at offscreen - return false so sender knows we won't respond
  if (msg?.target !== 'offscreen') {
    return false; // Not handling this message
  }
  
  // Always wrap async work in an IIFE and return true up-front
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: 'bad_request' });
        return;
      }

      switch (msg.type) {
        // ============================== SUMMARIZER HANDLER ==============================
        case 'SUMMARIZE_TEXT': {
          const text = msg.text || '';
          const out = await summarizeOnce(text);
          sendResponse({ ok: true, text: out });
          return;
        }

        // ============================== LANGUAGE DETECTOR HANDLER ==============================
        case 'DETECT_LANGUAGE': {
          try {
            const LanguageDetector = self.LanguageDetector || self.ai?.languageDetector;
            if (!LanguageDetector) {
              sendResponse({ ok: false, error: 'Language Detector API unavailable' });
              return;
            }
            const text = String(msg.text || '').trim();
            if (!text) {
              sendResponse({ ok: false, error: 'empty_text' });
              return;
            }
            const detector = await LanguageDetector.create();
            const res = await detector.detect(text);
            
            // Handle different response formats
            const list = Array.isArray(res) ? res
                      : (Array.isArray(res?.languages) ? res.languages : []);
            
            if (!list.length) {
              sendResponse({ ok: true, detected: null, confidence: 0 });
              return;
            }
            
            const best = list[0];
            const languageCode = best.detectedLanguage || best.languageCode || null;
            const confidence = best.confidence ?? best.probability ?? 0;
            
            sendResponse({ 
              ok: true, 
              detected: languageCode,
              confidence: confidence,
              allDetections: list.map(r => ({
                language: r.detectedLanguage || r.languageCode,
                confidence: r.confidence ?? r.probability ?? 0
              }))
            });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        // ============================== TRANSLATOR HANDLER ==============================
        case 'TRANSLATE_QUERY': {
          try {
            const Translator = self.Translator || self.ai?.translator;
            if (!Translator) {
              sendResponse({ ok: false, error: 'Translator API unavailable' });
              return;
            }
            const text = String(msg.text || '').trim();
            const sourceLanguage = String(msg.sourceLanguage || 'en').toLowerCase();
            const targetLanguage = String(msg.targetLanguage || 'en').toLowerCase();
            
            if (!text) {
              sendResponse({ ok: false, error: 'empty_text' });
              return;
            }
            
            if (sourceLanguage === targetLanguage) {
              sendResponse({ ok: true, translated: text, original: text, sourceLanguage, targetLanguage });
              return;
            }
            
            const translator = await Translator.create({
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage,
              ...withMonitor((p) => setBar(null, p))
            });
            
            const translated = await translator.translate(text);
            sendResponse({ 
              ok: true, 
              translated: String(translated),
              original: text,
              sourceLanguage,
              targetLanguage
            });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        // ============================== REWRITER HANDLER ==============================
        case 'REWRITE_QUERY': {
          try {
            const Rewriter = self.Rewriter || self.ai?.rewriter;
            if (!Rewriter) {
              sendResponse({ ok: false, error: 'Rewriter API unavailable' });
              return;
            }
            const text = String(msg.text || '').trim();
            if (!text) {
              sendResponse({ ok: false, error: 'empty_text' });
              return;
            }
            
            const rewriter = await Rewriter.create({
              tone: msg.tone || 'neutral',
              length: msg.length || 'medium',
              format: msg.format || 'plain-text',
              outputLanguage: 'en',
              sharedContext: msg.sharedContext || 'Rewrite this query for clarity and understanding while preserving the original intent.',
              ...withMonitor((p) => setBar(null, p))
            });
            
            const rewritten = await rewriter.rewrite(text);
            sendResponse({ 
              ok: true, 
              rewritten: String(rewritten),
              original: text
            });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        // ============================== PROOFREADER HANDLER ==============================
        case 'PROOFREAD_QUERY': {
          try {
            const Proofreader = self.Proofreader || self.ai?.proofreader;
            if (!Proofreader) {
              sendResponse({ ok: false, error: 'Proofreader API unavailable' });
              return;
            }
            const text = String(msg.text || '').trim();
            if (!text) {
              sendResponse({ ok: false, error: 'empty_text' });
              return;
            }
            
            const proofreader = await Proofreader.create({
              expectedInputLanguages: msg.expectedInputLanguages || ['en'],
              outputLanguage: 'en',
              ...withMonitor((p) => setBar(null, p))
            });
            
            const result = await proofreader.proofread(text);
            
            // Extract corrected text from various possible fields
            let corrected = result.correctedText      // some builds
              ?? result.correctedInput                // explainer draft
              ?? result.corrected                     // older examples
              ?? null;
            
            // Compose from spans if missing
            if (!corrected && Array.isArray(result.corrections)) {
              const corrections = [...result.corrections].sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));
              let out = '';
              let cursor = 0;
              for (const c of corrections) {
                const s = Number.isInteger(c.startIndex) ? c.startIndex : cursor;
                const e = Number.isInteger(c.endIndex) ? c.endIndex : s;
                out += text.slice(cursor, s);
                const repl = c.correction ?? c.replacement ?? c.suggestedReplacement ?? text.slice(s, e);
                out += repl;
                cursor = e;
              }
              out += text.slice(cursor);
              corrected = out;
            }
            
            const corrections = Array.isArray(result.corrections) ? result.corrections : [];
            const correctionsList = corrections.map(c => ({
              startIndex: c.startIndex ?? 0,
              endIndex: c.endIndex ?? (c.startIndex ?? 0),
              original: text.slice(c.startIndex ?? 0, c.endIndex ?? (c.startIndex ?? 0)),
              corrected: c.correction ?? c.replacement ?? c.suggestedReplacement ?? '',
              type: c.type || 'fix',
              explanation: c.explanation || null
            }));
            
            sendResponse({ 
              ok: true, 
              corrected: corrected || text,
              original: text,
              corrections: correctionsList,
              hasCorrections: corrections.length > 0
            });
            
            // Cleanup
            if (proofreader.destroy) proofreader.destroy();
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        // ============================== PROMPT API HANDLERS ==============================
        case 'CHECK_PROMPT_AVAILABILITY': {
          try {
            const LanguageModel = self.LanguageModel || self.ai?.languageModel;
            if (!LanguageModel) {
              sendResponse({ ok: true, available: false, reason: 'api_not_present' });
              return;
            }
            const opts = { 
              expectedInputs: [{ type: 'text', languages: ['en'] }], 
              expectedOutputs: [{ type: 'text', languages: ['en'] }] 
            };
            const avail = await LanguageModel.availability?.(opts);
            const available = avail !== 'unavailable';
            sendResponse({ ok: true, available, reason: available ? 'ready' : String(avail) });
          } catch (err) {
            sendResponse({ ok: true, available: false, reason: String(err?.message || err) });
          }
          return;
        }

        case 'OFFSCREEN_RUN_PROMPT_LM': {
            try {
                const LanguageModel = self.LanguageModel || self.ai?.languageModel;
                if (!LanguageModel) {
                    sendResponse({ ok: false, error: 'Prompt API unavailable in offscreen' });
                    return;
                }
                
                // Use persistent session (reuse to avoid model download overhead)
                let promptSession = self.__tabithaPromptSession;
                if (!promptSession) {
                    const opts = msg.options || { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
                    const avail = await LanguageModel.availability?.(opts);
                    if (avail === 'unavailable') {
                        sendResponse({ ok: false, error: 'Model unavailable' });
                        return;
                    }
                    
                    promptSession = await LanguageModel.create({
                        ...opts,
                        monitor(m){ try { m.addEventListener('downloadprogress', e => log(`[Tabitha::offscreen] model ${Math.round((e.loaded||0)*100)}%`)); } catch {} }
                    });
                    self.__tabithaPromptSession = promptSession; // Cache for reuse
                    log('Created persistent Prompt API session');
                }
                
                // Use provided options or defaults, but always ensure outputLanguage is set
                const promptParams = {
                    temperature: 0.3,
                    topK: 1,
                    outputLanguage: 'en',
                    ...msg.options, // Merge user options
                    outputLanguage: msg.options?.outputLanguage || 'en' // Ensure outputLanguage is always set (override if user didn't specify)
                };
                
                // Timeout set to 60 seconds for all prompt calls
                const timeoutMs = 60000;
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Prompt timeout (${timeoutMs/1000}s)`)), timeoutMs)
                );
                
                // First attempt with provided params
                let result = await Promise.race([
                    promptSession.prompt(String(msg.prompt || ''), promptParams),
                    timeoutPromise
                ]);
            let jsonText = String(result);
            
            // JSON validation: check if response is valid JSON (for router calls)
            const isRouterCall = msg.isRouter || false;
            if (isRouterCall) {
              // Try to extract JSON
              let jsonMatch = jsonText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
              if (!jsonMatch) {
                jsonMatch = jsonText.match(/```\s*(\{[\s\S]*?\})\s*```/);
              }
              if (!jsonMatch) {
                jsonMatch = jsonText.match(/\{[\s\S]*\}/);
              }
              
              // SPEED: Fail fast - no reprompting (saves 5-10 seconds)
              // If no valid JSON found, return error immediately
              if (!jsonMatch) {
                sendResponse({ ok: false, error: 'no_json_in_response', text: jsonText });
                return;
              }
              
              // Try to parse the extracted JSON
              try {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                JSON.parse(jsonStr);
                // Valid JSON - return it
                sendResponse({ ok: true, text: jsonStr });
              } catch (parseErr) {
                log(`JSON parse error: ${parseErr.message}, extracted: ${(jsonMatch[1] || jsonMatch[0] || '').slice(0, 200)}`);
                sendResponse({ ok: false, error: 'invalid_json', text: jsonText.slice(0, 500) });
              }
              return;
            }
            
            // Non-router call - return as-is
            sendResponse({ ok: true, text: jsonText });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        case 'OFFSCREEN_RUN_PROMPT': {
          try {
            const opts = {
              expectedInputs:  [{ type: 'text', languages: ['en'] }],
              expectedOutputs: [{ type: 'text', languages: ['en'] }]
            };
            const availability = await (self.ai?.languageModel?.availability?.(opts) || 'unavailable');
            if (availability === 'unavailable') throw new Error('Model unavailable');
            const session = await self.ai.languageModel.create({
              ...opts,
              monitor(m) { try { m.addEventListener('downloadprogress', e => console.log(`[Tabitha::offscreen] Model download: ${(e.loaded*100).toFixed(0)}%`)); } catch {} }
            });
            const result = await session.prompt(String(msg.prompt || ''), { outputLanguage: 'en' });
            sendResponse({ ok: true, text: String(result) });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        case 'PING': {
          sendResponse({ ok: true, pong: true });
          return;
        }

        // ============================== TEXT-TO-SPEECH (TTS) HANDLERS ==============================
        case 'SPEAK': {
          try {
            const text = String(msg.text || '').trim();
            if (!text) {
              sendResponse({ ok: false, error: 'empty_text' });
              return;
            }

            const options = msg.options || {};
            const useChromeTTS = typeof chrome !== 'undefined' && chrome.tts && typeof chrome.tts.speak === 'function';
            
            if (useChromeTTS) {
              // Use chrome.tts.speak (preferred)
              const chromeOptions = {
                text: text,
                rate: options.rate || 1.0,
                pitch: options.pitch || 1.0,
                volume: options.volume || 1.0,
                lang: options.lang || 'en-US'
              };

              if (options.voice) {
                chromeOptions.voiceName = options.voice;
              }

              chrome.tts.speak(text, chromeOptions, () => {
                if (chrome.runtime.lastError) {
                  log('chrome.tts error', chrome.runtime.lastError);
                  sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                  sendResponse({ ok: true });
                }
              });
            } else if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
              // Fallback to SpeechSynthesis
              const utterance = new SpeechSynthesisUtterance(text);
              utterance.rate = options.rate || 1.0;
              utterance.pitch = options.pitch || 1.0;
              utterance.volume = options.volume || 1.0;
              utterance.lang = options.lang || 'en-US';

              if (options.voice) {
                const voices = speechSynthesis.getVoices();
                const voice = voices.find(v => v.name === options.voice || v.voiceURI === options.voice);
                if (voice) {
                  utterance.voice = voice;
                }
              }

              utterance.onend = () => {
                sendResponse({ ok: true });
              };

              utterance.onerror = (event) => {
                log('SpeechSynthesis error', event.error);
                sendResponse({ ok: false, error: event.error || 'Speech synthesis error' });
              };

              speechSynthesis.speak(utterance);
            } else {
              sendResponse({ ok: false, error: 'TTS unavailable' });
            }
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        case 'STOP_TTS': {
          try {
            // Stop chrome.tts
            if (typeof chrome !== 'undefined' && chrome.tts && typeof chrome.tts.stop === 'function') {
              chrome.tts.stop();
            }

            // Stop SpeechSynthesis
            if ('speechSynthesis' in window) {
              speechSynthesis.cancel();
            }

            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        case 'GENERATE_SPOKEN_SUMMARY': {
          try {
            const { intent, action, result, groupName, tabCount, candidates, topCandidate } = msg;
            
            // Build prompt for spoken summary
            const prompt = `You are Tabitha, a voice assistant. Generate a short, natural spoken response (≤20 words).

User intent: ${intent || 'unknown'}
Action taken: ${action || 'none'}
Result: ${result || 'none'}
Group: ${groupName || 'none'}
Tab count: ${tabCount || 0}
Candidates: ${candidates?.length || 0}
Confidence: ${topCandidate?.score || 0}

Examples:
- Found 1 tab (auto-jump, ≥0.8) → "Found it — opening next to your current tab"
- Found multiple → "Found ${candidates?.length || 0} matches — which one?"
- Closed tabs → "Closed ${tabCount || 0} tab${tabCount !== 1 ? 's' : ''}"
- Group focus → "Jumping to ${groupName} (${tabCount || 0} tab${tabCount !== 1 ? 's' : ''})"
- Multiple groups → "Which group — ${candidates?.[0]?.card?.groupName || 'first'} or ${candidates?.[1]?.card?.groupName || 'second'}?"
- Error → "I couldn't find that — should I search your history?"
- Tab gone → "That tab isn't open anymore. Want me to search your history?"

Response (spoken, ≤20 words):`;

            // Use Prompt API to generate summary
            const LanguageModel = self.LanguageModel || self.ai?.languageModel;
            if (!LanguageModel) {
              // Fallback to simple template-based response
              let fallback = '';
              if (action === 'open' && candidates?.length === 1 && topCandidate?.score >= 0.8) {
                fallback = 'Found it — opening next to your current tab';
              } else if (action === 'close' && tabCount > 0) {
                fallback = `Closed ${tabCount} tab${tabCount !== 1 ? 's' : ''}`;
              } else if (action === 'focus' && groupName) {
                fallback = `Jumping to ${groupName} (${tabCount || 0} tab${tabCount !== 1 ? 's' : ''})`;
              } else if (candidates?.length > 1) {
                fallback = `Found ${candidates.length} matches — which one?`;
              } else {
                fallback = 'I couldn\'t find that — should I search your history?';
              }
              sendResponse({ ok: true, text: fallback });
              return;
            }

            try {
              await ensureSession();
              const summaryResult = await session.prompt(prompt, { 
                temperature: 0.3, 
                topK: 1,
                outputLanguage: 'en'
              });
              
              const summaryText = String(summaryResult || '').trim().slice(0, 150); // Cap at reasonable length
              sendResponse({ ok: true, text: summaryText });
            } catch (promptErr) {
              // Fallback to template
              let fallback = '';
              if (action === 'open' && candidates?.length === 1 && topCandidate?.score >= 0.8) {
                fallback = 'Found it — opening next to your current tab';
              } else if (action === 'close' && tabCount > 0) {
                fallback = `Closed ${tabCount} tab${tabCount !== 1 ? 's' : ''}`;
              } else if (action === 'focus' && groupName) {
                fallback = `Jumping to ${groupName} (${tabCount || 0} tab${tabCount !== 1 ? 's' : ''})`;
              } else if (candidates?.length > 1) {
                fallback = `Found ${candidates.length} matches — which one?`;
              } else {
                fallback = 'I couldn\'t find that — should I search your history?';
              }
              sendResponse({ ok: true, text: fallback });
            }
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        case 'CLUSTER_WORKFLOWS': {
          try {
            if (!('ai' in self) || !self.ai?.languageModel) {
              sendResponse({ ok: false, reason: 'prompt_api_unavailable' });
              return;
            }
            const { tabs, hints } = msg.payload || {};
            if (!Array.isArray(tabs) || tabs.length === 0) {
              sendResponse({ ok: false, reason: 'No tabs payload' });
              return;
            }
            await ensureSession();
            const prompt = buildWorkflowPrompt({ tabs, hints });
            const result = await session.prompt(prompt, { temperature: 0.1, topK: 1, outputLanguage: 'en' });
            const parsed = extractFirstJSON(String(result));
            if (!parsed) throw new Error('No JSON in model output');
            const valid = validateClusters(parsed, tabs.map(t=>t.id));
            sendResponse({ ok: true, data: valid });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          return;
        }

        default: {
          sendResponse({ ok: false, error: `unknown_type:${msg.type}` });
          return;
        }
      }
    } catch (err) {
      console.error('[Tabitha::offscreen] handler error for', msg?.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  // Tell Chrome we'll respond asynchronously
  return true;
});

log('Offscreen ready ✅');
