// ============================================================================
// TEXT-TO-SPEECH (TTS) MODULE
// ============================================================================
// TTS wrapper with chrome.tts.speak (preferred) and SpeechSynthesis fallback.
// Supports barge-in (instant stop), voice selection, and offscreen execution.
// ============================================================================

const log = (msg, data) => console.log(`[Tabitha::tts] ${msg}`, data ?? "");

/**
 * Check if chrome.tts is available
 * @returns {boolean}
 */
export function isChromeTTSAvailable() {
  return typeof chrome !== 'undefined' && chrome.tts && typeof chrome.tts.speak === 'function';
}

/**
 * Check if SpeechSynthesis is available
 * @returns {boolean}
 */
export function isSpeechSynthesisAvailable() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/**
 * Get available voices for SpeechSynthesis
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export async function getAvailableVoices() {
  if (!isSpeechSynthesisAvailable()) {
    return [];
  }

  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
    } else {
      // Voices load asynchronously
      speechSynthesis.onvoiceschanged = () => {
        resolve(speechSynthesis.getVoices());
        speechSynthesis.onvoiceschanged = null;
      };
      // Timeout fallback
      setTimeout(() => resolve(speechSynthesis.getVoices() || []), 1000);
    }
  });
}

/**
 * Find preferred voice based on system/user preferences
 * @param {SpeechSynthesisVoice[]} voices - Available voices
 * @param {string} preferredLang - Preferred language code (e.g., 'en-US')
 * @returns {SpeechSynthesisVoice|null}
 */
export function findPreferredVoice(voices, preferredLang = 'en-US') {
  if (!voices || voices.length === 0) return null;

  // Prefer system default or user's language
  const langMatch = voices.find(v => v.lang === preferredLang);
  if (langMatch) return langMatch;

  // Fallback to English
  const englishVoice = voices.find(v => v.lang.startsWith('en'));
  if (englishVoice) return englishVoice;

  // Fallback to first available
  return voices[0] || null;
}

/**
 * Text-to-Speech Manager
 */
export class TTSManager {
  constructor() {
    this.isSpeaking = false;
    this.currentUtterance = null;
    this.onSpeakStartCallback = null;
    this.onSpeakEndCallback = null;
    this.onSpeakErrorCallback = null;
    this.preferChromeTTS = true; // Prefer chrome.tts over SpeechSynthesis
    this.useOffscreen = true; // Run TTS from offscreen for persistence
  }

  /**
   * Initialize TTS manager
   * @param {Object} options - Configuration options
   * @param {boolean} options.preferChromeTTS - Use chrome.tts if available (default: true)
   * @param {boolean} options.useOffscreen - Run TTS from offscreen document (default: true)
   * @returns {Promise<boolean>} True if initialized successfully
   */
  async init(options = {}) {
    this.preferChromeTTS = options.preferChromeTTS !== undefined ? options.preferChromeTTS : true;
    this.useOffscreen = options.useOffscreen !== undefined ? options.useOffscreen : true;

    // Check availability
    if (this.preferChromeTTS && isChromeTTSAvailable()) {
      log("Using chrome.tts");
      return true;
    } else if (isSpeechSynthesisAvailable()) {
      log("Using SpeechSynthesis (chrome.tts unavailable)");
      return true;
    } else {
      log("TTS unavailable");
      if (this.onSpeakErrorCallback) {
        this.onSpeakErrorCallback(new Error("Text-to-speech unavailable"));
      }
      return false;
    }
  }

  /**
   * Speak text using the best available method
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   * @param {string} options.voice - Voice name or ID
   * @param {number} options.rate - Speech rate (0.1-10, default: 1.0)
   * @param {number} options.pitch - Pitch (0-2, default: 1.0)
   * @param {number} options.volume - Volume (0-1, default: 1.0)
   * @param {string} options.lang - Language code (default: 'en-US')
   * @returns {Promise<boolean>} True if speaking started successfully
   */
  async speak(text, options = {}) {
    if (!text || text.trim().length === 0) {
      log("Empty text, skipping");
      return false;
    }

    // Stop any current speech (barge-in support)
    this.stopSpeaking();

    // If using offscreen, delegate to offscreen handler
    if (this.useOffscreen && typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SPEAK',
          text: text.trim(),
          options: {
            voice: options.voice || null,
            rate: options.rate || 1.0,
            pitch: options.pitch || 1.0,
            volume: options.volume || 1.0,
            lang: options.lang || 'en-US'
          }
        });

        if (response?.ok) {
          this.isSpeaking = true;
          if (this.onSpeakStartCallback) {
            this.onSpeakStartCallback(text);
          }
          
          // Simulate end event after estimated duration (rough approximation)
          const estimatedDuration = text.length * 50; // ~50ms per character
          setTimeout(() => {
            this.isSpeaking = false;
            if (this.onSpeakEndCallback) {
              this.onSpeakEndCallback();
            }
          }, estimatedDuration);
          
          return true;
        } else {
          // Fallback to local TTS if offscreen fails
          return this.speakLocally(text, options);
        }
      } catch (err) {
        log("Offscreen TTS failed, falling back to local", err);
        return this.speakLocally(text, options);
      }
    } else {
      // Use local TTS
      return this.speakLocally(text, options);
    }
  }

  /**
   * Speak using local TTS (chrome.tts or SpeechSynthesis)
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   * @returns {Promise<boolean>}
   */
  async speakLocally(text, options = {}) {
    // Try chrome.tts first (if preferred and available)
    if (this.preferChromeTTS && isChromeTTSAvailable()) {
      return this.speakWithChromeTTS(text, options);
    }

    // Fallback to SpeechSynthesis
    if (isSpeechSynthesisAvailable()) {
      return this.speakWithSpeechSynthesis(text, options);
    }

    // No TTS available
    log("No TTS available");
    if (this.onSpeakErrorCallback) {
      this.onSpeakErrorCallback(new Error("Text-to-speech unavailable"));
    }
    return false;
  }

  /**
   * Speak using chrome.tts.speak
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   * @returns {Promise<boolean>}
   */
  async speakWithChromeTTS(text, options = {}) {
    return new Promise((resolve) => {
      const chromeOptions = {
        text: text.trim(),
        rate: options.rate || 1.0,
        pitch: options.pitch || 1.0,
        volume: options.volume || 1.0,
        lang: options.lang || 'en-US'
      };

      if (options.voice) {
        chromeOptions.voiceName = options.voice;
      }

      this.isSpeaking = true;
      if (this.onSpeakStartCallback) {
        this.onSpeakStartCallback(text);
      }

      chrome.tts.speak(text.trim(), chromeOptions, () => {
        if (chrome.runtime.lastError) {
          log("chrome.tts error", chrome.runtime.lastError);
          this.isSpeaking = false;
          if (this.onSpeakErrorCallback) {
            this.onSpeakErrorCallback(new Error(chrome.runtime.lastError.message));
          }
          resolve(false);
        } else {
          // Note: chrome.tts doesn't provide direct end event, so we estimate
          const estimatedDuration = text.length * 50;
          setTimeout(() => {
            this.isSpeaking = false;
            if (this.onSpeakEndCallback) {
              this.onSpeakEndCallback();
            }
          }, estimatedDuration);
          resolve(true);
        }
      });
    });
  }

  /**
   * Speak using SpeechSynthesis
   * @param {string} text - Text to speak
   * @param {Object} options - TTS options
   * @returns {Promise<boolean>}
   */
  async speakWithSpeechSynthesis(text, options = {}) {
    return new Promise(async (resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text.trim());

        // Set options
        utterance.rate = options.rate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = options.volume || 1.0;
        utterance.lang = options.lang || 'en-US';

        // Find and set preferred voice
        if (options.voice) {
          utterance.voice = options.voice;
        } else {
          const voices = await getAvailableVoices();
          const preferred = findPreferredVoice(voices, options.lang || 'en-US');
          if (preferred) {
            utterance.voice = preferred;
          }
        }

        // Event handlers
        utterance.onstart = () => {
          log("SpeechSynthesis started");
          this.isSpeaking = true;
          this.currentUtterance = utterance;
          if (this.onSpeakStartCallback) {
            this.onSpeakStartCallback(text);
          }
        };

        utterance.onend = () => {
          log("SpeechSynthesis ended");
          this.isSpeaking = false;
          this.currentUtterance = null;
          if (this.onSpeakEndCallback) {
            this.onSpeakEndCallback();
          }
        };

        utterance.onerror = (event) => {
          log("SpeechSynthesis error", event.error);
          this.isSpeaking = false;
          this.currentUtterance = null;
          if (this.onSpeakErrorCallback) {
            this.onSpeakErrorCallback(new Error(event.error || 'Speech synthesis error'));
          }
          resolve(false);
        };

        // Start speaking
        speechSynthesis.speak(utterance);
        resolve(true);
      } catch (err) {
        log("SpeechSynthesis setup error", err);
        this.isSpeaking = false;
        if (this.onSpeakErrorCallback) {
          this.onSpeakErrorCallback(err);
        }
        resolve(false);
      }
    });
  }

  /**
   * Stop current speech immediately (for barge-in)
   */
  stopSpeaking() {
    if (!this.isSpeaking) {
      return;
    }

    log("Stopping TTS (barge-in)");

    // Stop chrome.tts (if using offscreen, send STOP_TTS message)
    if (this.useOffscreen && typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'STOP_TTS' }).catch(() => {
        // Ignore errors
      });
    }

    // Stop SpeechSynthesis
    if (isSpeechSynthesisAvailable()) {
      speechSynthesis.cancel();
    }

    // Clear state
    this.isSpeaking = false;
    this.currentUtterance = null;
  }

  /**
   * Check if currently speaking
   * @returns {boolean}
   */
  isActive() {
    return this.isSpeaking;
  }

  /**
   * Set callback for when speaking starts
   * @param {Function} callback - (text) => void
   */
  onSpeakStart(callback) {
    this.onSpeakStartCallback = callback;
  }

  /**
   * Set callback for when speaking ends
   * @param {Function} callback - () => void
   */
  onSpeakEnd(callback) {
    this.onSpeakEndCallback = callback;
  }

  /**
   * Set callback for errors
   * @param {Function} callback - (error) => void
   */
  onSpeakError(callback) {
    this.onSpeakErrorCallback = callback;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stopSpeaking();
    this.onSpeakStartCallback = null;
    this.onSpeakEndCallback = null;
    this.onSpeakErrorCallback = null;
  }
}

/**
 * Create and initialize a TTS manager
 * @param {Object} options - Configuration options
 * @returns {Promise<TTSManager|null>}
 */
export async function createTTSManager(options = {}) {
  const manager = new TTSManager();
  if (await manager.init(options)) {
    return manager;
  }
  return null;
}

