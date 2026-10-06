import { randomUUID } from 'node:crypto';
import { CreateTicketInput, MeetingTaskEvidence, Priority, ProjectReferenceEvidence, ProjectSnapshot, Task, Ticket, TicketStatus, UpdateTicketInput } from './types';
import { Storage } from './storage';

export interface TicketProvider {
  readonly id: string;
  readonly name: string;
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  updateTicket(id: string, input: UpdateTicketInput): Promise<Ticket>;
  findTicket(filter: { sourceTaskId?: string; projectId?: string; meetingId?: string }): Promise<Ticket | null>;
  getTicket(id: string): Promise<Ticket | null>;
  listTickets(filter?: { projectId?: string; meetingId?: string; status?: TicketStatus }): Promise<Ticket[]>;
}

export function buildTicketContent(task: Task, projectSnapshot?: ProjectSnapshot | null): {
  title: string;
  description: string;
  context: string | null;
  expectedOutcome: string | null;
  taskType: string | null;
  productSurface: string | null;
  component: string | null;
  workArea: string | null;
  priority: Priority | null;
  assignee: string | null;
  assigneeName: string | null;
  deadline: string | null;
  acceptanceCriteria: string[];
  sourceEvidence: MeetingTaskEvidence[];
  projectReferences: ProjectReferenceEvidence[];
} {
  const member = task.assignee
    ? projectSnapshot?.members.find(m => m.id === task.assignee)
    : null;

  const expectedOutcome = task.acceptanceCriteria.length > 0
    ? `Completed when:\n${task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}`
    : task.description.trim() ? `Resolve: ${task.title}` : null;

  return {
    title: task.title.trim(),
    description: task.description.trim(),
    context: task.context?.trim() || null,
    expectedOutcome,
    taskType: task.type || null,
    productSurface: task.surface || null,
    component: task.component || null,
    workArea: task.area || null,
    priority: task.priority || null,
    assignee: task.assignee || null,
    assigneeName: member?.name || task.assigneeName || null,
    deadline: task.deadline || null,
    acceptanceCriteria: [...(task.acceptanceCriteria || [])],
    sourceEvidence: [...(task.evidence || [])],
    projectReferences: [...(task.projectReferenceEvidence || [])]
  };
}

export class InternalTicketProvider implements TicketProvider {
  readonly id = 'internal';
  readonly name = 'Internal Workspace Tracker';

  constructor(private readonly storage: Storage) {}

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    // Idempotent: check if ticket already exists for sourceTaskId
    if (input.sourceTaskId) {
      const existing = await this.storage.findTicketBySourceTaskId(input.sourceTaskId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const ticketId = randomUUID();
    const ticket: Ticket = {
      id: ticketId,
      projectId: input.projectId || null,
      sourceTaskId: input.sourceTaskId,
      meetingId: input.meetingId || null,
      title: input.title,
      description: input.description,
      context: input.context || null,
      expectedOutcome: input.expectedOutcome || null,
      taskType: input.taskType || null,
      productSurface: input.productSurface || null,
      component: input.component || null,
      workArea: input.workArea || null,
      priority: input.priority || null,
      assignee: input.assignee || null,
      assigneeName: input.assigneeName || null,
      deadline: input.deadline || null,
      acceptanceCriteria: input.acceptanceCriteria || [],
      status: input.status || 'open',
      createdAt: now,
      updatedAt: now,
      sourceEvidence: input.sourceEvidence || [],
      projectReferences: input.projectReferences || [],
      externalKey: input.externalKey || `INT-${ticketId.slice(0, 8).toUpperCase()}`,
      provider: 'internal'
    };

    return this.storage.saveTicket(ticket);
  }

  async updateTicket(id: string, input: UpdateTicketInput): Promise<Ticket> {
    return this.storage.updateTicket(id, input);
  }

  async findTicket(filter: { sourceTaskId?: string; projectId?: string; meetingId?: string }): Promise<Ticket | null> {
    if (filter.sourceTaskId) {
      return this.storage.findTicketBySourceTaskId(filter.sourceTaskId);
    }
    const matches = await this.storage.listTickets(filter);
    return matches[0] || null;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.storage.getTicket(id);
  }

  async listTickets(filter?: { projectId?: string; meetingId?: string; status?: TicketStatus }): Promise<Ticket[]> {
    return this.storage.listTickets(filter);
  }
}

// Conceptually extensible provider registry ready for Jira, Linear, GitHub Issues
export class TicketProviderRegistry {
  private providers = new Map<string, TicketProvider>();

  register(provider: TicketProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id = 'internal'): TicketProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Ticket provider "${id}" not found.`);
    }
    return provider;
  }

  list(): Array<{ id: string; name: string }> {
    return Array.from(this.providers.values()).map(p => ({ id: p.id, name: p.name }));
  }
}

export async function createTicketForTask(
  taskId: string,
  storage: Storage,
  provider?: TicketProvider,
  projectSnapshot?: ProjectSnapshot | null
): Promise<{ ticket: Ticket; alreadyExisted: boolean }> {
  const activeProvider = provider || new InternalTicketProvider(storage);

  // 1. Duplicate check (Idempotent)
  const existing = await activeProvider.findTicket({ sourceTaskId: taskId });
  if (existing) {
    // If ticket exists, ensure task is marked as created
    const task = await storage.getTask(taskId);
    if (task && (task.status !== 'created' || task.createdTicketId !== existing.id)) {
      task.status = 'created';
      task.createdTicketId = existing.id;
      task.updatedAt = new Date().toISOString();
      await storage.saveTask(task);
    }
    return { ticket: existing, alreadyExisted: true };
  }

  // 2. Load task
  const task = await storage.getTask(taskId);
  if (!task) {
    throw new Error('Task not found.');
  }

  // 3. Format concise ticket content
  const content = buildTicketContent(task, projectSnapshot);

  // 4. Create ticket via provider
  const ticket = await activeProvider.createTicket({
    sourceTaskId: task.id,
    meetingId: task.meetingId,
    projectId: projectSnapshot?.id || null,
    title: content.title,
    description: content.description,
    context: content.context,
    expectedOutcome: content.expectedOutcome,
    taskType: content.taskType,
    productSurface: content.productSurface,
    component: content.component,
    workArea: content.workArea,
    priority: content.priority,
    assignee: content.assignee,
    assigneeName: content.assigneeName,
    deadline: content.deadline,
    acceptanceCriteria: content.acceptanceCriteria,
    sourceEvidence: content.sourceEvidence,
    projectReferences: content.projectReferences,
    status: 'open'
  });

  // 5. Update task review status to 'created'
  task.status = 'created';
  task.createdTicketId = ticket.id;
  task.updatedAt = new Date().toISOString();
  await storage.saveTask(task);

  return { ticket, alreadyExisted: false };
}
