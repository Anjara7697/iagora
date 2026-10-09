from app.config import Settings


def test_defaults_are_safe():
    s = Settings(_env_file=None)
    assert s.environment == "development"
    assert s.openai_api_key is None
