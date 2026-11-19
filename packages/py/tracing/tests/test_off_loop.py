from __future__ import annotations

import threading

from uselemma_tracing import off_loop


def _gated():
    """A job that runs until ``release`` is set, recording the thread it ran on."""
    release = threading.Event()
    ran = []

    def job():
        release.wait(timeout=5)
        ran.append(threading.get_ident())

    return job, release, ran


def test_on_event_loop_thread_is_false_without_a_running_loop():
    assert not off_loop.on_event_loop_thread()


async def test_on_event_loop_thread_is_true_on_a_running_loop():
    assert off_loop.on_event_loop_thread()


def test_wait_pending_returns_once_queued_jobs_finish():
    job, release, ran = _gated()

    assert off_loop.submit(job)
    threading.Timer(0.05, release.set).start()
    off_loop.wait_pending()

    assert len(ran) == 1
    assert ran[0] != threading.get_ident()


def test_submit_refuses_a_job_past_the_backlog_cap(monkeypatch):
    monkeypatch.setattr(off_loop, "OFF_LOOP_MAX_BACKLOG", 2)
    first, release_first, ran_first = _gated()
    second, release_second, ran_second = _gated()
    refused = []

    assert off_loop.submit(first)
    assert off_loop.submit(second)
    assert not off_loop.submit(lambda: refused.append(True))

    release_first.set()
    release_second.set()
    off_loop.wait_pending()

    assert refused == []
    assert ran_first and ran_second
    assert off_loop.submit(lambda: None)


def test_a_forked_child_starts_with_an_empty_pool():
    job, release, _ran = _gated()
    assert off_loop.submit(job)

    off_loop._reset_in_child()

    assert off_loop._executor is None
    assert off_loop._pending == set()
    release.set()
    assert off_loop.submit(lambda: None)
    off_loop.wait_pending()
