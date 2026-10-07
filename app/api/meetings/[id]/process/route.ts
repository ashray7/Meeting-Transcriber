import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getMeeting, saveMeeting, addTasks, saveCandidates, hydrateProjectSnapshot } from '@/lib/store';
import { transcribeWithAudio } from '@/lib/providers';
import { getDiarizationService } from '@/lib/diarization-service';
import { alignWhisperWithDiarization, formatSpeakerAwareTranscript } from '@/lib/alignment';
import { randomUUID } from 'node:crypto';
import { analyzeMeetingIntelligence } from '@/lib/meeting-intelligence-provider';
import { getSelectedModel, LOCAL_MODELS } from '@/lib/model-settings';
import { logger } from '@/lib/logger';
import { registerJob, unregisterJob, isJobActive } from '@/lib/job-manager';

export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting } = await getMeeting(id);
  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  if (isJobActive(id)) return NextResponse.json({ error: 'Processing is already running.' }, { status: 409 });
  if (meeting.inputType === 'notes' && !meeting.transcript?.trim()) return NextResponse.json({ error: 'Meeting notes are missing.' }, { status: 400 });

  const provider = process.env.AI_PROVIDER || 'ollama';
  const transcriptionDiagnostic = provider === 'openai'
    ? `Transcribing with ${process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1'} via OpenAI.`
    : provider === 'demo' ? 'Loading demo transcript.' : `Transcribing with Whisper ${process.env.WHISPER_MODEL || 'small'} on GPU.`;
  const controller = new AbortController();
  registerJob(id, controller);
  logger.info('Queuing meeting processing', { meetingId: id, inputType: meeting.inputType, provider });

  meeting.status = 'queued';
  meeting.error = null;
  meeting.diagnostic = meeting.inputType === 'notes' ? 'Analyzing meeting notes.' : transcriptionDiagnostic;
  meeting.progress = meeting.inputType === 'notes' ? 35 : 10;
  meeting.stage = meeting.inputType === 'notes' ? 'Analyzing meeting and identifying tasks' : 'Queued';
  meeting.updatedAt = new Date().toISOString();
  await saveMeeting(meeting);

  void (async () => {
    try {
      if (controller.signal.aborted) throw new Error('Processing was stopped by user.');
      if (meeting.inputType === 'recording') {
        meeting.status = 'transcribing';
        meeting.stage = 'Transcribing';
        meeting.diagnostic = transcriptionDiagnostic;
        meeting.progress = 20;
        meeting.updatedAt = new Date().toISOString();
        await saveMeeting(meeting);
        logger.info('Starting audio transcription', { meetingId: id, fileUrl: meeting.fileUrl });

        const bytes = await readFile(path.join(process.cwd(), 'uploads', meeting.fileUrl));
        const file = new File([bytes], meeting.originalFileName);
        const transcriptionResult = await transcribeWithAudio(file, { signal: controller.signal });
        try {
          if (controller.signal.aborted) throw new Error('Processing was stopped by user.');
          if (!transcriptionResult.transcript.trim() && !transcriptionResult.segments.length) {
            throw new Error('No speech was detected in the recording.');
          }

          const diarizationService = getDiarizationService();
          const availability = await diarizationService.isAvailable();

          let alignedSegments;
          if (availability.available && transcriptionResult.normalizedAudioPath) {
            meeting.stage = 'Diarizing speakers';
            meeting.diagnostic = 'Running pyannote speaker diarization...';
            meeting.progress = 32;
            meeting.updatedAt = new Date().toISOString();
            await saveMeeting(meeting);

            try {
              const diarizationStart = Date.now();
              const diarizationResult = await diarizationService.diarize(transcriptionResult.normalizedAudioPath, { signal: controller.signal });
              const diarizationDurationMs = Date.now() - diarizationStart;

              meeting.diarizationStatus = 'completed';
              meeting.speakerCount = diarizationResult.speakerCount;
              meeting.diarizationError = null;

              meeting.stage = 'Aligning transcript & speakers';
              meeting.diagnostic = 'Combining Whisper speech timestamps with pyannote speaker turn boundaries...';
              meeting.progress = 45;
              meeting.updatedAt = new Date().toISOString();
              await saveMeeting(meeting);

              const alignmentStart = Date.now();
              alignedSegments = alignWhisperWithDiarization(transcriptionResult.segments, diarizationResult.segments, id);
              const alignmentDurationMs = Date.now() - alignmentStart;

              meeting.transcript = formatSpeakerAwareTranscript(alignedSegments);
              logger.info('Diarization and alignment completed', {
                meetingId: id,
                speakerCount: diarizationResult.speakerCount,
                diarizationDurationMs,
                alignmentDurationMs
              });
            } catch (diarError) {
              const errorMsg = diarError instanceof Error ? diarError.message : 'Diarization failed';
              logger.warn('Speaker diarization failed; continuing with un-diarized transcript', {
                meetingId: id,
                error: errorMsg
              });
              meeting.diarizationStatus = 'failed';
              meeting.diarizationError = errorMsg;
              alignedSegments = alignWhisperWithDiarization(transcriptionResult.segments, [], id);
              meeting.transcript = transcriptionResult.transcript;
            }
          } else {
            meeting.diarizationStatus = 'unavailable';
            meeting.diarizationError = availability.reason || 'pyannote.audio is not available';
            alignedSegments = alignWhisperWithDiarization(transcriptionResult.segments, [], id);
            meeting.transcript = transcriptionResult.transcript;
          }

          meeting.transcriptSegments = alignedSegments.map((s, idx) => ({
            id: s.id || randomUUID(),
            meetingId: id,
            sequence: idx,
            startMs: s.startMs,
            endMs: s.endMs,
            start: s.startMs !== null ? s.startMs / 1000 : null,
            end: s.endMs !== null ? s.endMs / 1000 : null,
            speaker: s.speaker,
            speakerId: s.speakerId,
            speakerConfidence: s.speakerConfidence,
            text: s.text
          }));

          meeting.status = 'transcribed';
          meeting.stage = 'Transcribed';
          meeting.progress = 45;
          meeting.updatedAt = new Date().toISOString();
          await saveMeeting(meeting);
          logger.info('Audio transcription and diarization stage finished', {
            meetingId: id,
            transcriptLength: meeting.transcript.length,
            segmentCount: meeting.transcriptSegments.length,
            diarizationStatus: meeting.diarizationStatus
          });
        } finally {
          await transcriptionResult.cleanup?.();
        }
      }

      if (controller.signal.aborted) throw new Error('Processing was stopped by user.');
      meeting.status = 'analyzing';
      const selectedModel = provider === 'ollama' ? await getSelectedModel()
        : provider === 'openai' ? process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini' : undefined;
      const modelLabel = LOCAL_MODELS.find(model => model.id === selectedModel)?.label || selectedModel || 'demo provider';
      const project = await hydrateProjectSnapshot(meeting.projectSnapshot);
      logger.info('Starting meeting intelligence analysis', { meetingId: id, model: selectedModel, provider });

      const result = await analyzeMeetingIntelligence(meeting, project, selectedModel, async stage => {
        if (controller.signal.aborted) throw new Error('Processing was stopped by user.');
        meeting.stage = stage;
        meeting.diagnostic = `${stage} with ${modelLabel}.`;
        meeting.progress = stage.includes('draft') ? 88 : stage.includes('retriev') ? 76 : 63;
        meeting.updatedAt = new Date().toISOString();
        await saveMeeting(meeting);
      }, controller.signal);

      if (controller.signal.aborted) throw new Error('Processing was stopped by user.');

      meeting.summary = result.summary;
      meeting.topics = result.topics;
      meeting.decisions = result.decisions;
      meeting.openQuestions = result.openQuestions;
      meeting.stage = 'Saving task candidates';
      meeting.diagnostic = 'Saving grounded task candidates.';
      meeting.progress = 94;
      meeting.updatedAt = new Date().toISOString();
      await saveMeeting(meeting);

      await saveCandidates(id, result.candidates);
      if (result.tasks.length) await addTasks(result.tasks);

      const finalStatus = result.tasks.length ? 'review_required' : 'complete';
      meeting.status = finalStatus;
      meeting.stage = 'Complete';
      meeting.progress = 100;
      meeting.error = null;
      meeting.diagnostic = `Analysis finished with ${result.tasks.length} task candidate(s).`;
      meeting.updatedAt = new Date().toISOString();
      await saveMeeting(meeting);

      logger.info('Meeting processing succeeded', {
        meetingId: id,
        status: finalStatus,
        taskCount: result.tasks.length,
        candidateCount: result.candidates.length,
        decisionCount: result.decisions.length
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message.includes('stopped by user'))) {
        meeting.status = 'failed';
        meeting.stage = 'Cancelled';
        meeting.diagnostic = null;
        meeting.error = 'Processing was stopped by user.';
        meeting.updatedAt = new Date().toISOString();
        await saveMeeting(meeting);
        logger.info('Meeting processing stopped by user', { meetingId: id });
      } else {
        meeting.status = 'failed';
        meeting.stage = meeting.stage || 'Processing';
        meeting.diagnostic = null;
        let errMsg = error instanceof Error ? error.message : 'Processing failed. Please retry.';
        try {
          if (errMsg.trim().startsWith('[')) {
            const parsed = JSON.parse(errMsg);
            if (Array.isArray(parsed) && parsed[0]?.message) {
              errMsg = `Output structure error during ${meeting.stage || 'analysis'}: ${parsed[0].message} (path: ${parsed[0].path?.join('.') || 'root'})`;
            }
          }
        } catch {
          // keep original errMsg
        }
        meeting.error = errMsg;
        meeting.updatedAt = new Date().toISOString();
        await saveMeeting(meeting);
        logger.error('Meeting processing failed', { meetingId: id }, error);
      }
    } finally {
      unregisterJob(id);
    }
  })();

  return NextResponse.json({ status: 'processing' });
}
