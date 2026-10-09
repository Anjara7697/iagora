import app.models  # noqa: F401
import pytest
from app.database.base import Base
from app.models import (
    Campaign,
    CampaignProspect,
    CampaignSource,
    Prospect,
    Source,
    StageEvent,
)
from app.models.enums import ConsentStatus, ConversionStage, InterestLevel
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


@pytest.fixture
def session():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


def test_expected_tables_exist():
    expected = {
        "users", "prospects", "targets", "campaigns", "campaign_targets", "sources",
        "campaign_sources", "campaign_prospects", "channels", "prospect_channels",
        "conversations", "messages", "interactions", "score_events", "follow_ups",
        "appointments", "consent_events", "stage_events",
    }  # fmt: skip
    assert expected <= set(Base.metadata.tables)


def test_cdc_enumerations():
    assert len(ConversionStage) == 12  # F-13
    assert {m.value for m in InterestLevel} == {"cold", "warm", "hot", "very_hot"}  # F-12


def test_new_prospect_has_unknown_consent(session):
    p = Prospect(email="a@example.com")
    session.add(p)
    session.commit()
    assert p.consent_status == ConsentStatus.UNKNOWN
    assert p.opted_out_at is None
    assert p.profile == {}


def test_email_unique_case_insensitive(session):
    session.add(Prospect(email="Jean@Example.com"))
    session.commit()
    session.add(Prospect(email="jean@example.COM"))
    with pytest.raises(IntegrityError):
        session.commit()


def test_prospects_without_email_do_not_collide(session):
    session.add_all([Prospect(phone="1"), Prospect(phone="2")])
    session.commit()
    assert len(session.scalars(select(Prospect)).all()) == 2


def test_prospect_attached_once_per_campaign_source(session):
    camp = Campaign(name="Recrutement eBIHAR 2026")
    src = Source(name="LinkedIn", type="ads", platform="linkedin")
    p = Prospect(email="a@example.com")
    session.add_all([camp, src, p])
    session.flush()
    cs = CampaignSource(campaign_id=camp.id, source_id=src.id)
    session.add(cs)
    session.flush()
    session.add(CampaignProspect(campaign_source_id=cs.id, prospect_id=p.id))
    session.commit()
    session.add(CampaignProspect(campaign_source_id=cs.id, prospect_id=p.id))
    with pytest.raises(IntegrityError):
        session.commit()


def test_invalid_stage_rejected(session):
    camp = Campaign(name="c")
    src = Source(name="s", type="form", platform="web")
    p = Prospect()
    session.add_all([camp, src, p])
    session.flush()
    cs = CampaignSource(campaign_id=camp.id, source_id=src.id)
    session.add(cs)
    session.flush()
    cp = CampaignProspect(campaign_source_id=cs.id, prospect_id=p.id)
    session.add(cp)
    session.commit()
    with pytest.raises(IntegrityError):  # CHECK sur les valeurs de l'énumération
        session.execute(
            Base.metadata.tables["stage_events"]
            .insert()
            .values(campaign_prospect_id=cp.id, to_stage="invalid")
        )


def test_deleting_prospect_erases_dependent_data(session):
    """Droit à l'effacement (S-02)."""
    camp = Campaign(name="c")
    src = Source(name="s", type="form", platform="web")
    p = Prospect(email="a@example.com")
    session.add_all([camp, src, p])
    session.flush()
    cs = CampaignSource(campaign_id=camp.id, source_id=src.id)
    session.add(cs)
    session.flush()
    cp = CampaignProspect(campaign_source_id=cs.id, prospect_id=p.id)
    session.add(cp)
    session.flush()
    session.add(StageEvent(campaign_prospect_id=cp.id, to_stage=ConversionStage.NEW))
    session.commit()

    session.delete(p)
    session.commit()
    assert session.scalars(select(CampaignProspect)).all() == []
    assert session.scalars(select(StageEvent)).all() == []
