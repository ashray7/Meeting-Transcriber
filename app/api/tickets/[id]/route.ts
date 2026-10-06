import { NextResponse } from 'next/server';
import { deleteTicket, getTicket, updateTicket } from '@/lib/store';
import { ticketInputSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }
  return NextResponse.json(ticket);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getTicket(id);
  if (!existing) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  try {
    const patch = ticketInputSchema.partial().parse(await req.json());
    const updated = await updateTicket(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid ticket update.' },
      { status: 400 }
    );
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getTicket(id);
  if (!existing) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  await deleteTicket(id);
  return NextResponse.json({ ok: true });
}

