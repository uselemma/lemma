from uselemma_tracing.model import (
    pick_generation_model_identity,
    pick_model_identity,
)


def test_pick_model_identity_empty():
    assert pick_model_identity(None) is None
    assert pick_model_identity({}) is None
    assert pick_model_identity("") is None
    assert pick_model_identity("   ") is None
    assert pick_model_identity("gpt-4o") is None
    assert pick_model_identity("It arrives Friday.") is None


def test_pick_model_identity_aliases():
    assert pick_model_identity({"model": "gpt-4o"}) == "gpt-4o"
    assert pick_model_identity({"model_name": "gpt-4o-mini"}) == "gpt-4o-mini"
    assert pick_model_identity({"modelName": "claude-3"}) == "claude-3"
    assert pick_model_identity({"model_id": "o3"}) == "o3"
    assert pick_model_identity({"modelId": "gpt-4.1"}) == "gpt-4.1"
    assert pick_model_identity({"ls_model_name": "gpt-4o"}) == "gpt-4o"


def test_pick_model_identity_nested_response_metadata():
    assert (
        pick_model_identity({"response_metadata": {"model_name": "gpt-4o-mini"}})
        == "gpt-4o-mini"
    )
    assert (
        pick_model_identity({"model": {"modelId": "gpt-4o", "provider": "openai"}})
        == "gpt-4o"
    )


def test_pick_model_identity_ignores_message_response_and_text_strings():
    assert pick_model_identity({"message": "hello"}) is None
    assert pick_model_identity({"response": "hello"}) is None
    assert pick_model_identity({"text": "It arrives Friday."}) is None
    assert pick_model_identity({"role": "assistant", "content": "hello"}) is None


class _FakeAIMessage:
    def __init__(self, content: str, model_name: str) -> None:
        self.content = content
        self.type = "ai"
        self.response_metadata = {"model_name": model_name}


def test_pick_generation_model_identity_from_response_metadata():
    assert (
        pick_generation_model_identity(
            {
                "generations": [
                    [
                        {
                            "text": "hello",
                            "message": _FakeAIMessage("hello", "gpt-4o-mini"),
                        }
                    ]
                ]
            }
        )
        == "gpt-4o-mini"
    )


def test_pick_generation_model_identity_prefers_top_level():
    assert (
        pick_generation_model_identity(
            {
                "model": "gpt-4o",
                "generations": [
                    [{"message": {"response_metadata": {"model_name": "other"}}}]
                ],
            }
        )
        == "gpt-4o"
    )


def test_pick_generation_model_identity_ignores_text_and_string_messages():
    assert (
        pick_generation_model_identity(
            {"generations": [[{"text": "It arrives Friday.", "message": "hello"}]]}
        )
        is None
    )
