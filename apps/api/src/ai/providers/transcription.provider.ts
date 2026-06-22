export interface TranscriptionResult {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string;
  modelMeta: Record<string, unknown>;
}

export abstract class TranscriptionProvider {
  abstract transcribe(input: {
    fileKey: string;
    mediaType: 'audio' | 'video';
    language?: string;
  }): Promise<TranscriptionResult>;
}

export class StubTranscriber extends TranscriptionProvider {
  async transcribe(input: { fileKey: string; mediaType: string; language?: string }): Promise<TranscriptionResult> {
    return {
      text: '[STUB] This is a placeholder transcript. Configure AI_TRANSCRIPTION_PROVIDER=whisper to enable real transcription.',
      segments: [{ start: 0, end: 5, text: '[STUB] Placeholder transcript.' }],
      language: input.language ?? 'en',
      modelMeta: { provider: 'stub', model: 'none' },
    };
  }
}
