_experiment_mode_enabled = False


def enable_experiment_mode() -> None:
    global _experiment_mode_enabled
    _experiment_mode_enabled = True


def disable_experiment_mode() -> None:
    global _experiment_mode_enabled
    _experiment_mode_enabled = False


def is_experiment_mode_enabled() -> bool:
    return _experiment_mode_enabled
