"""Audit I2 : le jour de fin d'une campagne est inclus, en heure de Paris."""

from datetime import UTC, datetime

from app.agents.gateway import _live_brief, campaign_ended

END = datetime(2026, 12, 15, tzinfo=UTC)  # « jusqu'au 15 décembre », enregistré par la console


def test_the_campaign_runs_until_the_end_of_its_last_day_in_paris():
    assert not campaign_ended(END, now=datetime(2026, 12, 15, 1, 0, tzinfo=UTC))
    assert not campaign_ended(END, now=datetime(2026, 12, 15, 22, 30, tzinfo=UTC))  # 23 h 30
    assert campaign_ended(END, now=datetime(2026, 12, 15, 23, 30, tzinfo=UTC))  # 16 déc. 0 h 30
    assert campaign_ended(END.replace(tzinfo=None), now=datetime(2026, 12, 17, tzinfo=UTC))


def test_the_brief_is_given_on_the_last_day_and_not_after():
    brief = {"key_dates": "Date limite : 15 décembre"}
    assert _live_brief(brief, None) == brief
    assert _live_brief(brief, datetime(2020, 1, 1, tzinfo=UTC)) == {}
