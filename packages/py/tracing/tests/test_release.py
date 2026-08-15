from uselemma_tracing.release import RELEASE_MAX_LENGTH, normalize_release


def test_normalize_release_trims_and_keeps_valid_values():
    assert normalize_release("  1.8.3  ") == "1.8.3"


def test_normalize_release_omits_missing_empty_and_whitespace():
    assert normalize_release(None) is None
    assert normalize_release("") is None
    assert normalize_release("   ") is None
    assert normalize_release(12) is None


def test_normalize_release_caps_at_200_characters():
    at_cap = "a" * RELEASE_MAX_LENGTH
    too_long = "a" * (RELEASE_MAX_LENGTH + 1)
    assert normalize_release(at_cap) == at_cap
    assert normalize_release(too_long) is None


def test_normalize_release_rejects_control_characters():
    assert normalize_release("v1\n2") is None
    assert normalize_release("v1\t2") is None
    assert normalize_release("v1\r2") is None
