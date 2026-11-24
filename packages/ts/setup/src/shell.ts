/** Characters a POSIX shell reads literally, so a word made only of them needs no quotes. */
const SHELL_SAFE_WORD = /^[A-Za-z0-9_./:=@-]+$/;

/** `value` as one POSIX shell word, so a printed command runs as shown for any path or JSON. */
export function shellWord(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.split("'").join(`'\\''`)}'`;
}

/** The command as a person types it. */
export function shownCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellWord).join(" ");
}
