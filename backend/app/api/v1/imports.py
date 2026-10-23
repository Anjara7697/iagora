from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.api.dependencies import CAN_WRITE, CurrentUser, DbSession
from app.schemas.leads import ImportReport
from app.services import prospect_import

router = APIRouter(prefix="/prospects", tags=["prospects"], dependencies=[CAN_WRITE])


@router.post("/import", response_model=ImportReport)
async def import_prospects(
    session: DbSession,
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="Fichier CSV (2 Mo, 5000 lignes maximum)")],
    dry_run: Annotated[bool, Form()] = True,
    campaign_id: Annotated[int | None, Form()] = None,
    source_id: Annotated[int | None, Form()] = None,
    target_code: Annotated[str | None, Form()] = None,
    consent: Annotated[bool, Form()] = False,
) -> ImportReport:
    """Aperçu (`dry_run`, par défaut) ou import. Déduplication comme pour toute réception ;
    les prospects importés ne déclenchent pas l'agent."""
    raw = await file.read(prospect_import.MAX_BYTES + 1)
    return await prospect_import.run_import(
        session,
        raw,
        dry_run=dry_run,
        campaign_id=campaign_id,
        source_id=source_id,
        target_code=target_code or None,
        consent=consent,
        consent_source=f"import CSV {file.filename or ''} par {user.username}",
    )
