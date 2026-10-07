'use client';import {CheckCircle2,LoaderCircle,Square,X} from 'lucide-react';import {Meeting} from '@/lib/types';
export function StatusBadge({status}:{status:Meeting['status']}){const names:Record<string,string>={uploaded:'Uploaded',queued:'Queued',transcribing:'Transcribing',transcribed:'Transcribed',analyzing:'Analyzing',review_required:'Review Required',processing:'Processing',completed:'Completed',complete:'Complete',failed:'Failed'};const isSpinning=['processing','queued','transcribing','analyzing'].includes(status);const isGreen=['completed','complete'].includes(status);const isAmber=['failed','review_required'].includes(status);const isBlue=['transcribing','analyzing','processing','queued'].includes(status);return <span className={`badge ${isGreen?'badge-green':isAmber?'badge-amber':isBlue?'badge-blue':''}`}>{isSpinning&&<LoaderCircle size={11} className="spin"/>}{names[status]||status}</span>}
export function Toast({message,onClose}:{message:string|null;onClose:()=>void}){if(!message)return null;return <div className="toast" onClick={onClose}>{message}</div>}
export function Modal({children,onClose,title}:{children:React.ReactNode;onClose:()=>void;title:string}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal"><div className="modal-head"><div className="section-title">{title}</div><button className="btn btn-sm" onClick={onClose}><X size={14}/></button></div>{children}</div></div>}
import { useState, useEffect } from 'react';

export function ProcessingView({
  meeting,
  onRetry,
  onStop,
  isStopping
}: {
  meeting: Meeting;
  onRetry: () => void;
  onStop?: () => void;
  isStopping?: boolean;
}) {
  const [selectedModelLabel, setSelectedModelLabel] = useState<string>('');

  useEffect(() => {
    fetch('/api/settings/model')
      .then(res => res.json())
      .then(data => {
        const found = data.models?.find((m: { id: string; label: string }) => m.id === data.model);
        if (found?.label) setSelectedModelLabel(found.label);
        else if (data.model) setSelectedModelLabel(data.model);
      })
      .catch(() => {});
  }, []);

  const diagnosticModel = meeting.diagnostic?.match(/with\s+([^.]+)/)?.[1];
  const activeModel = diagnosticModel || selectedModelLabel || 'Local LLM';

  const recordingSteps = [
    {
      id: 'transcription',
      title: 'Speech-to-text transcription',
      engine: 'Whisper (GPU)',
      detail: 'Converting meeting audio into text segments with timestamps.'
    },
    {
      id: 'diarization',
      title: 'Speaker voice diarization',
      engine: 'pyannote Community-1',
      detail: 'Separating voices to detect individual speaker turns (SPEAKER_00, SPEAKER_01).'
    },
    {
      id: 'alignment',
      title: 'Transcript & speaker alignment',
      engine: 'Alignment layer',
      detail: 'Combining Whisper speech timestamps with speaker turn boundaries.'
    },
    {
      id: 'detection',
      title: 'Candidate & action item detection',
      engine: activeModel,
      detail: 'Analyzing transcript segments to detect potential tasks, proposals, and decisions.'
    },
    {
      id: 'reconciliation',
      title: 'Intent reconciliation & deduplication',
      engine: activeModel,
      detail: 'Classifying true commitments, proposals, and merging repeated discussions.'
    },
    {
      id: 'drafting',
      title: 'Knowledge grounding & ticket drafting',
      engine: activeModel,
      detail: 'Matching project docs and drafting structured tickets with cited evidence.'
    },
    {
      id: 'complete',
      title: 'Complete & ready for review',
      engine: 'Ready',
      detail: 'Meeting processing finished. Task candidates ready for review.'
    }
  ];

  const notesSteps = [
    {
      id: 'notes',
      title: 'Meeting notes ingestion',
      engine: 'Text input',
      detail: 'Parsing and structuring meeting notes for task extraction.'
    },
    {
      id: 'detection',
      title: 'Candidate & action item detection',
      engine: activeModel,
      detail: 'Analyzing notes to detect potential tasks, proposals, and decisions.'
    },
    {
      id: 'reconciliation',
      title: 'Intent reconciliation & deduplication',
      engine: activeModel,
      detail: 'Classifying true commitments, proposals, and merging repeated discussions.'
    },
    {
      id: 'drafting',
      title: 'Knowledge grounding & ticket drafting',
      engine: activeModel,
      detail: 'Matching project docs and drafting structured tickets with cited evidence.'
    },
    {
      id: 'complete',
      title: 'Complete & ready for review',
      engine: 'Ready',
      detail: 'Meeting processing finished. Task candidates ready for review.'
    }
  ];

  const steps = meeting.inputType === 'notes' ? notesSteps : recordingSteps;

  function getStepIndex(): number {
    const s = (meeting.stage || '').toLowerCase();
    const st = meeting.status;

    if (st === 'complete' || st === 'completed' || st === 'review_required' || s.includes('complete')) {
      return steps.length - 1;
    }

    if (meeting.inputType === 'notes') {
      if (s.includes('draft') || s.includes('retriev') || s.includes('saving')) return 3;
      if (s.includes('resolv') || s.includes('merg') || s.includes('intent')) return 2;
      if (s.includes('detect') || s.includes('analyz') || s.includes('identif')) return 1;
      return 0;
    }

    // Recording pipeline
    if (s.includes('draft') || s.includes('retriev') || s.includes('saving')) return 5;
    if (s.includes('resolv') || s.includes('merg') || s.includes('intent')) return 4;
    if (s.includes('detect') || s.includes('analyz') || s.includes('identif') || st === 'analyzing') return 3;
    if (s.includes('align') || s.includes('transcript & speaker') || st === 'transcribed') return 2;
    if (s.includes('diariz') || s.includes('pyannote') || s.includes('speaker')) return 1;
    if (s.includes('transcrib') || st === 'transcribing') return 0;

    // Fallback based on progress percentage when stage string is unavailable
    if (meeting.progress >= 85) return 5;
    if (meeting.progress >= 70) return 4;
    if (meeting.progress >= 50) return 3;
    if (meeting.progress >= 40) return 2;
    if (meeting.progress >= 25) return 1;

    return 0;
  }

  const stageIndex = getStepIndex();
  const isProcessing = ['processing', 'queued', 'transcribing', 'transcribed', 'analyzing'].includes(meeting.status);
  const currentStep = steps[stageIndex] || steps[0];

  return (
    <div className="page">
      <div className="progress-wrap" style={{ maxWidth: 720 }}>
        <div className="eyebrow">MEETING PROCESSING PIPELINE</div>
        <h1 className="page-title">
          {meeting.status === 'failed'
            ? 'Processing stopped'
            : meeting.inputType === 'notes'
            ? 'Turning your notes into tickets'
            : 'Turning your recording into tickets'}
        </h1>
        <p className="subtle">
          {meeting.status === 'failed'
            ? 'Something interrupted this meeting. Review the error below and retry.'
            : `Processing “${meeting.title}” across local speech and AI models.`}
        </p>

        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          {/* Header Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>
                {meeting.status === 'failed' ? 'Current step (interrupted):' : 'Current stage:'}{' '}
                <span style={{ color: 'var(--primary)' }}>{currentStep.title}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Active engine: <strong>{currentStep.engine}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>{meeting.progress}%</span>
              {isProcessing && onStop && (
                <button
                  className="btn btn-sm"
                  onClick={onStop}
                  disabled={isStopping}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    color: 'var(--danger)',
                    borderColor: 'var(--danger-border)',
                    padding: '4px 9px',
                    fontSize: 11,
                    background: 'var(--danger-bg)'
                  }}
                >
                  {isStopping ? <LoaderCircle size={11} className="spin" /> : <Square size={10} fill="var(--danger)" />}
                  {isStopping ? 'Stopping...' : 'Stop'}
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="progress-track" style={{ margin: '16px 0 24px' }}>
            <div className="progress-fill" style={{ width: `${meeting.progress}%` }} />
          </div>

          {/* Detailed Stage Rows */}
          <div className="stage-list" style={{ gap: 16 }}>
            {steps.map((step, idx) => {
              const isDone = idx < stageIndex || meeting.status === 'complete' || meeting.status === 'completed';
              const isActive = idx === stageIndex && meeting.status !== 'complete' && meeting.status !== 'completed';
              const isFailed = isActive && meeting.status === 'failed';

              return (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '8px 10px',
                    borderRadius: 7,
                    background: isActive ? 'var(--active-bg)' : 'transparent',
                    border: isActive ? '1px solid var(--active-border)' : '1px solid transparent',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {/* Step Icon */}
                  <span style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', marginTop: 1, flexShrink: 0 }}>
                    {isDone ? (
                      <CheckCircle2 size={17} color="var(--primary)" />
                    ) : isFailed ? (
                      <X size={17} color="var(--danger)" />
                    ) : isActive && isProcessing ? (
                      <LoaderCircle size={17} className="spin" color="var(--primary)" />
                    ) : (
                      <span
                        style={{
                          border: '1.5px solid var(--border-light)',
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          display: 'inline-block'
                        }}
                      />
                    )}
                  </span>

                  {/* Step Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isActive ? 650 : isDone ? 550 : 400,
                          color: isFailed ? 'var(--danger)' : isActive ? 'var(--primary)' : isDone ? 'var(--text)' : 'var(--muted)'
                        }}
                      >
                        {step.title}
                      </span>

                      {step.engine && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: isActive ? 'var(--primary-subtle)' : isDone ? 'var(--surface-subtle)' : 'var(--bg-elevated)',
                            color: isActive ? 'var(--primary)' : isDone ? 'var(--text-secondary)' : 'var(--muted)',
                            fontWeight: 600,
                            border: isActive ? '1px solid var(--active-border)' : '1px solid var(--border)'
                          }}
                        >
                          {step.engine}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 11, color: isActive ? 'var(--text-secondary)' : 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                      {isActive && meeting.diagnostic ? meeting.diagnostic : step.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity / Diagnostic Box */}
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 22,
              padding: '13px 15px',
              borderRadius: 7,
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              lineHeight: 1.6
            }}
          >
            <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4, color: 'var(--eyebrow)' }}>
              CURRENT ACTIVITY · {currentStep.engine.toUpperCase()}
            </div>
            {meeting.status === 'failed'
              ? 'Review the error message below, then click Retry to resume processing.'
              : currentStep.detail}
            {meeting.diagnostic && isProcessing && (
              <div style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, fontWeight: 500 }}>
                Live update: {meeting.diagnostic}
              </div>
            )}
          </div>

          {meeting.error && (
            <div className="error-box" style={{ marginTop: 16 }}>
              {(() => {
                const trimmed = (meeting.error || '').trim();
                if (trimmed.startsWith('[')) {
                  try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed) && parsed[0]?.message) {
                      return `Model output format error: ${parsed[0].message} (field: ${parsed[0].path?.join('.') || 'root'}). Click Retry to re-process with automatic normalization.`;
                    }
                  } catch {
                    // ignore
                  }
                }
                return meeting.error;
              })()}
            </div>
          )}

          {meeting.status === 'failed' && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
              Retry processing
            </button>
          )}
        </div>

        <p className="muted" style={{ marginTop: 16, textAlign: 'center', fontSize: 11 }}>
          You can safely leave this page. All transcription, speaker diarization, and task extraction stages are saved with the meeting.
        </p>
      </div>
    </div>
  );
}
