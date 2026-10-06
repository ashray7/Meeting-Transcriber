type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  meetingId?: string;
  projectId?: string;
  documentId?: string;
  taskId?: string;
  ticketId?: string;
  stage?: string;
  [key: string]: unknown;
}

function formatContext(ctx?: LogContext): string {
  if (!ctx) return '';
  const parts = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` [${parts.join(' ')}]` : '';
}

function log(level: LogLevel, message: string, ctx?: LogContext, error?: unknown) {
  const timestamp = new Date().toISOString();
  const contextStr = formatContext(ctx);
  const prefix = `[${timestamp}] [${level.toUpperCase()}]${contextStr}`;

  if (level === 'error') {
    if (error instanceof Error) {
      console.error(`${prefix} ${message}: ${error.message}`);
    } else if (error) {
      console.error(`${prefix} ${message}:`, error);
    } else {
      console.error(`${prefix} ${message}`);
    }
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  info: (message: string, ctx?: LogContext) => log('info', message, ctx),
  warn: (message: string, ctx?: LogContext) => log('warn', message, ctx),
  error: (message: string, ctx?: LogContext, error?: unknown) => log('error', message, ctx, error),
  debug: (message: string, ctx?: LogContext) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      log('debug', message, ctx);
    }
  }
};
