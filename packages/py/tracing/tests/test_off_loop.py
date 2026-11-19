from __future__ import annotations

import subprocess
import sys
import textwrap
import threading
import time

import pytest

from uselemma_tracing import off_loop


@pytest.fixture
def fresh_pool():
    """An empty pool, so worker-count and deadline overrides take effect."""
    off_loop._reset()
    yield
    off_loop._reset()


def _gated():
    """A job that runs until ``release`` is set, recording the thread it ran on."""
    release = threading.Event()
    ran = []

    def job():
        release.wait(timeout=5)
        ran.append(threading.get_ident())

    return job, release, ran


def _lemma_warnings(caplog) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name.startswith("uselemma_tracing")
    ]


def test_on_event_loop_thread_is_false_without_a_running_loop():
    assert not off_loop.on_event_loop_thread()


async def test_on_event_loop_thread_is_true_on_a_running_loop():
    assert off_loop.on_event_loop_thread()


def test_wait_pending_returns_once_queued_jobs_finish():
    job, release, ran = _gated()

    assert off_loop.submit(job, "trace-1")
    threading.Timer(0.05, release.set).start()
    off_loop.wait_pending()

    assert len(ran) == 1
    assert ran[0] != threading.get_ident()


def test_submit_refuses_a_job_past_the_backlog_cap(monkeypatch):
    monkeypatch.setattr(off_loop, "OFF_LOOP_MAX_BACKLOG", 2)
    first, release_first, ran_first = _gated()
    second, release_second, ran_second = _gated()
    refused = []

    assert off_loop.submit(first, "trace-1")
    assert off_loop.submit(second, "trace-2")
    assert not off_loop.submit(lambda: refused.append(True), "trace-3")

    release_first.set()
    release_second.set()
    off_loop.wait_pending()

    assert refused == []
    assert ran_first and ran_second
    assert off_loop.submit(lambda: None, "trace-4")


def test_the_drain_deadline_is_one_delivery_worst_case():
    # 3 attempts x 10 s timeout + 2 retries x 2 s longest backoff.
    assert off_loop.OFF_LOOP_DRAIN_DEADLINE_SECONDS == 34.0


def test_flush_stops_at_the_deadline_and_reports_unstarted_deliveries(
    fresh_pool, monkeypatch, caplog
):
    monkeypatch.setattr(off_loop, "OFF_LOOP_WORKERS", 1)
    monkeypatch.setattr(off_loop, "OFF_LOOP_DRAIN_DEADLINE_SECONDS", 0.2)
    in_flight, release, ran_in_flight = _gated()
    queued_ran = []

    assert off_loop.submit(in_flight, "trace-a")
    assert off_loop.submit(lambda: queued_ran.append("b"), "trace-b")
    assert off_loop.submit(lambda: queued_ran.append("c"), "trace-c")

    started = time.monotonic()
    off_loop.wait_pending()
    waited = time.monotonic() - started
    release.set()
    off_loop.wait_pending()

    assert waited < 2
    assert ran_in_flight, "the in-flight delivery finishes on its own"
    assert queued_ran == []
    [warning] = _lemma_warnings(caplog)
    assert warning.startswith(
        "uselemma-tracing: dropped trace trace-b before sending: 2 deliveries "
        "still queued at flush."
    )


def test_exit_stops_at_the_deadline_and_reports_unstarted_deliveries():
    script = textwrap.dedent(
        """
        import time
        from uselemma_tracing import off_loop

        off_loop.OFF_LOOP_WORKERS = 1
        off_loop.OFF_LOOP_DRAIN_DEADLINE_SECONDS = 0.2
        for index in range(4):
            off_loop.submit(lambda: time.sleep(1), f"trace-{index}")
        """
    )
    started = time.monotonic()
    completed = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30
    )
    elapsed = time.monotonic() - started

    assert completed.returncode == 0, completed.stderr
    # Without the deadline, exit would run all four one-second deliveries.
    assert elapsed < 3.5
    assert (
        "dropped trace trace-1 before sending: 3 deliveries still queued at exit."
        in completed.stderr
    )


def test_a_forked_child_starts_with_an_empty_pool():
    job, release, _ran = _gated()
    assert off_loop.submit(job, "trace-1")

    off_loop._reset()

    assert off_loop._executor is None
    assert off_loop._pending == {}
    release.set()
    assert off_loop.submit(lambda: None, "trace-2")
    off_loop.wait_pending()
