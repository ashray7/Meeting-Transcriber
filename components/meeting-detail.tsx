'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  FileText,
  Plus,
  Sparkles,
  Ticket as TicketIcon,
  Trash2,
  Undo2,
  Users,
  XCircle
} from 'lucide-react';
import { Meeting, Priority, Task, TaskCandidate, TaskReviewStatus, Ticket } from '@/lib/types';
import { Modal, ProcessingView, StatusBadge, Toast } from './ui';

type Payload = {
  meeting: Meeting;
  tasks: Task[];
  candidates: TaskCandidate[];
  tickets?: Ticket[];
};

type CandidatePayload = {
  kind?: string;
  summary?: string;
  evidence?: Array<{
    segmentId?: string;
    speaker?: string | null;
    startMs?: number | null;
    sourceText?: string;
  }>;
  task?: Task;
  reviewReasons?: string[];
};

function payloadOf(candidate: TaskCandidate) {
  return candidate.payload as CandidatePayload;
}

function timeLabel(ms: number | null | undefined) {
  if (ms == null) return '';
  const sec = Math.floor(ms / 1000);
  return `[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}]`;
}

const blankForm = {
  title: '',
  description: '',
  type: 'feature' as string,
  surface: '',
  area: '',
  component: '',
  projectReferences: [] as string[],
  referenceVersionIds: [] as string[],
  priority: 'medium' as Priority,
  assignee: '',
  deadline: '',
  context: '',
  sourceTimestamp: null as string | null,
  acceptanceCriteria: [''],
  sourceQuote: '',
  confidence: null as number | null,
  status: 'detected' as TaskReviewStatus
};

export function MeetingDetail({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>({ ...initial, tickets: initial.tickets || [] });
  const [editing, setEditing] = useState<Task | null | false>(false);
  const [form, setForm] = useState(blankForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'needs_review' | 'approved' | 'rejected' | 'created'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [creatingTicketId, setCreatingTicketId] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<Array<{
    speakerId: string;
    memberId: string | null;
    memberName: string | null;
    segmentCount: number;
    totalDurationMs: number;
  }>>([]);
  const [mappingSpeakerId, setMappingSpeakerId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const router = useRouter();

  const fetchSpeakers = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${data.meeting.id}/speakers`);
      if (res.ok) {
        const json = await res.json();
        setSpeakers(json.speakers || []);
      }
    } catch {
      // ignore
    }
  }, [data.meeting.id]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/meetings/${data.meeting.id}`, { cache: 'no-store' });
    if (r.ok) {
      const refreshed = await r.json();
      setData({ ...refreshed, tickets: refreshed.tickets || [] });
      await fetchSpeakers();
    }
  }, [data.meeting.id, fetchSpeakers]);

  useEffect(() => {
    fetchSpeakers();
  }, [fetchSpeakers, data.meeting.status, data.meeting.updatedAt]);

  async function handleMapSpeaker(speakerId: string, memberId: string | null) {
    setMappingSpeakerId(speakerId);
    try {
      const res = await fetch(`/api/meetings/${data.meeting.id}/speakers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speakerId, memberId })
      });
      if (res.ok) {
        setToast(memberId ? `Mapped ${speakerId}` : `Cleared mapping for ${speakerId}`);
        await refresh();
      } else {
        const err = await res.json();
        setToast(`Error: ${err.error || 'Failed to update mapping'}`);
      }
    } catch {
      setToast('Network error updating speaker mapping');
    } finally {
      setMappingSpeakerId(null);
    }
  }

  useEffect(() => {
    if (!['processing', 'queued', 'transcribing', 'transcribed', 'analyzing'].includes(data.meeting.status)) return;
    const timer = setInterval(refresh, 1200);
    return () => clearInterval(timer);
  }, [data.meeting.status, refresh]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  async function retry() {
    await fetch(`/api/meetings/${data.meeting.id}/process`, { method: 'POST' });
    await refresh();
  }

  async function handleStop() {
    setStopping(true);
    try {
      const res = await fetch(`/api/meetings/${data.meeting.id}/stop`, { method: 'POST' });
      if (res.ok) {
        setToast('Processing stopped');
      } else {
        const err = await res.json().catch(() => ({}));
        setToast(err.error || 'Failed to stop processing');
      }
      await refresh();
    } catch {
      setToast('Network error stopping processing');
    } finally {
      setStopping(false);
    }
  }

  function jumpToSegment(segmentId?: string) {
    if (!segmentId) return;
    setTranscriptOpen(true);
    setHighlightedSegmentId(segmentId);
    setTimeout(() => {
      const el = document.getElementById(`segment-${segmentId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  function startEdit(task?: Task) {
    setFormError(null);
    setEditing(task || null);
    setForm(
      task
        ? {
            title: task.title,
            description: task.description,
            type: task.type || '',
            surface: task.surface || '',
            area: task.area || '',
            component: task.component || '',
            projectReferences: [...task.projectReferences],
            referenceVersionIds: [...task.referenceVersionIds],
            priority: task.priority || 'medium',
            assignee: task.assignee || '',
            deadline: task.deadline || '',
            context: task.context || '',
            sourceTimestamp: task.sourceTimestamp || null,
            acceptanceCriteria: task.acceptanceCriteria.length ? [...task.acceptanceCriteria] : [''],
            sourceQuote: task.sourceQuote || '',
            confidence: task.confidence,
            status: task.status
          }
        : blankForm
    );
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const endpoint = editing ? `/api/tasks/${editing.id}` : `/api/meetings/${data.meeting.id}/tasks`;
    const method = editing ? 'PATCH' : 'POST';

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        surface: form.surface || null,
        area: form.area || null,
        component: form.component || null,
        projectReferences: form.projectReferences,
        assignee: form.assignee || null,
        deadline: form.deadline || null,
        acceptanceCriteria: form.acceptanceCriteria.filter(x => x.trim())
      })
    });

    setBusy(false);
    if (!res.ok) {
      const err = await res.json();
      setFormError(err.error || 'Could not save task candidate. Verify project configuration.');
      return;
    }

    setEditing(false);
    await refresh();
    setToast(editing ? 'Task candidate updated' : 'Task candidate created');
  }

  async function approveTask(task: Task) {
    setBusy(true);
    const newStatus = task.status === 'approved' ? 'review_required' : 'approved';
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    setBusy(false);
    if (res.ok) {
      await refresh();
      setToast(newStatus === 'approved' ? 'Task candidate approved' : 'Approval undone');
    } else {
      setToast('Could not update task approval status.');
    }
  }

  function openRejectModal(task: Task) {
    setRejectingTask(task);
    setRejectionReason(task.rejectionReason || '');
  }

  async function confirmRejection(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectingTask) return;
    setBusy(true);
    const res = await fetch(`/api/tasks/${rejectingTask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        rejectionReason: rejectionReason.trim() || 'Rejected during review.'
      })
    });
    setBusy(false);
    if (res.ok) {
      setRejectingTask(null);
      await refresh();
      setToast('Task candidate marked as rejected');
    } else {
      setToast('Could not reject task.');
    }
  }

  async function restoreTask(task: Task) {
    setBusy(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'review_required',
        rejectionReason: null
      })
    });
    setBusy(false);
    if (res.ok) {
      await refresh();
      setToast('Task restored to review');
    } else {
      setToast('Could not restore task.');
    }
  }

  async function createTicket(task: Task) {
    setCreatingTicketId(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}/create-ticket`, {
        method: 'POST'
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Ticket creation failed.');
      }
      await refresh();
      setToast(
        result.alreadyExisted
          ? `Found existing ticket (${result.ticket.externalKey || result.ticket.id.slice(0, 8)})`
          : `Created ticket ${result.ticket.externalKey || result.ticket.id.slice(0, 8)}`
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Failed to create ticket.');
    } finally {
      setCreatingTicketId(null);
    }
  }

  async function handleBulkApprove() {
    setBulkApproving(true);
    try {
      const res = await fetch(`/api/meetings/${data.meeting.id}/bulk-approve`, {
        method: 'POST'
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Bulk approval failed.');
      }
      await refresh();
      setToast(result.message);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Bulk approval failed.');
    } finally {
      setBulkApproving(false);
    }
  }

  async function deleteTask(task: Task) {
    if (!confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    await refresh();
    setToast('Task deleted');
  }

  if (['processing', 'queued', 'transcribing', 'transcribed', 'analyzing', 'failed'].includes(data.meeting.status)) {
    return (
      <>
        <ProcessingView meeting={data.meeting} onRetry={retry} onStop={handleStop} isStopping={stopping} />
        <Toast message={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  const { meeting, tasks, tickets = [] } = data;
  const candidates = data.candidates || [];
  const availableTypes = meeting.projectSnapshot?.taskTypes.map(x => x.name) || [
    'feature',
    'bug',
    'improvement',
    'technical-task',
    'research'
  ];

  // Eligible tasks for safe bulk approval:
  const eligibleBulkCount = tasks.filter(
    t =>
      (t.status === 'detected' || t.status === 'review_required' || (t.status as string) === 'draft') &&
      (t.confidence ?? 0) >= 0.75 &&
      !t.classificationNeedsReview &&
      !t.assignmentNeedsReview
  ).length;

  // Filter tasks based on activeFilter:
  const filteredTasks = tasks.filter(task => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'needs_review')
      return task.status === 'review_required' || task.status === 'detected' || (task.status as string) === 'draft';
    if (activeFilter === 'approved') return task.status === 'approved';
    if (activeFilter === 'rejected') return task.status === 'rejected';
    if (activeFilter === 'created') return task.status === 'created';
    return true;
  });

  const countNeedsReview = tasks.filter(
    t => t.status === 'review_required' || t.status === 'detected' || (t.status as string) === 'draft'
  ).length;
  const countApproved = tasks.filter(t => t.status === 'approved').length;
  const countRejected = tasks.filter(t => t.status === 'rejected').length;
  const countCreated = tasks.filter(t => t.status === 'created').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {meeting.meetingType.toUpperCase()} ·{' '}
            {new Date(meeting.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
          <h1 className="page-title">{meeting.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
            <StatusBadge status={meeting.status} />
            <span className="muted">
              {tasks.length} {tasks.length === 1 ? 'task candidate' : 'task candidates'}
            </span>
            {tickets.length > 0 && (
              <span className="badge badge-green">
                <TicketIcon size={11} style={{ marginRight: 4 }} />
                {tickets.length} created {tickets.length === 1 ? 'ticket' : 'tickets'}
              </span>
            )}
          </div>
        </div>
        <button className="btn" onClick={() => router.push('/meetings')}>
          All meetings
        </button>
      </div>

      <div className="result-grid">
        <div className="result-main">
          {/* Meeting Summary */}
          <div className="card summary-card">
            <div className="section-title">Meeting summary</div>
            <div className="summary-text">{meeting.summary || 'No summary available.'}</div>
            <div className="divider" />
            <div className="section-title" style={{ fontSize: 12 }}>
              Topics
            </div>
            <div className="chips">
              {meeting.topics.map(x => (
                <span className="chip" key={x}>
                  {x}
                </span>
              ))}
            </div>
          </div>

          {/* Project Profile Snapshot Info */}
          {meeting.projectSnapshot && (
            <div className="card summary-card">
              <div className="section-title">Project profile · {meeting.projectSnapshot.name}</div>
              <div className="subtle" style={{ fontSize: 11, marginTop: 8 }}>
                {meeting.projectSnapshot.description || 'Project context used for this analysis.'}
              </div>
              <div className="chips">
                {meeting.projectSnapshot.surfaces.map(x => (
                  <span className="chip" key={x.id}>
                    Surface: {x.name}
                  </span>
                ))}
                {meeting.projectSnapshot.workAreas.map(x => (
                  <span className="chip" key={x.id}>
                    Area: {x.name}
                  </span>
                ))}
                {meeting.projectSnapshot.documents.map(d => (
                  <span className="chip" key={d.id} title={d.filename}>
                    Doc: {d.filename}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Decisions */}
          <div className="card summary-card">
            <div className="section-title">Decisions</div>
            {meeting.decisions.length ? (
              meeting.decisions.map((d, i) => (
                <div className="decision" key={i}>
                  <span className="decision-dot" />
                  {d}
                </div>
              ))
            ) : (
              <p className="subtle">No clear decisions were identified.</p>
            )}
          </div>

          {/* Open Questions */}
          {meeting.openQuestions?.length ? (
            <div className="card summary-card">
              <div className="section-title">Open questions</div>
              {meeting.openQuestions.map((question, index) => (
                <div className="decision" key={index}>
                  <span className="decision-dot" />
                  {question}
                </div>
              ))}
            </div>
          ) : null}

          {/* Categorized Candidate Items (Proposed, Deferred, Rejected, Cancelled) */}
          {(['proposed', 'deferred', 'rejected', 'cancelled'] as const).map(intent => {
            const group = candidates.filter(candidate => candidate.intent === intent);
            return group.length ? (
              <div className="card summary-card candidate-section" key={intent}>
                <div className="section-title">
                  {intent === 'cancelled'
                    ? 'Rejected / cancelled items'
                    : `${intent[0].toUpperCase() + intent.slice(1)} items`}{' '}
                  <span className="muted">({group.length})</span>
                </div>
                {group.map(candidate => {
                  const payload = payloadOf(candidate);
                  const isInTasks = tasks.some(t => t.title.toLowerCase() === (payload.summary || '').toLowerCase() || t.context?.toLowerCase() === (payload.summary || '').toLowerCase());
                  return (
                    <article className="candidate-card" key={candidate.id} style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div className="task-title">{payload.summary || 'Unspecified candidate'}</div>
                        {isInTasks ? (
                          <span className="badge badge-green" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>In review queue</span>
                        ) : payload.task ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              const res = await fetch(`/api/meetings/${data.meeting.id}/tasks`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload.task)
                              });
                              setBusy(false);
                              if (res.ok) {
                                await refresh();
                                setToast('Added to ticket review queue');
                              }
                            }}
                          >
                            <Plus size={12} /> Add to review
                          </button>
                        ) : null}
                      </div>
                      <div className="task-meta">
                        <span className="badge">{payload.kind?.replace('_', ' ') || 'candidate'}</span>
                        <span className="badge">{candidate.intent}</span>
                      </div>
                      {payload.evidence?.map((item, idx) => (
                        <div className="candidate-evidence" key={idx} style={{ marginTop: 6, fontSize: 11 }}>
                          {item.startMs !== null && item.startMs !== undefined && (
                            <button
                              type="button"
                              className="evidence-pill"
                              style={{ marginRight: 6 }}
                              onClick={() => jumpToSegment(item.segmentId)}
                              title="Click to view transcript timestamp"
                            >
                              <Clock size={10} />
                              {timeLabel(item.startMs)}
                            </button>
                          )}
                          {item.speaker && <strong>{item.speaker}: </strong>}
                          {item.sourceText}
                        </div>
                      ))}
                    </article>
                  );
                })}
              </div>
            ) : null;
          })}

          {/* TASK REVIEW & HUMAN APPROVAL WORKFLOW SECTION */}
          <div className="section-head" style={{ marginTop: 32 }}>
            <div>
              <div className="section-title" style={{ fontSize: 16 }}>
                Human Review &amp; Ticket Creation
              </div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>
                AI-detected tasks require human review before creating official tickets.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {eligibleBulkCount > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleBulkApprove}
                  disabled={bulkApproving}
                  title="Approve committed tasks with high confidence (>=75%) and no pending review flags"
                >
                  <Sparkles size={13} color="#176b50" />
                  {bulkApproving ? 'Approving…' : `Bulk Approve High-Confidence (${eligibleBulkCount})`}
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => startEdit()}>
                <Plus size={13} /> Add task candidate
              </button>
            </div>
          </div>

          {/* Review Filter Tabs */}
          <div className="filter-tabs" role="tablist">
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All candidates ({tasks.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'needs_review' ? 'active' : ''}`}
              onClick={() => setActiveFilter('needs_review')}
            >
              Needs review ({countNeedsReview})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveFilter('approved')}
            >
              Approved ({countApproved})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'created' ? 'active' : ''}`}
              onClick={() => setActiveFilter('created')}
            >
              Tickets created ({countCreated})
            </button>
            <button
              type="button"
              className={`filter-tab ${activeFilter === 'rejected' ? 'active' : ''}`}
              onClick={() => setActiveFilter('rejected')}
            >
              Rejected ({countRejected})
            </button>
          </div>

          {/* Task Candidate Cards */}
          {filteredTasks.map(task => {
            const isApproved = task.status === 'approved';
            const isRejected = task.status === 'rejected';
            const isCreated = task.status === 'created';
            const needsReview =
              task.status === 'review_required' ||
              task.classificationNeedsReview ||
              task.assignmentNeedsReview ||
              (task.confidence != null && task.confidence < 0.75);

            const confidencePercent = task.confidence != null ? Math.round(task.confidence * 100) : null;
            const confidenceTier =
              task.confidence == null
                ? 'Unrated'
                : task.confidence >= 0.8
                ? 'High confidence'
                : task.confidence >= 0.65
                ? 'Medium confidence'
                : 'Low confidence';

            return (
              <article
                className="card task-card"
                key={task.id}
                style={{
                  borderLeft: isCreated
                    ? '4px solid #176b50'
                    : isApproved
                    ? '4px solid #2e7d32'
                    : isRejected
                    ? '4px solid #c62828'
                    : needsReview
                    ? '4px solid #ef6c00'
                    : '4px solid #b0bec5',
                  opacity: isRejected ? 0.75 : 1
                }}
              >
                <div className="task-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="task-title" style={{ margin: 0 }}>
                        {task.title}
                      </span>
                      {/* State Badge */}
                      <span
                        className={`badge ${
                          isCreated
                            ? 'badge-blue'
                            : isApproved
                            ? 'badge-green'
                            : isRejected
                            ? 'badge-red'
                            : needsReview
                            ? 'badge-amber'
                            : 'badge-gray'
                        }`}
                      >
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="task-meta" style={{ marginTop: 8 }}>
                      <span className="badge badge-gray">{(task.type || 'Unclassified').replace('-', ' ')}</span>
                      {task.surface && <span className="badge">{task.surface}</span>}
                      {task.component && <span className="badge">Component: {task.component}</span>}
                      {task.area && <span className="badge">Area: {task.area}</span>}
                      <span
                        className={`badge ${
                          task.priority === 'high' || task.priority === 'critical' ? 'badge-amber' : ''
                        }`}
                      >
                        Priority: {task.priority || 'Review'}
                      </span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        Assignee: <strong>{task.assigneeName || 'Unassigned'}</strong>
                      </span>
                      {task.deadline && <span className="badge">Due: {task.deadline}</span>}
                      {confidencePercent !== null && (
                        <span
                          className={`badge ${
                            confidencePercent >= 80 ? 'badge-green' : confidencePercent >= 65 ? 'badge-amber' : 'badge-red'
                          }`}
                          title={`AI confidence score: ${confidencePercent}%`}
                        >
                          {confidencePercent}% · {confidenceTier}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="task-actions">
                    <button className="btn btn-sm" title="Edit candidate" onClick={() => startEdit(task)}>
                      <Edit3 size={13} /> Edit
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      title="Delete candidate"
                      onClick={() => deleteTask(task)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <p className="task-desc">{task.description}</p>

                {/* Review Flags & Warnings */}
                {needsReview && (
                  <div
                    style={{
                      background: '#2b220e',
                      border: '1px solid #574316',
                      borderRadius: 6,
                      padding: '8px 12px',
                      marginTop: 8,
                      fontSize: 11,
                      color: '#fde68a'
                    }}
                  >
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlertCircle size={13} color="#fbbf24" /> Review signals
                    </div>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {task.classificationReviewReasons?.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                      {task.assignmentNeedsReview && task.assignmentReason && (
                        <li>{task.assignmentReason}</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Rejection Reason display if rejected */}
                {isRejected && task.rejectionReason && (
                  <div
                    style={{
                      background: '#2d1414',
                      border: '1px solid #5c2222',
                      borderRadius: 6,
                      padding: '8px 12px',
                      marginTop: 8,
                      fontSize: 11,
                      color: '#fca5a5'
                    }}
                  >
                    <strong>Rejection reason:</strong> {task.rejectionReason}
                  </div>
                )}

                {/* Grounding & Evidence Section */}
                <div style={{ marginTop: 12 }}>
                  {/* Meeting Evidence with clickable timestamps */}
                  {task.evidence && task.evidence.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>
                        MEETING EVIDENCE
                      </div>
                      {task.evidence.map((ev, i) => (
                        <div
                          key={i}
                          className="subtle"
                          style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          {ev.startMs !== null && (
                            <button
                              type="button"
                              className="evidence-pill"
                              onClick={() => jumpToSegment(ev.segmentId)}
                              title="Click to jump to transcript segment"
                            >
                              <Clock size={11} />
                              {timeLabel(ev.startMs)}
                            </button>
                          )}
                          <span>
                            {ev.speaker ? <strong>{ev.speaker}: </strong> : ''}
                            “{ev.quote}”
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Project Document References (PDF page / CSV row) */}
                  {task.projectReferenceEvidence && task.projectReferenceEvidence.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>
                        PROJECT REFERENCES
                      </div>
                      {task.projectReferenceEvidence.map((ref, i) => (
                        <div
                          key={i}
                          className="subtle"
                          style={{
                            fontSize: 11,
                            marginTop: 4,
                            padding: '6px 8px',
                            background: 'var(--surface-subtle)',
                            border: '1px solid var(--border)',
                            borderRadius: 6
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <FileText size={12} color="#c084fc" />
                            <strong style={{ color: 'var(--text)' }}>{ref.filename}</strong>
                            {ref.pageNumber && <span className="ref-pill">Page {ref.pageNumber}</span>}
                            {ref.rowNumber && <span className="ref-pill">Row {ref.rowNumber}</span>}
                          </div>
                          <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>“{ref.excerpt}”</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Acceptance Criteria */}
                {task.acceptanceCriteria.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="eyebrow" style={{ fontSize: 9 }}>
                      ACCEPTANCE CRITERIA
                    </div>
                    <ul className="criteria">
                      {task.acceptanceCriteria.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Toolbar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 16,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border)'
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {isCreated ? (
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                        <TicketIcon size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
                        Ticket created
                      </span>
                    ) : isRejected ? (
                      <span>Rejected candidate</span>
                    ) : isApproved ? (
                      <span style={{ color: '#4ade80', fontWeight: 600 }}>Approved · Ready to create ticket</span>
                    ) : (
                      <span>Pending human review</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Reject / Restore Button */}
                    {isRejected ? (
                      <button className="btn btn-sm" onClick={() => restoreTask(task)} disabled={busy}>
                        <Undo2 size={13} /> Reopen for review
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => openRejectModal(task)}
                        disabled={busy || isCreated}
                      >
                        <XCircle size={13} /> Reject
                      </button>
                    )}

                    {/* Approve / Undo Approval Button */}
                    {!isRejected && !isCreated && (
                      <button
                        className={`btn btn-sm ${isApproved ? '' : 'btn-primary'}`}
                        onClick={() => approveTask(task)}
                        disabled={busy}
                      >
                        {isApproved ? (
                          <>
                            <Check size={13} /> Approved · Undo
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={13} /> Approve
                          </>
                        )}
                      </button>
                    )}

                    {/* Create Ticket Button */}
                    {!isRejected && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => createTicket(task)}
                        disabled={busy || creatingTicketId === task.id}
                        title={
                          isCreated
                            ? 'Ticket already created (click to view)'
                            : isApproved
                            ? 'Create official ticket from this approved candidate'
                            : 'Approve and create official ticket'
                        }
                      >
                        <TicketIcon size={13} />
                        {creatingTicketId === task.id
                          ? 'Creating…'
                          : isCreated
                          ? 'View Ticket'
                          : 'Create Ticket'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!filteredTasks.length && (
            <div className="card empty">
              {tasks.length === 0
                ? 'No task candidates found for this meeting. Click "+ Add task candidate" above to create one.'
                : `No task candidates found with status "${activeFilter.replace('_', ' ')}".`}
            </div>
          )}

          {/* CREATED TICKETS SECTION */}
          {tickets.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div className="section-head">
                <div>
                  <div className="section-title" style={{ fontSize: 16 }}>
                    Official Created Tickets <span className="muted">({tickets.length})</span>
                  </div>
                  <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>
                    Internal workspace tickets generated from approved candidates. Preserves full evidence grounding.
                  </div>
                </div>
              </div>

              {tickets.map(ticket => (
                <article className="card ticket-card" key={ticket.id}>
                  <div className="task-top">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="ticket-key">{ticket.externalKey || ticket.id.slice(0, 8)}</span>
                        <h3 className="task-title" style={{ margin: 0 }}>
                          {ticket.title}
                        </h3>
                        <span className="badge badge-green">{ticket.status}</span>
                      </div>
                      <div className="task-meta" style={{ marginTop: 8 }}>
                        {ticket.taskType && <span className="badge badge-gray">{ticket.taskType}</span>}
                        {ticket.productSurface && <span className="badge">{ticket.productSurface}</span>}
                        {ticket.component && <span className="badge">Component: {ticket.component}</span>}
                        {ticket.workArea && <span className="badge">Area: {ticket.workArea}</span>}
                        {ticket.priority && (
                          <span
                            className={`badge ${
                              ticket.priority === 'high' || ticket.priority === 'critical' ? 'badge-amber' : ''
                            }`}
                          >
                            Priority: {ticket.priority}
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: 11 }}>
                          Assignee: <strong>{ticket.assigneeName || 'Unassigned'}</strong>
                        </span>
                        {ticket.deadline && <span className="badge">Due: {ticket.deadline}</span>}
                        <span className="muted" style={{ fontSize: 10 }}>
                          Created: {new Date(ticket.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="task-desc" style={{ marginTop: 10 }}>
                    {ticket.description}
                  </p>

                  {ticket.context && (
                    <div className="subtle" style={{ fontSize: 11, marginTop: 6 }}>
                      <strong>Context:</strong> {ticket.context}
                    </div>
                  )}

                  {ticket.expectedOutcome && (
                    <div className="subtle" style={{ fontSize: 11, marginTop: 6 }}>
                      <strong>Expected outcome:</strong> {ticket.expectedOutcome}
                    </div>
                  )}

                  {ticket.acceptanceCriteria.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>
                        ACCEPTANCE CRITERIA
                      </div>
                      <ul className="criteria">
                        {ticket.acceptanceCriteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ticket.sourceEvidence.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>
                        SOURCE MEETING EVIDENCE
                      </div>
                      {ticket.sourceEvidence.map((ev, i) => (
                        <div
                          key={i}
                          className="subtle"
                          style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          {ev.startMs !== null && (
                            <button
                              type="button"
                              className="evidence-pill"
                              onClick={() => jumpToSegment(ev.segmentId)}
                              title="Click to view in transcript"
                            >
                              <Clock size={11} />
                              {timeLabel(ev.startMs)}
                            </button>
                          )}
                          <span>
                            {ev.speaker ? <strong>{ev.speaker}: </strong> : ''}
                            “{ev.quote}”
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {ticket.projectReferences.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>
                        PROJECT REFERENCES
                      </div>
                      {ticket.projectReferences.map((ref, i) => (
                        <div
                          key={i}
                          className="subtle"
                          style={{
                            fontSize: 11,
                            marginTop: 4,
                            padding: '6px 8px',
                            background: '#fcfaf7',
                            border: '1px solid #eee5d8',
                            borderRadius: 6
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <FileText size={12} color="#5a3286" />
                            <strong>{ref.filename}</strong>
                            {ref.pageNumber && <span className="ref-pill">Page {ref.pageNumber}</span>}
                            {ref.rowNumber && <span className="ref-pill">Row {ref.rowNumber}</span>}
                          </div>
                          <div style={{ fontStyle: 'italic' }}>“{ref.excerpt}”</div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {/* Interactive Transcript Accordion with Segment Highlighting */}
          <div className="card" style={{ marginTop: 24, overflow: 'hidden' }}>
            <button
              onClick={() => setTranscriptOpen(!transcriptOpen)}
              style={{
                border: 0,
                background: 'transparent',
                color: 'inherit',
                width: '100%',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                textAlign: 'left'
              }}
            >
              <span>
                <span className="section-title">
                  {meeting.inputType === 'notes' ? 'Meeting notes' : 'Transcript & Evidence Segments'}
                </span>
                <span className="muted" style={{ marginLeft: 9 }}>
                  {meeting.inputType === 'notes'
                    ? 'Notes provided for analysis'
                    : `${meeting.transcriptSegments?.length || 0} timestamped segments`}
                </span>
              </span>
              {transcriptOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {transcriptOpen && (
              <>
                <div className="divider" style={{ margin: 0 }} />
                <div className="transcript">
                  {meeting.transcriptSegments?.length ? (
                    meeting.transcriptSegments.map(segment => {
                      const isMapped =
                        speakers.some(s => s.speakerId === (segment.speakerId || segment.speaker) && s.memberId) ||
                        Boolean(segment.speaker && !/^SPEAKER_\d+$/i.test(segment.speaker));
                      return (
                        <div
                          id={`segment-${segment.id}`}
                          key={segment.id}
                          className={`transcript-segment ${
                            highlightedSegmentId === segment.id ? 'highlighted' : ''
                          }`}
                        >
                          {segment.startMs !== null && (
                            <span
                              className="evidence-pill"
                              style={{ marginRight: 8 }}
                              title="Transcript segment timestamp"
                            >
                              <Clock size={10} />
                              {timeLabel(segment.startMs)}
                            </span>
                          )}
                          {segment.speaker && (
                            <span style={{ marginRight: 6 }}>
                              <strong
                                style={{
                                  fontFamily: isMapped ? 'inherit' : 'monospace',
                                  color: isMapped ? '#176b50' : '#4a5568',
                                  fontSize: isMapped ? '13px' : '12px',
                                  fontWeight: 600
                                }}
                              >
                                {segment.speaker}:
                              </strong>
                              {isMapped && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    background: '#e8f5e9',
                                    color: '#2e7d32',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    marginLeft: '4px',
                                    verticalAlign: 'middle',
                                    fontWeight: 600
                                  }}
                                  title="Manually mapped by user"
                                >
                                  user-mapped
                                </span>
                              )}
                            </span>
                          )}
                          <span>{segment.text}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div>
                      {meeting.transcript ||
                        (meeting.inputType === 'notes' ? 'Meeting notes unavailable.' : 'Transcript unavailable.')}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sidebar Summary & Metrics */}
        <aside>
          <div className="card summary-card">
            <div className="section-title">{meeting.inputType === 'notes' ? 'Meeting source' : 'Meeting file'}</div>
            <div className="file-meta" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 12 }}>
              {meeting.inputType === 'notes' ? (
                'Pasted meeting notes'
              ) : (
                <>
                  {meeting.originalFileName}
                  <br />
                  {(meeting.fileSize / 1024 / 1024).toFixed(1)} MB
                </>
              )}{' '}
              · {meeting.meetingType}
              {meeting.projectSnapshot && (
                <>
                  <br />
                  Project: <strong>{meeting.projectSnapshot.name}</strong>
                </>
              )}
            </div>
            <div className="divider" />
            <div className="kpi-top">
              <span>Task candidates</span>
              <strong style={{ color: '#26332b' }}>{tasks.length}</strong>
            </div>
            <div className="kpi-top" style={{ marginTop: 10 }}>
              <span>Needs review</span>
              <strong style={{ color: '#ef6c00' }}>{countNeedsReview}</strong>
            </div>
            <div className="kpi-top" style={{ marginTop: 10 }}>
              <span>Approved candidates</span>
              <strong style={{ color: '#2e7d32' }}>{countApproved}</strong>
            </div>
            <div className="kpi-top" style={{ marginTop: 10 }}>
              <span>Official tickets created</span>
              <strong style={{ color: '#176b50' }}>{tickets.length}</strong>
            </div>
            <div className="kpi-top" style={{ marginTop: 10 }}>
              <span>Rejected</span>
              <strong style={{ color: '#c62828' }}>{countRejected}</strong>
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} color="#176b50" />
                <span>Detected Speakers</span>
              </div>
              {meeting.diarizationStatus && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background:
                      meeting.diarizationStatus === 'completed'
                        ? '#e8f5e9'
                        : meeting.diarizationStatus === 'failed'
                        ? '#ffebee'
                        : '#f5f5f5',
                    color:
                      meeting.diarizationStatus === 'completed'
                        ? '#2e7d32'
                        : meeting.diarizationStatus === 'failed'
                        ? '#c62828'
                        : '#757575'
                  }}
                >
                  {meeting.diarizationStatus}
                </span>
              )}
            </div>

            {speakers.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {meeting.diarizationStatus === 'unavailable'
                  ? 'Speaker diarization was unavailable (pyannote.audio Community-1 not configured or audio unindexed).'
                  : meeting.diarizationStatus === 'failed'
                  ? `Diarization error: ${meeting.diarizationError || 'Processing failed'}`
                  : 'No speakers detected.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="muted" style={{ fontSize: 11 }}>
                  Map anonymous speaker turns to project members manually:
                </div>
                {speakers.map(s => {
                  const durationSec = Math.round(s.totalDurationMs / 1000);
                  const isMapped = !!s.memberId;
                  return (
                    <div
                      key={s.speakerId}
                      style={{
                        padding: '8px 10px',
                        background: isMapped ? '#f2f8f4' : '#fafafa',
                        border: `1px solid ${isMapped ? '#c3e2d1' : '#eee'}`,
                        borderRadius: 6,
                        fontSize: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#26332b' }}>
                            {s.speakerId}
                          </span>
                          {isMapped && (
                            <span
                              style={{
                                fontSize: 9,
                                background: '#e8f5e9',
                                color: '#2e7d32',
                                padding: '1px 5px',
                                borderRadius: 3,
                                fontWeight: 600
                              }}
                            >
                              mapped
                            </span>
                          )}
                        </div>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {s.segmentCount} turns · {durationSec}s
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                          className="select"
                          style={{ fontSize: 11, padding: '4px 6px', height: 'auto', flex: 1 }}
                          value={s.memberId || ''}
                          disabled={mappingSpeakerId === s.speakerId}
                          onChange={e => handleMapSpeaker(s.speakerId, e.target.value || null)}
                        >
                          <option value="">Anonymous (Unassigned)</option>
                          {meeting.projectSnapshot?.members
                            .filter(m => m.active !== false)
                            .map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                        {isMapped && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 10, padding: '3px 6px', height: 'auto' }}
                            title="Clear mapping"
                            disabled={mappingSpeakerId === s.speakerId}
                            onClick={() => handleMapSpeaker(s.speakerId, null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="notice" style={{ marginTop: 14 }}>
            Workflow: AI candidates stay in review until approved. Tickets created here stay idempotent.
          </div>
        </aside>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />

      {/* EDIT MODAL */}
      {editing !== false && (
        <Modal
          title={editing ? 'Edit Task Candidate' : 'Add Task Candidate Manually'}
          onClose={() => setEditing(false)}
        >
          <form onSubmit={saveEdit}>
            {formError && (
              <div className="error-box" role="alert" style={{ marginBottom: 14 }}>
                {formError}
              </div>
            )}
            <div className="field">
              <label>Task title</label>
              <input
                required
                maxLength={200}
                className="input"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="What needs to be done?"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                required
                className="textarea"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the agreed work"
              />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Task type</label>
                <select className="select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {availableTypes.map(v => (
                    <option value={v} key={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Priority</label>
                <select
                  className="select"
                  value={form.priority}
                  onChange={e => setForm({ ...form, priority: e.target.value as Priority })}
                >
                  {['critical', 'high', 'medium', 'low'].map(x => (
                    <option key={x} value={x}>
                      {x[0].toUpperCase() + x.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {meeting.projectSnapshot && (
              <div className="form-grid">
                <div className="field">
                  <label>Product surface</label>
                  <select
                    className="select"
                    value={form.surface}
                    onChange={e => setForm({ ...form, surface: e.target.value, component: '' })}
                  >
                    <option value="">Unclear</option>
                    {meeting.projectSnapshot.surfaces.map(x => (
                      <option key={x.id} value={x.name}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Work area</label>
                  <select
                    className="select"
                    value={form.area}
                    onChange={e => setForm({ ...form, area: e.target.value })}
                  >
                    <option value="">Unclear</option>
                    {meeting.projectSnapshot.workAreas.map(x => (
                      <option key={x.id} value={x.name}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                {meeting.projectSnapshot.surfaces.some(s => s.components.length > 0) && (
                  <div className="field">
                    <label>Component</label>
                    <select
                      className="select"
                      value={form.component || ''}
                      onChange={e => setForm({ ...form, component: e.target.value })}
                    >
                      <option value="">Unclear</option>
                      {meeting.projectSnapshot.surfaces
                        .filter(s => !form.surface || s.name.toLowerCase() === form.surface.toLowerCase())
                        .flatMap(s =>
                          s.components.map(c => (
                            <option key={c.id} value={c.name}>
                              {s.name} / {c.name}
                            </option>
                          ))
                        )}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label>
                  Assignee <span className="muted">· optional</span>
                </label>
                <select
                  className="select"
                  value={form.assignee}
                  onChange={e => setForm({ ...form, assignee: e.target.value })}
                >
                  <option value="">Unassigned · requires review</option>
                  {meeting.projectSnapshot?.members
                    .filter(m => m.active)
                    .map(m => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                        {m.role ? ` · ${m.role}` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Deadline <span className="muted">· optional</span>
                </label>
                <input
                  className="input"
                  value={form.deadline}
                  onChange={e => setForm({ ...form, deadline: e.target.value })}
                  placeholder="e.g. 2026-10-15 or Next sprint"
                />
              </div>
            </div>

            <div className="field">
              <label>
                Context <span className="muted">· optional</span>
              </label>
              <textarea
                className="textarea"
                value={form.context}
                onChange={e => setForm({ ...form, context: e.target.value })}
                placeholder="Relevant background discussion from the meeting"
              />
            </div>

            <div className="field">
              <label>Acceptance criteria</label>
              {form.acceptanceCriteria.map((c, i) => (
                <div className="criteria-edit" key={i}>
                  <input
                    className="input"
                    value={c}
                    onChange={e =>
                      setForm({
                        ...form,
                        acceptanceCriteria: form.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x))
                      })
                    }
                    placeholder={`Criterion ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setForm({
                        ...form,
                        acceptanceCriteria: form.acceptanceCriteria.filter((_, j) => j !== i)
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setForm({ ...form, acceptanceCriteria: [...form.acceptanceCriteria, ''] })}
              >
                <Plus size={13} /> Add criterion
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Task Candidate'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* REJECTION MODAL */}
      {rejectingTask && (
        <Modal title="Reject Task Candidate" onClose={() => setRejectingTask(null)}>
          <form onSubmit={confirmRejection}>
            <p className="subtle" style={{ marginTop: 0 }}>
              Rejecting candidate: <strong>{rejectingTask.title}</strong>
            </p>
            <div className="field">
              <label>Rejection Reason (Optional)</label>
              <textarea
                className="textarea"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Why is this candidate rejected? (e.g., discussed and decided against, already implemented, out of scope)"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="btn" onClick={() => setRejectingTask(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={busy}>
                {busy ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
