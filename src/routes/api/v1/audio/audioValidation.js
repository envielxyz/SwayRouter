export const MAX_SPEECH_INPUT_LENGTH = 8192;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

export const SUPPORTED_SPEECH_FORMATS = new Set([
  "mp3", "opus", "aac", "flac", "wav", "pcm"
]);

export const SUPPORTED_TRANSCRIPTION_FORMATS = new Set([
  "json", "text", "srt", "verbose_json", "vtt"
]);

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac"
]);

export function validateSpeechBody(body) {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const model = String(body.model || "").trim();
  if (!model) {
    return { error: "model is required" };
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) {
    return { error: "input text is required" };
  }

  if (input.length > MAX_SPEECH_INPUT_LENGTH) {
    return { error: `input exceeds maximum length of ${MAX_SPEECH_INPUT_LENGTH} characters` };
  }

  const responseFormat = String(body.response_format || "mp3").toLowerCase();
  if (body.response_format && !SUPPORTED_SPEECH_FORMATS.has(responseFormat)) {
    return { error: `Unsupported response_format. Supported: ${[...SUPPORTED_SPEECH_FORMATS].join(", ")}` };
  }

  let speed = 1.0;
  if (body.speed !== undefined && body.speed !== null) {
    const s = Number(body.speed);
    if (!Number.isFinite(s) || s < 0.25 || s > 4.0) {
      return { error: "speed must be a number between 0.25 and 4.0" };
    }
    speed = s;
  }

  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : "alloy";

  return {
    value: {
      model,
      input,
      voice,
      response_format: responseFormat,
      speed,
    },
  };
}

export function validateAudioFile(file) {
  if (!file || typeof file !== "object") {
    return { error: "file is required" };
  }

  const size = Number(file.size || 0);
  if (size <= 0) {
    return { error: "file cannot be empty" };
  }

  if (size > MAX_AUDIO_BYTES) {
    return { error: "file exceeds maximum limit of 25 MB" };
  }

  const name = String(file.name || "").toLowerCase();
  const ext = name.split(".").pop();
  const type = String(file.type || "").toLowerCase();

  const isAudioType = type.startsWith("audio/") || type.startsWith("video/") || type === "application/octet-stream";
  const isValidExt = ext && SUPPORTED_AUDIO_EXTENSIONS.has(ext);

  if (!isValidExt && !isAudioType) {
    return { error: "Unsupported audio format. Supported: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, flac" };
  }

  return { valid: true };
}

export function redactAudioError(error) {
  return String(error?.message || error || "Audio operation failed")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;&]+/gi, "Authorization=[redacted]")
    .replace(/(authorization|token|api[_-]?key|password)\s*[:=]\s*[^\s,;&]+/gi, "$1=[redacted]");
}
