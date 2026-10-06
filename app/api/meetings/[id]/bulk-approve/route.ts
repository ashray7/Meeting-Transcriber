import { NextResponse } from 'next/server';
import { getMeeting, saveTask } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting, tasks } = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  }

  // Safe bulk approval: committed tasks with high confidence and no pending review flags
  const eligible = tasks.filter(task => {
    const isPending = task.status === 'detected' || task.status === 'review_required' || (task.status as string) === 'draft';
    const isHighConfidence = (task.confidence ?? 0) >= 0.75;
    const hasNoReviewFlags = !task.classificationNeedsReview && !task.assignmentNeedsReview;
    return isPending && isHighConfidence && hasNoReviewFlags;
  });

  const now = new Date().toISOString();
  const approvedIds: string[] = [];

  for (const task of eligible) {
    task.status = 'approved';
    task.rejectionReason = null;
    task.updatedAt = now;
    await saveTask(task);
    approvedIds.push(task.id);
  }

  return NextResponse.json({
    approvedCount: approvedIds.length,
    approvedIds,
    message: approvedIds.length > 0
      ? `Approved ${approvedIds.length} high-confidence task candidate${approvedIds.length === 1 ? '' : 's'}.`
      : 'No pending high-confidence tasks without review flags were found.'
  });
}

