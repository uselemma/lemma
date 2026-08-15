/** Run after the current turn so an operation result can stamp usage first. */
export function scheduleMacrotask(task: () => void): void {
  if (typeof setImmediate === "function") {
    setImmediate(task);
    return;
  }
  setTimeout(task, 0);
}
