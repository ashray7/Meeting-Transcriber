import { NextResponse } from 'next/server';
import { listTickets, storage } from '@/lib/store';
import { ticketInputSchema } from '@/lib/validation';
import { InternalTicketProvider } from '@/lib/ticket-provider';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId') || undefined;
  const meetingId = searchParams.get('meetingId') || undefined;
  const status = searchParams.get('status') || undefined;

  const tickets = await listTickets({ projectId, meetingId, status });
  return NextResponse.json(tickets);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ticketInputSchema.parse(body);
    const provider = new InternalTicketProvider(storage);
    const ticket = await provider.createTicket({
      sourceTaskId: parsed.sourceTaskId,
      meetingId: parsed.meetingId || null,
      projectId: parsed.projectId || null,
      title: parsed.title,
      description: parsed.description,
      context: parsed.context || null,
      expectedOutcome: parsed.expectedOutcome || null,
      taskType: parsed.taskType || null,
      productSurface: parsed.productSurface || null,
      component: parsed.component || null,
      workArea: parsed.workArea || null,
      priority: parsed.priority || null,
      assignee: parsed.assignee || null,
      assigneeName: parsed.assigneeName || null,
      deadline: parsed.deadline || null,
      acceptanceCriteria: parsed.acceptanceCriteria || [],
      status: parsed.status || 'open'
    });
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid ticket input.' },
      { status: 400 }
    );
  }
}

