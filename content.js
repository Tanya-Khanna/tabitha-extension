// ============================================================================
// TABITHA CONTENT SCRIPT
// ============================================================================
// Handles floating mic chip overlay for global voice listening
// ============================================================================

const log = (msg, data) => console.log(`[Tabitha::content] ${msg}`, data ?? "");

// State
let voiceChip = null;
let isVisible = false;

/**
 * Create floating mic chip overlay
 */
function createVoiceChip() {
  if (voiceChip) return voiceChip;

  // Create container
  const chip = document.createElement('div');
  chip.id = 'tabitha-voice-chip';
  chip.className = 'tabitha-voice-chip';
  
  // Create waveform container
  const waveform = document.createElement('div');
  waveform.className = 'tabitha-waveform';
  for (let i = 0; i < 5; i++) {
    const bar = document.createElement('div');
    bar.className = 'tabitha-waveform-bar';
    waveform.appendChild(bar);
  }
  
  // Create text
  const text = document.createElement('span');
  text.className = 'tabitha-voice-text';
  text.textContent = 'Listening...';
  
  chip.appendChild(waveform);
  chip.appendChild(text);
  
  // Inject styles
  injectStyles();
  
  // Add to page
  document.body.appendChild(chip);
  voiceChip = chip;
  
  return chip;
}

/**
 * Inject CSS styles for voice chip
 */
function injectStyles() {
  if (document.getElementById('tabitha-voice-chip-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'tabitha-voice-chip-styles';
  style.textContent = `
    .tabitha-voice-chip {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: linear-gradient(135deg, rgba(123, 97, 255, 0.95), rgba(155, 129, 255, 0.95));
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(123, 97, 255, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: white;
      animation: tabitha-fade-in 0.2s ease;
      pointer-events: none;
      user-select: none;
    }

    .tabitha-voice-chip.hidden {
      display: none;
    }

    .tabitha-voice-chip.listening .tabitha-waveform {
      animation: tabitha-waveform-pulse 0.6s ease-in-out infinite;
    }

    .tabitha-voice-chip.thinking {
      background: linear-gradient(135deg, rgba(242, 213, 203, 0.95), rgba(255, 200, 180, 0.95));
      color: #1a1a1a;
    }

    .tabitha-voice-chip.speaking {
      background: linear-gradient(135deg, rgba(123, 97, 255, 0.95), rgba(155, 129, 255, 0.95));
    }

    .tabitha-waveform {
      display: flex;
      align-items: center;
      gap: 3px;
      height: 20px;
    }

    .tabitha-waveform-bar {
      width: 3px;
      height: 8px;
      background: rgba(255, 255, 255, 0.8);
      border-radius: 2px;
      animation: tabitha-bar-pulse 0.6s ease-in-out infinite;
    }

    .tabitha-waveform-bar:nth-child(1) { animation-delay: 0s; }
    .tabitha-waveform-bar:nth-child(2) { animation-delay: 0.1s; }
    .tabitha-waveform-bar:nth-child(3) { animation-delay: 0.2s; }
    .tabitha-waveform-bar:nth-child(4) { animation-delay: 0.3s; }
    .tabitha-waveform-bar:nth-child(5) { animation-delay: 0.4s; }

    .tabitha-voice-text {
      white-space: nowrap;
    }

    @keyframes tabitha-fade-in {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes tabitha-bar-pulse {
      0%, 100% {
        height: 8px;
        opacity: 0.6;
      }
      50% {
        height: 16px;
        opacity: 1;
      }
    }

    @keyframes tabitha-waveform-pulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.05);
      }
    }

    /* Respect reduced motion preference */
    @media (prefers-reduced-motion: reduce) {
      .tabitha-voice-chip {
        animation: none;
      }
      .tabitha-voice-chip.listening .tabitha-waveform,
      .tabitha-waveform-bar {
        animation: none;
      }
      .tabitha-waveform-bar {
        height: 12px;
        opacity: 0.8;
      }
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Show voice chip with state
 * @param {string} state - 'listening', 'thinking', 'speaking', 'idle'
 */
function showVoiceChip(state = 'listening') {
  if (!voiceChip) {
    createVoiceChip();
  }
  
  if (!voiceChip) return;
  
  // Update state classes
  voiceChip.className = `tabitha-voice-chip ${state}`;
  voiceChip.classList.remove('hidden');
  isVisible = true;
  
  // Update text based on state
  const textEl = voiceChip.querySelector('.tabitha-voice-text');
  if (textEl) {
    switch (state) {
      case 'listening':
        textEl.textContent = 'Listening...';
        break;
      case 'thinking':
        textEl.textContent = 'Thinking...';
        break;
      case 'speaking':
        textEl.textContent = 'Speaking...';
        break;
      case 'idle':
      default:
        textEl.textContent = 'Ready';
        break;
    }
  }
}

/**
 * Hide voice chip
 */
function hideVoiceChip() {
  if (voiceChip) {
    voiceChip.classList.add('hidden');
    isVisible = false;
  }
}

/**
 * Update voice chip text (for live captions)
 * @param {string} text - Text to display
 */
function updateVoiceChipText(text) {
  if (!voiceChip || !isVisible) return;
  
  const textEl = voiceChip.querySelector('.tabitha-voice-text');
  if (textEl && text) {
    textEl.textContent = text.length > 40 ? text.slice(0, 40) + '...' : text;
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'VOICE_CHIP_SHOW':
      showVoiceChip(msg.state || 'listening');
      break;
    
    case 'VOICE_CHIP_HIDE':
      hideVoiceChip();
      break;
    
    case 'VOICE_CHIP_UPDATE':
      if (msg.state) {
        showVoiceChip(msg.state);
      }
      if (msg.text) {
        updateVoiceChipText(msg.text);
      }
      break;
    
    default:
      break;
  }
});

// Handle Esc key to dismiss
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isVisible && voiceChip) {
    hideVoiceChip();
    // Notify background that chip was dismissed
    chrome.runtime.sendMessage({ type: 'VOICE_CHIP_DISMISSED' }).catch(() => {
      // Ignore errors
    });
  }
});

log('Content script loaded ✅');
