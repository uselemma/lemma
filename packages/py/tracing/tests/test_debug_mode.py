from __future__ import annotations

import os

from uselemma_tracing import (
    disable_debug_mode,
    enable_debug_mode,
    is_debug_mode_enabled,
)
from uselemma_tracing.debug_mode import _lemma_debug


class TestDebugMode:
    def setup_method(self):
        disable_debug_mode()
        os.environ.pop("LEMMA_DEBUG", None)

    def teardown_method(self):
        disable_debug_mode()
        os.environ.pop("LEMMA_DEBUG", None)

    def test_disabled_by_default(self):
        assert is_debug_mode_enabled() is False

    def test_enable_debug_mode(self):
        enable_debug_mode()
        assert is_debug_mode_enabled() is True

    def test_disable_debug_mode(self):
        enable_debug_mode()
        disable_debug_mode()
        assert is_debug_mode_enabled() is False

    def test_env_var_activates(self):
        os.environ["LEMMA_DEBUG"] = "true"
        assert is_debug_mode_enabled() is True

    def test_env_var_other_value_does_not_activate(self):
        os.environ["LEMMA_DEBUG"] = "1"
        assert is_debug_mode_enabled() is False

    def test_lemma_debug_logs_when_enabled(self, capsys):
        enable_debug_mode()
        _lemma_debug("client", "trace started", run_id="abc")
        out = capsys.readouterr().out
        assert "[LEMMA:client] trace started" in out
        assert "abc" in out

    def test_lemma_debug_logs_without_data(self, capsys):
        enable_debug_mode()
        _lemma_debug("processor", "shutdown called")
        out = capsys.readouterr().out
        assert "[LEMMA:processor] shutdown called" in out

    def test_lemma_debug_silent_when_disabled(self, capsys):
        _lemma_debug("client", "trace started", run_id="abc")
        out = capsys.readouterr().out
        assert out == ""

    def test_debug_verify_enabled_via_env(self):
        os.environ["LEMMA_DEBUG_VERIFY"] = "true"
        from uselemma_tracing.debug_mode import is_debug_verify_enabled

        assert is_debug_verify_enabled() is True
        os.environ.pop("LEMMA_DEBUG_VERIFY", None)
