import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { SpeakerDiarizationResult } from './types';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export const diarizationSegmentSchema = z.object({
  speakerId: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  confidence: z.number().nullable().optional()
});

export const diarizationResultSchema = z.object({
  speakerCount: z.number().int().min(0),
  segments: z.array(diarizationSegmentSchema),
  durationMs: z.number().optional()
});

export interface SpeakerDiarizationService {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  diarize(audioPath: string, options?: { signal?: AbortSignal }): Promise<SpeakerDiarizationResult>;
}

export class PyannoteDiarizationService implements SpeakerDiarizationService {
  private pythonBin: string;
  private scriptPath: string;
  private model: string;
  private device?: string;
  private hfToken?: string;
  private timeoutMs: number;

  constructor(options?: {
    pythonBin?: string;
    scriptPath?: string;
    model?: string;
    device?: string;
    hfToken?: string;
    timeoutMs?: number;
  }) {
    this.pythonBin = options?.pythonBin || process.env.PYTHON_BIN || 'python3';
    this.scriptPath = options?.scriptPath || path.join(process.cwd(), 'scripts', 'diarize.py');
    this.model = options?.model || process.env.PYANNOTE_MODEL || 'pyannote/speaker-diarization-community-1';
    this.device = options?.device || process.env.DIARIZATION_DEVICE;
    this.hfToken = options?.hfToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
    this.timeoutMs = options?.timeoutMs || Number(process.env.DIARIZATION_TIMEOUT_MS || 900000); // 15 mins default
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    if (process.env.ENABLE_DIARIZATION === 'false') {
      return { available: false, reason: 'Speaker diarization is disabled via ENABLE_DIARIZATION=false' };
    }

    if (!existsSync(this.scriptPath)) {
      return { available: false, reason: `Diarization worker script not found at: ${this.scriptPath}` };
    }

    try {
      const { stdout } = await execFileAsync(this.pythonBin, [this.scriptPath, '--check-available'], {
        timeout: 10000
      });
      const parsed = JSON.parse(stdout.trim());
      if (parsed.available) {
        return { available: true };
      }
      return {
        available: false,
        reason: parsed.reason || 'pyannote.audio is not available in the Python environment'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed';
      return {
        available: false,
        reason: `Failed to check pyannote availability using '${this.pythonBin}': ${message}`
      };
    }
  }

  async diarize(audioPath: string, options?: { signal?: AbortSignal }): Promise<SpeakerDiarizationResult> {
    if (options?.signal?.aborted) {
      throw new Error('Processing was stopped by user.');
    }
    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not found for diarization: ${audioPath}`);
    }

    const startTime = Date.now();
    logger.info('Starting pyannote speaker diarization', {
      audioPath,
      model: this.model,
      device: this.device || 'auto'
    });

    const args = [this.scriptPath, '--audio', audioPath, '--model', this.model];
    if (this.hfToken) args.push('--hf-token', this.hfToken);
    if (this.device) args.push('--device', this.device);

    let stdout: string;
    try {
      const result = await execFileAsync(this.pythonBin, args, {
        signal: options?.signal,
        timeout: this.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          HF_TOKEN: this.hfToken || process.env.HF_TOKEN,
          HUGGINGFACE_TOKEN: this.hfToken || process.env.HUGGINGFACE_TOKEN
        }
      });
      stdout = result.stdout;
    } catch (err: unknown) {
      if (options?.signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
        throw new Error('Processing was stopped by user.');
      }
      const error = err as { stdout?: string; stderr?: string; message?: string };
      let errorDetail = error.message || 'Diarization subprocess failed';
      if (error.stdout) {
        try {
          const parsed = JSON.parse(error.stdout.trim());
          if (parsed.error) errorDetail = parsed.error;
        } catch {
          // not json
        }
      }
      if (error.stderr && error.stderr.trim()) {
        errorDetail = `${errorDetail}: ${error.stderr.trim()}`;
      }
      logger.error('Pyannote diarization subprocess error', {}, err);
      throw new Error(errorDetail);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(stdout.trim());
    } catch {
      throw new Error('Diarization worker returned invalid JSON output');
    }

    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      throw new Error(String((payload as Record<string, unknown>).error));
    }

    const validated = diarizationResultSchema.parse(payload);
    const durationMs = Date.now() - startTime;

    logger.info('Pyannote diarization completed successfully', {
      speakerCount: validated.speakerCount,
      segmentCount: validated.segments.length,
      durationMs
    });

    return {
      ...validated,
      durationMs
    };
  }
}

let activeService: SpeakerDiarizationService = new PyannoteDiarizationService();

export function getDiarizationService(): SpeakerDiarizationService {
  return activeService;
}

export function setDiarizationService(service: SpeakerDiarizationService) {
  activeService = service;
}
