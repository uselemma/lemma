from uselemma_tracing.reply_text import read_content_reply


def test_read_content_reply_keeps_text_and_skips_reasoning():
    assert read_content_reply(
        [
            {"type": "reasoning", "encrypted_content": "gAAAA-secret-blob"},
            {"type": "output_text", "text": "It arrives Friday."},
            {"type": "text", "text": "Ships Friday."},
        ]
    ) == (["It arrives Friday.", "Ships Friday."], True)


def test_read_content_reply_recognizes_reasoning_only():
    assert read_content_reply(
        [{"type": "reasoning", "text": "checking the shipment"}]
    ) == ([], True)


def test_read_content_reply_ignores_unrelated_blocks():
    assert read_content_reply([{"type": "tool-call", "name": "lookup"}]) == ([], False)
    assert read_content_reply("plain") is None
