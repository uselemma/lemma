from __future__ import annotations

import threading

import pytest

from uselemma_tracing.delivery import (
    INGEST_MAX_ATTEMPTS,
    INGEST_RETRY_BASE_DELAY_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
    SendFailed,
    Sent,
    ingest_retry_delay_seconds,
    is_retryable_ingest_status,
    run_off_event_loop,
    send_once,
    send_with_retries,
)

LOG = {"trace_id": "trace-1", "project_id": "project-1"}


def test_is_retryable_ingest_status():
    for status in (408, 429, 500, 502, 503, 504):
        assert is_retryable_ingest_status(status)
    for status in (400, 401, 403, 404, 413, 422):
        assert not is_retryable_ingest_status(status)


def test_ingest_retry_delay_doubles_with_jitter():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, None, lambda: 0.0) == base / 2
    assert ingest_retry_delay_seconds(1, None, lambda: 1.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 0.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 1.0) == base * 2


def test_ingest_retry_delay_honors_retry_after_up_to_the_cap():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, "1", lambda: 0.0) == 1.0
    assert ingest_retry_delay_seconds(1, "0", lambda: 1.0) == base
    assert (
        ingest_retry_delay_seconds(1, "60", lambda: 0.0)
        == INGEST_RETRY_MAX_DELAY_SECONDS
    )
    for unusable in ("Wed, 21 Oct 2026 07:28:00 GMT", " ", "nan", "-1"):
        assert ingest_retry_delay_seconds(1, unusable, lambda: 0.0) == base / 2


def test_send_once_classifies_a_2xx_as_sent():
    assert send_once(lambda: (201, "{}", {"cf-ray": "ray"}), LOG) == Sent(
        status=201, headers={"cf-ray": "ray"}
    )


def test_send_once_classifies_a_5xx_as_retryable_with_its_retry_after():
    attempt = send_once(lambda: (503, "busy", {"Retry-After": "1"}), LOG)

    assert isinstance(attempt, SendFailed)
    assert attempt.reason == "ingest returned 503"
    assert attempt.retryable
    assert attempt.retry_after == "1"
    assert str(attempt.error) == "uselemma-tracing: failed to ingest trace (503): busy"


def test_send_once_classifies_a_rejected_request_as_final_with_its_hint():
    attempt = send_once(lambda: (401, "bad key", {}), LOG)

    assert isinstance(attempt, SendFailed)
    assert attempt.reason == "ingest returned 401 (check LEMMA_API_KEY)"
    assert not attempt.retryable
    assert attempt.retry_after is None


def test_send_once_classifies_a_transport_error_as_retryable():
    def post():
        raise TimeoutError("timed out")

    attempt = send_once(post, LOG)

    assert isinstance(attempt, SendFailed)
    assert isinstance(attempt.error, TimeoutError)
    assert attempt.reason == "TimeoutError: timed out"
    assert attempt.retryable


def test_send_once_lets_base_exceptions_propagate():
    def post():
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        send_once(post, LOG)


def test_send_with_retries_stops_after_the_last_attempt(retry_sleeps):
    calls = []

    def post():
        calls.append(1)
        return 503, "busy", {}

    attempt, attempts = send_with_retries(post, LOG, max_attempts=INGEST_MAX_ATTEMPTS)

    assert isinstance(attempt, SendFailed)
    assert attempts == INGEST_MAX_ATTEMPTS
    assert len(calls) == INGEST_MAX_ATTEMPTS
    assert len(retry_sleeps) == INGEST_MAX_ATTEMPTS - 1


def test_send_with_retries_stops_at_the_first_final_failure(retry_sleeps):
    attempt, attempts = send_with_retries(
        lambda: (401, "bad key", {}), LOG, max_attempts=INGEST_MAX_ATTEMPTS
    )

    assert attempts == 1
    assert retry_sleeps == []


def test_send_with_retries_sends_once_when_one_attempt_is_allowed(retry_sleeps):
    attempt, attempts = send_with_retries(
        lambda: (503, "busy", {}), LOG, max_attempts=1
    )

    assert isinstance(attempt, SendFailed)
    assert attempts == 1
    assert retry_sleeps == []


def test_run_off_event_loop_runs_inline_without_a_loop():
    threads = []

    assert run_off_event_loop(lambda: threads.append(threading.get_ident())) is None
    assert threads == [threading.get_ident()]


async def test_run_off_event_loop_uses_a_worker_thread_on_a_loop():
    threads = []

    future = run_off_event_loop(lambda: threads.append(threading.get_ident()))

    assert future is not None
    future.result(timeout=5)
    assert threads and threads[0] != threading.get_ident()
