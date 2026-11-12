import pytest
from app.config import Settings


def test_defaults_are_safe():
    s = Settings(_env_file=None)
    assert s.environment == "development"
    assert s.openai_api_key is None


def test_the_api_refuses_to_start_without_an_explicit_environment(monkeypatch):
    """AUDIT-ARCH-004 : un .env sans ENVIRONMENT ne démarre pas une instance « development »."""
    from app.main import require_explicit_environment

    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(RuntimeError, match="ENVIRONMENT absent"):
        require_explicit_environment(Settings(_env_file=None))
    monkeypatch.setenv("ENVIRONMENT", "development")
    require_explicit_environment(Settings(_env_file=None))  # explicite : accepté
