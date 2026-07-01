let experimentModeEnabled = false;

export function enableExperimentMode(): void {
  experimentModeEnabled = true;
}

export function disableExperimentMode(): void {
  experimentModeEnabled = false;
}

export function isExperimentModeEnabled(): boolean {
  return experimentModeEnabled;
}
