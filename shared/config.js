// Shared configuration constants
export const MEETING_DOMAINS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "webex.com",
  "whereby.com",
  "slack.com" // huddles
];

export const BUZZY_DOMAINS_DEFAULT = [
  "youtube.com",
  "music.youtube.com",
  "open.spotify.com",
  "outlook.office.com",
  "mail.google.com",
  "gmail.com",
  "slack.com",
  "web.whatsapp.com",
  "discord.com",
];

export const POLL_MS = 2000; // light polling to keep state robust

// Phase 12: Confidence thresholds
export const AUTO_EXECUTE_MIN_SCORE = 0.70; // Lowered for better auto-execution (was 0.80)
export const AUTO_EXECUTE_MIN_GAP = 0.05; // Smaller gap needed (was 0.10)

