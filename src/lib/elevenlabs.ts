// ElevenLabs Text-to-Speech helper
// Uses ElevenLabs REST API to generate speech audio and returns a Blob URL for playback

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

export type TTSOptions = {
  voiceId?: string; // Defaults to Rachel if not provided
  modelId?: string; // Defaults to 'eleven_turbo_v2'
  stability?: number; // 0-1
  similarityBoost?: number; // 0-1
  style?: number; // 0-1
  useSpeakerBoost?: boolean;
};

// Returns an object URL for the generated audio
export async function synthesizeSpeech(text: string, opts: TTSOptions = {}): Promise<string> {
  const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_ELEVENLABS_API_KEY in environment');
  }

  if (!text || !text.trim()) {
    throw new Error('No text provided for TTS');
  }

  const voiceId = opts.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel (publicly documented example)
  const modelId = opts.modelId || 'eleven_turbo_v2';

  const res = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
        style: opts.style ?? 0.0,
        use_speaker_boost: opts.useSpeakerBoost ?? true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText} ${errText}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  return objectUrl;
}

export function revokeObjectUrl(url?: string) {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {
    // no-op
  }
}