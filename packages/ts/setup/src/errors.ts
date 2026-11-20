/** Process exit codes. The setup skill branches on them. */
export const EXIT_CODES = {
  success: 0,
  failure: 1,
  usage: 2,
  expired: 3,
  denied: 4,
  /** Approval has not happened yet; `wait` can run again. */
  pending: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** A failure whose message is safe to print: it never contains a key or device code. */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = EXIT_CODES.failure,
  ) {
    super(message);
    this.name = "SetupError";
  }
}

/** The message of a failure that is safe to show: a setup error, or a system error's syscall and path. */
export function failureReason(error: unknown): string {
  if (error instanceof SetupError) return error.message;
  const systemError = error as NodeJS.ErrnoException;
  return typeof systemError?.syscall === "string"
    ? systemError.message
    : "an unexpected error";
}
