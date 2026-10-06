import { NextResponse } from 'next/server';
import { getMeeting, getTask, storage } from '@/lib/store';
import { createTicketForTask } from '@/lib/ticket-provider';

export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: 'Task candidate not found.' }, { status: 404 });
  }

  const { meeting } = await getMeeting(task.meetingId);
  try {
    const result = await createTicketForTask(id, storage, undefined, meeting?.projectSnapshot || null);
    return NextResponse.json(result, { status: result.alreadyExisted ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create ticket from task candidate.' },
      { status: 400 }
    );
  }
}

