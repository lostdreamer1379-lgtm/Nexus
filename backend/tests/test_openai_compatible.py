from app.providers.openai_compatible import _new_stream_text


def test_stream_text_preserves_short_numeric_deltas():
    assert _new_stream_text("Price: ₹2,00", "0") == "0"


def test_stream_text_handles_cumulative_snapshots():
    assert _new_stream_text("Price: ₹2,00", "Price: ₹2,000") == "0"


def test_stream_text_removes_a_real_duplicate_overlap():
    assert _new_stream_text("Hello", "Hello world") == " world"


def test_stream_text_does_not_remove_small_legitimate_repetition():
    assert _new_stream_text("Room 2", "2") == "2"
