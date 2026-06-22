export interface SummaryResult {
  summary: string;
  modelMeta: Record<string, unknown>;
}

export abstract class SummaryProvider {
  abstract summarize(input: {
    transcript: string;
    context: { studentName: string; instrument?: string; date: string };
  }): Promise<SummaryResult>;
}

export class StubSummarizer extends SummaryProvider {
  async summarize(input: { transcript: string; context: { studentName: string; instrument?: string; date: string } }): Promise<SummaryResult> {
    return {
      summary: `[STUB] Lesson summary for ${input.context.studentName} on ${input.context.date}. Configure AI_SUMMARY_PROVIDER=llm to enable real AI summaries.`,
      modelMeta: { provider: 'stub', model: 'none' },
    };
  }
}
