const activeControllers = new Map<string, AbortController>();

export function registerJob(meetingId: string, controller: AbortController): void {
  activeControllers.set(meetingId, controller);
}

export function unregisterJob(meetingId: string): void {
  activeControllers.delete(meetingId);
}

export function cancelJob(meetingId: string): boolean {
  const controller = activeControllers.get(meetingId);
  if (controller) {
    controller.abort();
    activeControllers.delete(meetingId);
    return true;
  }
  return false;
}

export function isJobActive(meetingId: string): boolean {
  return activeControllers.has(meetingId);
}

