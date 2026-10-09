import pytest
from app.models.enums import InterestLevel, ScoreType, ScoringSignal
from app.services import scoring


def test_total_is_weighted_average_clamped():
    assert scoring.compute_total(0, 0) == 0
    assert scoring.compute_total(100, 100) == 100
    assert scoring.compute_total(30, 0) == 18  # 0,6 x 30
    assert scoring.compute_total(50, 50) == 50
    assert scoring.compute_total(1000, 1000) == 100  # plafonné
    assert scoring.clamp(-5) == 0 and scoring.clamp(130) == 100


@pytest.mark.parametrize(
    ("total", "level"),
    [
        (0, InterestLevel.COLD),
        (24, InterestLevel.COLD),
        (25, InterestLevel.WARM),
        (49, InterestLevel.WARM),
        (50, InterestLevel.HOT),
        (74, InterestLevel.HOT),
        (75, InterestLevel.VERY_HOT),
        (100, InterestLevel.VERY_HOT),
    ],
)
def test_interest_level_thresholds(total, level):
    assert scoring.level_for(total) is level


def test_every_signal_has_a_justified_rule_on_a_real_component():
    assert set(scoring.SIGNAL_RULES) == set(ScoringSignal)
    for score_type, points, reason in scoring.SIGNAL_RULES.values():
        assert score_type in (ScoreType.INTEREST, ScoreType.FIT)
        assert points != 0 and reason.strip()
