import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getMeeting, saveMeeting, addTasks, saveCandidates, hydrateProjectSnapshot } from '@/lib/store';
import { transcribe } from '@/lib/providers';
import { analyzeMeetingIntelligence } from '@/lib/meeting-intelligence-provider';
import { getSelectedModel, LOCAL_MODELS } from '@/lib/model-settings';

export const runtime = 'nodejs';
const running = new Set<string>();

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting } = await getMeeting(id);
  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  if (running.has(id)) return NextResponse.json({ error: 'Processing is already running.' }, { status: 409 });
  if (meeting.inputType === 'notes' && !meeting.transcript?.trim()) return NextResponse.json({ error: 'Meeting notes are missing.' }, { status: 400 });

  const provider = process.env.AI_PROVIDER || 'ollama';
  const transcriptionDiagnostic = provider === 'openai'
    ? `Transcribing with ${process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1'} via OpenAI.`
    : provider === 'demo' ? 'Loading demo transcript.' : `Transcribing with Whisper ${process.env.WHISPER_MODEL || 'small'} on GPU.`;
  running.add(id);
  meeting.status = 'processing'; meeting.error = null;
  meeting.diagnostic = meeting.inputType === 'notes' ? 'Analyzing meeting notes.' : transcriptionDiagnostic;
  meeting.progress = meeting.inputType === 'notes' ? 45 : 18;
  meeting.stage = meeting.inputType === 'notes' ? 'Analyzing meeting and identifying tasks' : 'Transcribing';
  meeting.updatedAt = new Date().toISOString();
  await saveMeeting(meeting);

  void (async () => {
    try {
      if (meeting.inputType === 'recording') {
        meeting.stage = 'Transcribing'; meeting.diagnostic = transcriptionDiagnostic; meeting.progress = 18;
        meeting.updatedAt = new Date().toISOString(); await saveMeeting(meeting);
        const bytes = await readFile(path.join(process.cwd(), 'uploads', meeting.fileUrl));
        const file = new File([bytes], meeting.originalFileName);
        meeting.transcript = await transcribe(file);
        if (!meeting.transcript.trim()) throw new Error('No speech was detected in the recording.');
        await saveMeeting(meeting);
        const refreshed = await getMeeting(id);
        if (refreshed.meeting) meeting.transcriptSegments = refreshed.meeting.transcriptSegments;
      }

      const selectedModel = provider === 'ollama' ? await getSelectedModel()
        : provider === 'openai' ? process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini' : undefined;
      const modelLabel = LOCAL_MODELS.find(model => model.id === selectedModel)?.label || selectedModel || 'demo provider';
      const project = await hydrateProjectSnapshot(meeting.projectSnapshot);
      const result = await analyzeMeetingIntelligence(meeting, project, selectedModel, async stage => {
        meeting.stage = stage; meeting.diagnostic = `${stage} with ${modelLabel}.`;
        meeting.progress = stage.includes('draft') ? 88 : stage.includes('retriev') ? 76 : 63;
        meeting.updatedAt = new Date().toISOString(); await saveMeeting(meeting);
      });
      meeting.summary = result.summary; meeting.topics = result.topics;
      meeting.decisions = result.decisions; meeting.openQuestions = result.openQuestions;
      meeting.stage = 'Saving task candidates'; meeting.diagnostic = 'Saving grounded task candidates.';
      meeting.progress = 94; meeting.updatedAt = new Date().toISOString(); await saveMeeting(meeting);
      await saveCandidates(id, result.candidates);
      if (result.tasks.length) await addTasks(result.tasks);
      meeting.status = 'completed'; meeting.stage = 'Complete'; meeting.progress = 100;
      meeting.error = null; meeting.diagnostic = 'Meeting processing complete.';
      meeting.updatedAt = new Date().toISOString(); await saveMeeting(meeting);
    } catch (error) {
      meeting.status = 'failed'; meeting.stage = null; meeting.diagnostic = null;
      meeting.error = error instanceof Error ? error.message : 'Processing failed. Please retry.';
      meeting.updatedAt = new Date().toISOString(); await saveMeeting(meeting);
    } finally { running.delete(id); }
  })();
  return NextResponse.json({ status: 'processing' });
}
