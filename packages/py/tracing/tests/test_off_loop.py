from __future__ import annotations

import asyncio
import contextvars
import subprocess
import sys
import textwrap
import threading
import time

import pytest

from uselemma_tracing import off_loop


@pytest.fixture
def one_worker_pools(monkeypatch):
    """Single-worker pools, so a gated job keeps the rest queued."""
    monkeypatch.setattr(off_loop, "_fire_and_forget", off_loop._Pool(1, "uselemma-delivery"))
    monkeypatch.setattr(off_loop, "_awaited", off_loop._Pool(1, "uselemma-awaited-delivery"))


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


def test_hand_off_delivers_inline_without_a_running_loop():
    ran = []

    off_loop.hand_off(lambda: ran.append(threading.get_ident()), "trace-1")

    assert ran == [threading.get_ident()]


async def test_hand_off_queues_on_the_pool_when_a_loop_is_running():
    ran = []

    off_loop.hand_off(lambda: ran.append(threading.current_thread().name), "trace-1")
    off_loop.wait_pending()

    [thread_name] = ran
    assert thread_name.startswith("uselemma-delivery_")


def test_wait_pending_returns_once_queued_jobs_finish():
    job, release, ran = _gated()

    off_loop._fire_and_forget.submit(job, "trace-1")
    threading.Timer(0.05, release.set).start()
    off_loop.wait_pending()

    assert len(ran) == 1
    assert ran[0] != threading.get_ident()


async def test_hand_off_reports_a_delivery_past_the_backlog_cap(monkeypatch, caplog):
    monkeypatch.setattr(off_loop, "OFF_LOOP_MAX_BACKLOG", 2)
    first, release_first, ran_first = _gated()
    second, release_second, ran_second = _gated()
    refused = []

    off_loop.hand_off(first, "trace-1")
    off_loop.hand_off(second, "trace-2")
    off_loop.hand_off(lambda: refused.append(True), "trace-3")

    release_first.set()
    release_second.set()
    off_loop.wait_pending()

    assert refused == []
    assert ran_first and ran_second
    [warning] = _lemma_warnings(caplog)
    assert warning.startswith(
        "uselemma-tracing: dropped trace trace-3 before sending: delivery backlog full."
    )


def test_still_queued_counts_the_deliveries_and_the_moment():
    assert (
        off_loop._still_queued(1, "flush")
        == "before sending: 1 delivery still queued at flush"
    )
    assert (
        off_loop._still_queued(3, "exit")
        == "before sending: 3 deliveries still queued at exit"
    )


def test_the_drain_deadline_is_one_delivery_worst_case():
    # 3 attempts x 10 s timeout + 2 retries x 2 s longest backoff.
    assert off_loop.OFF_LOOP_DRAIN_DEADLINE_SECONDS == 34.0


def test_flush_stops_at_the_deadline_and_reports_unstarted_deliveries(
    one_worker_pools, monkeypatch, caplog
):
    monkeypatch.setattr(off_loop, "OFF_LOOP_DRAIN_DEADLINE_SECONDS", 0.2)
    in_flight, release, ran_in_flight = _gated()
    queued_ran = []

    off_loop._fire_and_forget.submit(in_flight, "trace-a")
    off_loop._fire_and_forget.submit(lambda: queued_ran.append("b"), "trace-b")
    off_loop._fire_and_forget.submit(lambda: queued_ran.append("c"), "trace-c")

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


def _recorded_drops(monkeypatch) -> list[tuple[str, str, int]]:
    reports = []
    monkeypatch.setattr(
        off_loop,
        "report_dropped_trace",
        lambda trace_id, cause, count=1: reports.append((trace_id, cause, count)),
    )
    return reports


def _queue_behind_one_in_flight(monkeypatch, queued: int):
    """A single-worker fire-and-forget pool: one delivery held in flight and
    ``queued`` waiting behind it."""
    monkeypatch.setattr(off_loop, "_fire_and_forget", off_loop._Pool(1, "uselemma-delivery"))
    in_flight, release, _ran = _gated()
    queued_ran = []
    off_loop._fire_and_forget.submit(in_flight, "trace-a")
    for index in range(queued):
        off_loop._fire_and_forget.submit(
            lambda index=index: queued_ran.append(index), f"trace-q{index}"
        )
    return release, queued_ran


def test_overlapping_flushes_report_each_dropped_delivery_once(monkeypatch):
    monkeypatch.setattr(off_loop, "OFF_LOOP_DRAIN_DEADLINE_SECONDS", 0.3)
    reports = _recorded_drops(monkeypatch)
    release, queued_ran = _queue_behind_one_in_flight(monkeypatch, 5)

    first = threading.Thread(target=off_loop.wait_pending)
    second = threading.Thread(target=off_loop.wait_pending)
    first.start()
    # The second flush snapshots the queued deliveries before the first cuts them.
    time.sleep(0.1)
    second.start()
    first.join()
    second.join()
    release.set()

    assert queued_ran == []
    assert reports == [
        ("trace-q0", "before sending: 5 deliveries still queued at flush", 5)
    ]


async def test_overlapping_async_flushes_report_each_dropped_delivery_once(monkeypatch):
    monkeypatch.setattr(off_loop, "OFF_LOOP_DRAIN_DEADLINE_SECONDS", 0.3)
    reports = _recorded_drops(monkeypatch)
    release, queued_ran = _queue_behind_one_in_flight(monkeypatch, 5)

    first = asyncio.create_task(off_loop.await_pending())
    await asyncio.sleep(0.1)
    second = asyncio.create_task(off_loop.await_pending())
    await asyncio.wait_for(asyncio.gather(first, second), 5)
    release.set()

    assert queued_ran == []
    assert reports == [
        ("trace-q0", "before sending: 5 deliveries still queued at flush", 5)
    ]


def test_exit_stops_at_the_deadline_and_reports_unstarted_deliveries():
    script = textwrap.dedent(
        """
        import time
        from uselemma_tracing import off_loop

        off_loop._fire_and_forget = off_loop._Pool(1, "uselemma-delivery")
        off_loop.OFF_LOOP_DRAIN_DEADLINE_SECONDS = 0.2
        for index in range(4):
            off_loop._fire_and_forget.submit(lambda: time.sleep(1), f"trace-{index}")
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


def test_a_forked_child_starts_with_empty_pools():
    job, release, _ran = _gated()
    awaited_job, release_awaited, _awaited_ran = _gated()
    off_loop._fire_and_forget.submit(job, "trace-1")
    off_loop._awaited.submit(awaited_job, "trace-2")

    off_loop._reset()

    for pool in (off_loop._fire_and_forget, off_loop._awaited):
        assert pool.executor is None
        assert pool.pending == {}
    release.set()
    release_awaited.set()
    off_loop._fire_and_forget.submit(lambda: None, "trace-3")
    off_loop.wait_pending()


def test_the_exit_drain_also_cuts_queued_awaited_deliveries(
    one_worker_pools, monkeypatch, caplog
):
    monkeypatch.setattr(off_loop, "OFF_LOOP_DRAIN_DEADLINE_SECONDS", 0.2)
    in_flight, release, _ran = _gated()
    queued_ran = []

    off_loop._awaited.submit(in_flight, "trace-a")
    off_loop._awaited.submit(lambda: queued_ran.append("b"), "trace-b")
    off_loop._drain_at_exit()
    release.set()

    assert queued_ran == []
    [warning] = _lemma_warnings(caplog)
    assert warning.startswith(
        "uselemma-tracing: dropped trace trace-b before sending: 1 delivery still "
        "queued at exit."
    )


async def test_run_awaited_runs_on_the_awaited_pool_in_the_callers_context():
    request_id = contextvars.ContextVar("request_id")
    request_id.set("req-1")
    seen = []

    await off_loop.run_awaited(
        lambda: seen.append((threading.current_thread().name, request_id.get())),
        "trace-1",
    )

    [(thread_name, value)] = seen
    assert thread_name.startswith("uselemma-awaited-delivery")
    assert value == "req-1"


def test_submit_runs_the_job_in_the_submitting_threads_context():
    request_id = contextvars.ContextVar("request_id")
    request_id.set("req-1")
    seen = []

    off_loop._fire_and_forget.submit(lambda: seen.append(request_id.get(None)), "trace-1")
    off_loop.wait_pending()

    assert seen == ["req-1"]


async def test_await_pending_waits_for_queued_jobs_without_blocking_the_loop():
    job, release, ran = _gated()
    off_loop._fire_and_forget.submit(job, "trace-1")

    flush = asyncio.create_task(off_loop.await_pending())
    # The loop keeps running while the queued job holds the wait open.
    await asyncio.sleep(0.05)
    assert not flush.done()
    assert ran == []
    release.set()
    await asyncio.wait_for(flush, 5)

    assert len(ran) == 1
