import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Clock3,
  FileQuestion,
  FolderKanban,
  Plus,
  Ticket as TicketIcon,
  UserX,
  Video,
  XCircle
} from 'lucide-react';
import { getMeeting, listMeetings, listProjects, listTickets } from '@/lib/store';
import { StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard({
  searchParams
}: {
  searchParams?: Promise<{ projectId?: string }>;
}) {
  const params = await searchParams;
  const selectedProjectId = params?.projectId || null;

  const [allMeetings, allProjects, allTickets] = await Promise.all([
    listMeetings(),
    listProjects(),
    listTickets()
  ]);

  // Filter by project if selected
  const meetings = selectedProjectId
    ? allMeetings.filter(m => m.projectId === selectedProjectId)
    : allMeetings;

  const records = await Promise.all(meetings.map(m => getMeeting(m.id)));
  const allTasks = records.flatMap(r => r.tasks);

  const tickets = selectedProjectId
    ? allTickets.filter(t => t.projectId === selectedProjectId)
    : allTickets;

  // Key Project & Workspace Metrics (Requirement 12)
  const meetingsCount = meetings.length;
  const detectedTasksCount = allTasks.length;
  const pendingReviewsCount = allTasks.filter(
    t => t.status === 'review_required' || t.status === 'detected' || (t.status as string) === 'draft'
  ).length;
  const approvedTasksCount = allTasks.filter(t => t.status === 'approved').length;
  const createdTicketsCount = tickets.length;
  const rejectedTasksCount = allTasks.filter(t => t.status === 'rejected').length;
  const unassignedTasksCount = allTasks.filter(t => !t.assignee).length;
  const lowConfidenceTasksCount = allTasks.filter(
    t => (t.confidence != null && t.confidence < 0.65) || t.classificationNeedsReview
  ).length;

  const activeProject = allProjects.find(p => p.id === selectedProjectId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {activeProject ? `PROJECT DASHBOARD · ${activeProject.name.toUpperCase()}` : 'WORKSPACE OVERVIEW'}
          </div>
          <h1 className="page-title">
            {activeProject ? activeProject.name : 'Human Review & Ticket Hub'}
          </h1>
          <p className="subtle">
            Turn software team discussions into grounded, verified, and approved tickets.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/projects" className="btn">
            <FolderKanban size={14} /> Projects
          </Link>
          <Link href="/new-meeting" className="btn btn-primary">
            <Plus size={15} /> New meeting
          </Link>
        </div>
      </div>

      {/* User Workflow Pipeline (Requirement 11: PROJECT → KNOWLEDGE → MEETING → ANALYSIS → REVIEW → TICKETS) */}
      <div className="card" style={{ padding: '10px 16px', marginBottom: 20, background: '#f8faf9', border: '1px solid #e1e7e3' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#176b50' }}>
            System Workflow
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, flexWrap: 'wrap' }}>
            <Link href="/projects" style={{ color: '#26332b', textDecoration: 'none' }}>
              <strong>1. Project</strong>
            </Link>
            <span style={{ color: '#a0aaa3' }}>→</span>
            <Link href="/projects" style={{ color: '#26332b', textDecoration: 'none' }}>
              <strong>2. Knowledge</strong>
            </Link>
            <span style={{ color: '#a0aaa3' }}>→</span>
            <Link href="/new-meeting" style={{ color: '#26332b', textDecoration: 'none' }}>
              <strong>3. Meeting</strong>
            </Link>
            <span style={{ color: '#a0aaa3' }}>→</span>
            <span style={{ color: '#26332b' }}><strong>4. Analysis</strong></span>
            <span style={{ color: '#a0aaa3' }}>→</span>
            <span style={{ color: '#26332b' }}><strong>5. Review</strong></span>
            <span style={{ color: '#a0aaa3' }}>→</span>
            <span style={{ color: '#176b50', fontWeight: 700 }}>6. Tickets</span>
          </div>
        </div>
      </div>

      {/* Project Selector Filter Tabs */}
      {allProjects.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
            Filter by project:
          </span>
          <Link
            href="/"
            className={`btn btn-sm ${!selectedProjectId ? 'btn-primary' : ''}`}
            style={{ borderRadius: 16 }}
          >
            All projects ({allMeetings.length})
          </Link>
          {allProjects.map(proj => {
            const count = allMeetings.filter(m => m.projectId === proj.id).length;
            const isSelected = selectedProjectId === proj.id;
            return (
              <Link
                key={proj.id}
                href={`/?projectId=${proj.id}`}
                className={`btn btn-sm ${isSelected ? 'btn-primary' : ''}`}
                style={{ borderRadius: 16 }}
              >
                {proj.name} ({count})
              </Link>
            );
          })}
        </div>
      )}

      {/* PROJECT DASHBOARD METRICS GRID (Requirement 12) */}
      <div
        className="profile-summary-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 28
        }}
      >
        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Meetings</span>
            <Video size={14} />
          </div>
          <strong style={{ color: '#176b50' }}>{meetingsCount}</strong>
          <span>Recorded &amp; analyzed</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Pending reviews</span>
            <Clock size={14} />
          </div>
          <strong style={{ color: '#ef6c00' }}>{pendingReviewsCount}</strong>
          <span>Awaiting human decision</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Detected tasks</span>
            <FileQuestion size={14} />
          </div>
          <strong style={{ color: '#26332b' }}>{detectedTasksCount}</strong>
          <span>Total candidates</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Approved candidates</span>
            <CheckCircle2 size={14} />
          </div>
          <strong style={{ color: '#2e7d32' }}>{approvedTasksCount}</strong>
          <span>Ready to create ticket</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Created tickets</span>
            <TicketIcon size={14} />
          </div>
          <strong style={{ color: '#176b50' }}>{createdTicketsCount}</strong>
          <span>Official workspace tickets</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Rejected tasks</span>
            <XCircle size={14} />
          </div>
          <strong style={{ color: '#c62828' }}>{rejectedTasksCount}</strong>
          <span>With stored rationale</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Unassigned tasks</span>
            <UserX size={14} />
          </div>
          <strong style={{ color: unassignedTasksCount > 0 ? '#d97706' : '#26332b' }}>
            {unassignedTasksCount}
          </strong>
          <span>Needs team owner</span>
        </div>

        <div className="card profile-stat">
          <div className="kpi-top">
            <span>Low-confidence tasks</span>
            <AlertTriangle size={14} />
          </div>
          <strong style={{ color: lowConfidenceTasksCount > 0 ? '#dc2626' : '#26332b' }}>
            {lowConfidenceTasksCount}
          </strong>
          <span>Requires verification</span>
        </div>
      </div>

      {/* TWO COLUMN SECTION: RECENT MEETINGS & RECENT TICKETS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 20 }}>
        {/* Recent Meetings */}
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="section-title">Recent meetings</div>
            <Link href="/meetings" className="subtle" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              View all <ArrowRight size={13} />
            </Link>
          </div>

          <div className="card table-card">
            {meetings.slice(0, 6).map((m, i) => {
              const pendingInMeeting = records[i]?.tasks.filter(
                t => t.status === 'review_required' || t.status === 'detected' || (t.status as string) === 'draft'
              ).length;
              return (
                <Link href={`/meetings/${m.id}`} className="meeting-row" key={m.id}>
                  <div>
                    <div className="meeting-name">{m.title}</div>
                    <div className="meeting-date" style={{ marginTop: 4 }}>
                      {new Date(m.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}{' '}
                      · {m.meetingType}
                    </div>
                  </div>
                  <div className="muted">
                    {records[i]?.tasks.length} {records[i]?.tasks.length === 1 ? 'task' : 'tasks'}
                  </div>
                  <StatusBadge status={m.status} />
                  <div className="muted" style={{ fontSize: 11 }}>
                    {pendingInMeeting > 0 ? (
                      <span className="badge badge-amber">{pendingInMeeting} pending</span>
                    ) : (
                      <span className="badge badge-green">Reviewed</span>
                    )}
                  </div>
                  <ArrowRight size={14} color="#a2aaa5" />
                </Link>
              );
            })}

            {!meetings.length && (
              <div className="empty">
                <Clock3 size={25} style={{ margin: '0 auto 12px', color: '#afbbb3' }} />
                <div style={{ fontWeight: 600, color: '#526057', marginBottom: 5 }}>No meetings yet</div>
                Upload a recording to get your first transcript and task candidates.
                <br />
                <Link href="/new-meeting" className="btn btn-primary" style={{ marginTop: 17 }}>
                  Add a meeting
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Recent Official Created Tickets */}
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="section-title">
              Recent created tickets <span className="muted">({tickets.length})</span>
            </div>
            <span className="subtle" style={{ fontSize: 11 }}>
              Idempotent tracker tickets
            </span>
          </div>

          <div className="card table-card">
            {tickets.slice(0, 6).map(ticket => (
              <div
                key={ticket.id}
                style={{
                  padding: '13px 16px',
                  borderBottom: '1px solid #eef0ee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="ticket-key">{ticket.externalKey || ticket.id.slice(0, 8)}</span>
                    <strong style={{ fontSize: 12, color: '#26332b' }}>{ticket.title}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {ticket.taskType ? `${ticket.taskType} · ` : ''}
                    {ticket.assigneeName ? `Assigned: ${ticket.assigneeName}` : 'Unassigned'}
                    {ticket.priority ? ` · ${ticket.priority}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-green">{ticket.status}</span>
                  {ticket.meetingId && (
                    <Link
                      href={`/meetings/${ticket.meetingId}`}
                      className="btn btn-sm"
                      title="View source meeting"
                    >
                      <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              </div>
            ))}

            {!tickets.length && (
              <div className="empty">
                <TicketIcon size={24} style={{ margin: '0 auto 10px', color: '#b0bec5' }} />
                <div style={{ fontWeight: 600, color: '#526057', marginBottom: 4 }}>No tickets created yet</div>
                Review and approve candidate tasks in a meeting to create your first official tickets.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
