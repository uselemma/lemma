from __future__ import annotations

import pytest

from uselemma_tracing.delivery import (
    INGEST_MAX_ATTEMPTS,
    INGEST_RETRY_BASE_DELAY_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
    Delivered,
    DeliveryFailure,
    deliver,
    failed_before_sending,
    ingest_failure_hint,
    ingest_retry_delay_seconds,
    is_retryable_ingest_status,
    parse_retry_after_seconds,
)

LOG = {"trace_id": "trace-1", "project_id": "project-1"}


def _counting(response):
    calls = []

    def post():
        calls.append(1)
        if isinstance(response, BaseException):
            raise response
        return response

    return post, calls


def test_ingest_failure_hint():
    assert "LEMMA_API_KEY" in ingest_failure_hint(401)
    assert "rate limit" in ingest_failure_hint(429)
    assert ingest_failure_hint(503) is None


def test_is_retryable_ingest_status():
    for status in (408, 429, 500, 502, 503, 504):
        assert is_retryable_ingest_status(status)
    for status in (400, 401, 403, 404, 413, 422):
        assert not is_retryable_ingest_status(status)


def test_parse_retry_after_seconds_reads_only_delta_seconds():
    assert parse_retry_after_seconds("1") == 1.0
    assert parse_retry_after_seconds("0") == 0.0
    for unusable in (None, "Wed, 21 Oct 2026 07:28:00 GMT", " ", "nan", "-1"):
        assert parse_retry_after_seconds(unusable) is None


def test_ingest_retry_delay_doubles_with_jitter():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, None, lambda: 0.0) == base / 2
    assert ingest_retry_delay_seconds(1, None, lambda: 1.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 0.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 1.0) == base * 2


def test_ingest_retry_delay_honors_retry_after_up_to_the_cap():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, 1.0, lambda: 0.0) == 1.0
    assert ingest_retry_delay_seconds(1, 0.0, lambda: 1.0) == base
    assert ingest_retry_delay_seconds(1, 60.0, lambda: 0.0) == INGEST_RETRY_MAX_DELAY_SECONDS


def test_deliver_returns_the_delivered_response():
    post, calls = _counting((201, "{}", {"cf-ray": "ray"}))

    assert deliver(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS) == Delivered(
        status=201, headers={"cf-ray": "ray"}
    )
    assert len(calls) == 1


def test_deliver_retries_a_5xx_up_to_the_last_attempt(retry_sleeps):
    post, calls = _counting((503, "busy", {}))

    result = deliver(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS)

    assert isinstance(result, DeliveryFailure)
    assert result.cause == f"after {INGEST_MAX_ATTEMPTS} attempts: ingest returned 503"
    assert str(result.error) == "uselemma-tracing: failed to ingest trace (503): busy"
    assert len(calls) == INGEST_MAX_ATTEMPTS
    assert len(retry_sleeps) == INGEST_MAX_ATTEMPTS - 1


def test_deliver_does_not_retry_a_rejected_request(retry_sleeps):
    post, calls = _counting((401, "bad key", {}))

    result = deliver(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS)

    assert isinstance(result, DeliveryFailure)
    assert result.cause == "after 1 attempt: ingest returned 401 (check LEMMA_API_KEY)"
    assert len(calls) == 1
    assert retry_sleeps == []


def test_deliver_retries_a_transport_error(retry_sleeps):
    post, calls = _counting(TimeoutError("timed out"))

    result = deliver(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS)

    assert isinstance(result, DeliveryFailure)
    assert isinstance(result.error, TimeoutError)
    assert result.cause == f"after {INGEST_MAX_ATTEMPTS} attempts: TimeoutError: timed out"
    assert len(calls) == INGEST_MAX_ATTEMPTS


def test_deliver_waits_out_a_parsed_retry_after(retry_sleeps):
    responses = iter([(429, "slow down", {"retry-after": "1"}), (201, "{}", {})])

    result = deliver(lambda: next(responses), LOG, max_attempts=INGEST_MAX_ATTEMPTS)

    assert isinstance(result, Delivered)
    assert retry_sleeps == [1.0]


def test_deliver_lets_base_exceptions_propagate():
    post, _calls = _counting(KeyboardInterrupt())

    with pytest.raises(KeyboardInterrupt):
        deliver(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS)


def test_deliver_sends_once_when_one_attempt_is_allowed(retry_sleeps):
    post, calls = _counting((503, "busy", {}))

    result = deliver(post, LOG, max_attempts=1)

    assert isinstance(result, DeliveryFailure)
    assert len(calls) == 1
    assert retry_sleeps == []


def test_failed_before_sending_names_the_build_error():
    error = ValueError("redaction failed")

    assert failed_before_sending(error) == DeliveryFailure(
        error=error, cause="before sending: ValueError: redaction failed"
    )
