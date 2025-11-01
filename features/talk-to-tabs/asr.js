// ============================================================================
// SPEECH RECOGNITION (ASR) MODULE
// ============================================================================
// Web Speech API wrapper with Voice Activity Detection (VAD), interim results,
// and error handling for the "Talk to Tabs" feature.
// ============================================================================

const log = (msg, data) => console.log(`[Tabitha::asr] ${msg}`, data ?? "");

/**
 * Check if Speech Recognition is available in this browser
 * @returns {boolean}
 */
export function isSpeechRecognitionAvailable() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

/**
 * Create and configure a SpeechRecognition instance
 * @param {Object} options - Configuration options
 * @param {string} options.language - Language code (default: 'en-US')
 * @param {boolean} options.continuous - Continuous recognition (default: false for push-to-talk)
 * @param {boolean} options.interimResults - Return interim results (default: true for live captions)
 * @returns {SpeechRecognition|null} Configured instance or null if unavailable
 */
export function createSpeechRecognition(options = {}) {
  if (!isSpeechRecognitionAvailable()) {
    log("Speech Recognition unavailable");
    return null;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();

  recognition.lang = options.language || 'en-US';
  recognition.continuous = options.continuous !== undefined ? options.continuous : false; // Push-to-talk
  recognition.interimResults = options.interimResults !== undefined ? options.interimResults : true; // Live captions
  recognition.maxAlternatives = 1;

  return recognition;
}

/**
 * Speech Recognition manager with VAD (Voice Activity Detection)
 */
export class SpeechRecognitionManager {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.onInterimCallback = null;
    this.onFinalCallback = null;
    this.onErrorCallback = null;
    this.vadTimer = null;
    this.vadTimeout = 800; // 700-900ms range, default 800ms (silence after speech)
    this.initialTimeout = 5000; // 5 seconds to start speaking (before any speech detected)
    this.hasDetectedSpeech = false; // Track if we've detected any speech yet
    this.lastSpeechTime = null;
  }

  /**
   * Initialize the Speech Recognition instance
   * @param {Object} options - Configuration options
   * @returns {boolean} True if initialized successfully
   */
  init(options = {}) {
    if (!isSpeechRecognitionAvailable()) {
      log("Speech Recognition not available");
      if (this.onErrorCallback) {
        this.onErrorCallback(new Error("Voice understanding isn't available — use the text box or update Chrome."));
      }
      return false;
    }

    this.recognition = createSpeechRecognition({
      language: options.language || 'en-US',
      continuous: false,
      interimResults: true
    });

    if (!this.recognition) {
      return false;
    }

    // Set up event handlers
    this.recognition.onstart = () => {
      log("ASR started");
      this.isListening = true;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.hasDetectedSpeech = false;
      this.lastSpeechTime = Date.now();
      // Start with longer timeout to give user time to start speaking
      this.startInitialTimeout();
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      // Update interim transcript for live captions
      if (interim) {
        this.interimTranscript = interim;
        this.lastSpeechTime = Date.now();
        this.hasDetectedSpeech = true; // Mark that we've detected speech
        this.resetVADTimer(); // Switch to shorter VAD timeout after speech
        
        if (this.onInterimCallback) {
          this.onInterimCallback(interim, Date.now() - this.lastSpeechTime);
        }
      }

      // Update final transcript
      if (final) {
        this.finalTranscript += final;
        this.lastSpeechTime = Date.now();
        this.hasDetectedSpeech = true; // Mark that we've detected speech
        this.resetVADTimer(); // Switch to shorter VAD timeout after speech
      }
    };

    this.recognition.onend = () => {
      log("ASR ended", { final: this.finalTranscript, interim: this.interimTranscript });
      this.isListening = false;
      this.clearVADTimer();

      // Finalize if we have a transcript
      if (this.finalTranscript.trim() || this.interimTranscript.trim()) {
        const complete = (this.finalTranscript + this.interimTranscript).trim();
        if (this.onFinalCallback && complete) {
          this.onFinalCallback(complete);
        }
      }
    };

    this.recognition.onerror = (event) => {
      log("ASR error", event.error);
      this.isListening = false;
      this.clearVADTimer();

      let errorMessage = "Speech recognition error";
      
      if (event.error === 'no-speech') {
        errorMessage = "No speech detected";
      } else if (event.error === 'audio-capture') {
        errorMessage = "I need microphone permission for voice. Please enable it and try again.";
      } else if (event.error === 'not-allowed') {
        errorMessage = "Microphone access denied. Please allow microphone permission.";
      } else if (event.error === 'network') {
        errorMessage = "Network error. Please check your connection.";
      }

      if (this.onErrorCallback) {
        this.onErrorCallback(new Error(errorMessage));
      }
    };

    return true;
  }

  /**
   * Start listening for speech
   * @param {Object} options - Additional options
   * @returns {boolean} True if started successfully
   */
  startListening(options = {}) {
    if (!this.recognition) {
      if (!this.init(options)) {
        return false;
      }
    }

    if (this.isListening) {
      log("Already listening");
      return true;
    }

    try {
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.hasDetectedSpeech = false;
      this.lastSpeechTime = Date.now();
      this.recognition.start();
      this.startInitialTimeout();
      return true;
    } catch (err) {
      log("Failed to start listening", err);
      if (this.onErrorCallback) {
        this.onErrorCallback(err);
      }
      return false;
    }
  }

  /**
   * Stop listening and finalize transcript
   */
  stopListening() {
    if (!this.isListening || !this.recognition) {
      return;
    }

    this.clearVADTimer();
    
    try {
      this.recognition.stop();
    } catch (err) {
      log("Error stopping recognition", err);
    }
  }

  /**
   * Set callback for interim results (live captions)
   * @param {Function} callback - (interimText, latencyMs) => void
   */
  onInterimResult(callback) {
    this.onInterimCallback = callback;
  }

  /**
   * Set callback for final transcript
   * @param {Function} callback - (finalText) => void
   */
  onFinalResult(callback) {
    this.onFinalCallback = callback;
  }

  /**
   * Set callback for errors
   * @param {Function} callback - (error) => void
   */
  onError(callback) {
    this.onErrorCallback = callback;
  }

  /**
   * Set VAD timeout (silence duration before auto-finalizing)
   * @param {number} timeoutMs - Milliseconds (700-900ms range recommended)
   */
  setVADTimeout(timeoutMs) {
    this.vadTimeout = Math.max(700, Math.min(900, timeoutMs));
  }

  /**
   * Start initial timeout (longer wait for user to start speaking)
   */
  startInitialTimeout() {
    this.clearVADTimer();
    this.vadTimer = setTimeout(() => {
      if (this.isListening && !this.hasDetectedSpeech) {
        log("Initial timeout — no speech detected, finalizing");
        this.stopListening();
      }
    }, this.initialTimeout);
  }

  /**
   * Start VAD timer (silence detection after speech has been detected)
   */
  startVADTimer() {
    this.clearVADTimer();
    this.vadTimer = setTimeout(() => {
      if (this.isListening) {
        log("VAD timeout — auto-finalizing");
        this.stopListening();
      }
    }, this.vadTimeout);
  }

  /**
   * Reset VAD timer (called on any speech activity)
   * Switches from initial timeout to shorter VAD timeout once speech is detected
   */
  resetVADTimer() {
    if (this.isListening && this.hasDetectedSpeech && this.lastSpeechTime) {
      this.clearVADTimer();
      const timeSinceLastSpeech = Date.now() - this.lastSpeechTime;
      const remainingTimeout = Math.max(0, this.vadTimeout - timeSinceLastSpeech);
      
      if (remainingTimeout > 0) {
        // Use shorter VAD timeout now that speech has been detected
        this.vadTimer = setTimeout(() => {
          if (this.isListening) {
            log("VAD timeout — auto-finalizing");
            this.stopListening();
          }
        }, remainingTimeout);
      } else {
        // Already past timeout, finalize immediately
        this.stopListening();
      }
    }
  }

  /**
   * Clear VAD timer
   */
  clearVADTimer() {
    if (this.vadTimer) {
      clearTimeout(this.vadTimer);
      this.vadTimer = null;
    }
  }

  /**
   * Get current transcript (final + interim)
   * @returns {string}
   */
  getTranscript() {
    return (this.finalTranscript + ' ' + this.interimTranscript).trim();
  }

  /**
   * Check if currently listening
   * @returns {boolean}
   */
  isActive() {
    return this.isListening;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.clearVADTimer();
    if (this.isListening) {
      try {
        this.recognition?.stop();
      } catch (err) {
        log("Error stopping during destroy", err);
      }
    }
    this.recognition = null;
    this.isListening = false;
    this.onInterimCallback = null;
    this.onFinalCallback = null;
    this.onErrorCallback = null;
  }
}

/**
 * Create and initialize a Speech Recognition manager
 * @param {Object} options - Configuration options
 * @returns {SpeechRecognitionManager|null}
 */
export function createASRManager(options = {}) {
  const manager = new SpeechRecognitionManager();
  if (manager.init(options)) {
    return manager;
  }
  return null;
}

