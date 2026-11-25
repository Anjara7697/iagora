"""Brochure fictive du parcours guidé (D-42) : PDF valide, jointe une seule fois à sa campagne."""

from app.devtools import demo_brochure, runner
from app.services import campaign_files


def test_the_demo_brochure_is_a_valid_pdf_accepted_as_a_campaign_file():
    data = demo_brochure.brochure_pdf()
    assert campaign_files.check_file(data) == "application/pdf"
    assert data.rstrip().endswith(b"%%EOF") and b"FICTIVE" in data
    # La table de références pointe bien sur les objets (un lecteur strict la vérifie).
    xref = int(data.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
    assert data[xref:].startswith(b"xref\n0 6")
    for line in data[xref:].split(b"\n")[3:8]:
        offset = int(line[:10])
        assert data[offset : offset + 7].endswith(b" 0 obj")


async def test_the_brochure_is_attached_once_to_the_guided_campaign_only(session_factory, mongo_db):
    async with session_factory() as session:
        await runner.new_demo_prospect(
            session, mongo_db, label="journey", campaign_name=runner.GUIDED_CAMPAIGN, brochure=True
        )
        await runner.new_demo_prospect(
            session, mongo_db, label="journey", campaign_name=runner.GUIDED_CAMPAIGN, brochure=True
        )
        await runner.new_demo_prospect(
            session, mongo_db, label="evalsim"
        )  # scénarios : sans brochure
        guided, _ = await runner.ensure_demo_campaign(session, runner.GUIDED_CAMPAIGN)
        scenarios, _ = await runner.ensure_demo_campaign(session)
    files = await campaign_files.list_files(mongo_db, guided)
    assert [f["label"] for f in files] == [demo_brochure.LABEL]
    assert await campaign_files.list_files(mongo_db, scenarios) == []
