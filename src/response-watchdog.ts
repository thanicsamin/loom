export type ResponseLimits = { waitingMs: number; idleMs: number; maximumMs: number };
export const RESPONSE_LIMITS: ResponseLimits = { waitingMs: 15000, idleMs: 120000, maximumMs: 600000 };

export function responseFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The request failed.';
  const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.response?.status);
  let summary = '';
  if (status === 429 || /\b429\b|rate.?limit|quota (?:exceeded|unavailable|exhausted)/i.test(message))
    summary = 'The provider quota or rate limit was reached. Wait before retrying, or choose another model.';
  else if ([401, 403].includes(status) || /\b(?:401|403)\b|authentication (?:failed|required)|invalid api.?key|(?:expired|invalid).{0,20}(?:token|credentials)/i.test(message))
    summary = 'The provider rejected the sign-in. Check the account in Settings before retrying.';
  else if ([502, 503, 504, 529].includes(status) || /\b(?:502|503|504|529)\b|overloaded|service unavailable|at capacity/i.test(message))
    summary = 'The provider is unavailable. Retry later or choose another model.';
  else if (/model.{0,80}(?:not found|unavailable|not available|does not exist|no longer|not supported)/i.test(message))
    summary = 'This model is unavailable. Refresh Accounts or choose another model.';
  else if (/ECONN(?:RESET|REFUSED)|ENOTFOUND|fetch failed|network (?:error|unavailable)|connection (?:lost|closed)|stopped before completing/i.test(message))
    summary = 'The provider connection stopped. Check the connection, then retry or choose another model.';
  const saved = /Your message and attachments are saved/i.test(message) ? '' : ' Your message and attachments are saved.';
  return (summary ? summary + '\n' : '') + message + saved;
}

// Bound silent connections as well as providers that keep working forever.
export class ResponseWatchdog {
  readonly failure: Promise<never>;
  private waiting?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private reject!: (error: Error) => void;
  private closed = false;
  constructor(private limits: ResponseLimits, private onWaiting: () => void, private onTimeout: (error: Error) => void) {
    this.failure = new Promise((_, reject) => { this.reject = reject; });
    // Cancellation can happen during setup, before a caller races the promise.
    void this.failure.catch(() => {});
    this.maximum = setTimeout(() => this.fail('The response took too long.'), limits.maximumMs);
    this.pulse();
  }
  pulse() {
    if (this.closed) return;
    clearTimeout(this.waiting); clearTimeout(this.idle);
    this.waiting = setTimeout(this.onWaiting, this.limits.waitingMs);
    this.idle = setTimeout(() => this.fail('The provider stopped responding.'), this.limits.idleMs);
  }
  private fail(message: string) {
    if (this.closed) return;
    this.close();
    const error = Error(message + ' Your message and attachments are saved. Retry or choose another model.');
    this.onTimeout(error); this.reject(error);
  }
  close() {
    this.closed = true;
    clearTimeout(this.waiting); clearTimeout(this.idle); clearTimeout(this.maximum);
  }
  cancel() { if(!this.closed){this.close();this.reject(Error('The response was stopped.'));} }
}
