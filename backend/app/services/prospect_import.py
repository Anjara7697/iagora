"""Import de prospects depuis un fichier CSV (export Excel, LinkedIn, salon…).

Colonnes reconnues par leur intitulé (prénom, nom, email, téléphone, programme, ville,
entreprise…), séparateur « ; » ou « , », encodage UTF-8 ou Windows. Un aperçu (`dry_run`) valide
chaque ligne et compte les doublons sans rien enregistrer. Les prospects importés ne déclenchent
pas l'agent : aucun message n'est envoyé tant qu'un conseiller ne l'a pas décidé.
"""

import csv
import io
import unicodedata
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.leads import ImportReport, ImportRowError
from app.schemas.prospect import ProspectIngest
from app.services import prospects, references
from app.services.errors import ServiceError, ValidationFailure

MAX_BYTES = 2_000_000
MAX_ROWS = 5000
IGNORED = "(ignorée)"
_SYNONYMS = {
    "first_name": {"prenom", "first name", "firstname", "first_name", "given name"},
    "last_name": {"nom", "last name", "lastname", "last_name", "nom de famille", "family name"},
    "email": {"email", "e-mail", "mail", "courriel", "adresse email", "adresse e-mail"},
    "phone": {"telephone", "tel", "phone", "mobile", "portable", "numero", "phone number"},
    "target_code": {"programme", "target", "target_code", "cible"},
    "external_id": {"id", "external_id", "identifiant"},
    "profile.city": {"ville", "city"},
    "profile.company": {"entreprise", "societe", "company"},
    "profile.education_level": {"niveau", "niveau d'etudes", "diplome"},
}


def _key(header: str) -> str:
    text = unicodedata.normalize("NFKD", header).encode("ascii", "ignore").decode()
    return " ".join(text.lower().replace("_", " ").split()) if text else ""


def map_columns(headers: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    taken: set[str] = set()
    for header in headers:
        key = _key(header)
        field = next((f for f, names in _SYNONYMS.items() if key in {_key(n) for n in names}), None)
        if field and field not in taken:
            mapping[header] = field
            taken.add(field)
        else:
            mapping[header] = IGNORED
    return mapping


def decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValidationFailure("Encodage du fichier non reconnu (UTF-8 ou Windows attendu)")


def read_rows(text: str) -> tuple[list[str], list[dict[str, str]]]:
    sample = text[:5000]
    try:
        dialect: Any = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [h for h in (reader.fieldnames or []) if h is not None]
    rows = []
    for row in reader:
        rows.append({k: (v or "").strip() for k, v in row.items() if k is not None})
        if len(rows) > MAX_ROWS:
            raise ValidationFailure(f"Fichier trop long : {MAX_ROWS} lignes maximum")
    return headers, rows


async def run_import(
    session: AsyncSession,
    raw: bytes,
    *,
    dry_run: bool,
    campaign_id: int | None,
    source_id: int | None,
    target_code: str | None,
    consent: bool,
    consent_source: str,
) -> ImportReport:
    if len(raw) > MAX_BYTES:
        raise ValidationFailure("Fichier trop volumineux (2 Mo maximum)")
    headers, rows = read_rows(decode(raw))
    mapping = map_columns(headers)
    if not {"email", "phone"} & set(mapping.values()):
        raise ValidationFailure("Colonne email ou téléphone introuvable dans l'en-tête du fichier")
    await prospects.check_destination(session, None, campaign_id, source_id, target_code)
    report = ImportReport(dry_run=dry_run, total=len(rows), created=0, existing=0, columns=mapping)
    seen: set[str] = set()
    for number, row in enumerate(rows, start=2):  # ligne 1 : en-tête
        fields: dict[str, Any] = {"profile": {}}
        for header, field in mapping.items():
            value = row.get(header) or None
            if field == IGNORED or value is None:
                continue
            if field.startswith("profile."):
                fields["profile"][field.removeprefix("profile.")] = value
            else:
                fields[field] = value
        row_target = fields.pop("target_code", None)
        try:
            data = ProspectIngest(
                **fields,
                campaign_id=campaign_id,
                source_id=source_id,
                target_code=row_target or target_code,
                consent_granted=True if consent else None,
                consent_source=consent_source[:100] if consent else None,
            )
        except ValidationError as exc:
            error = exc.errors()[0]
            report.invalid.append(
                ImportRowError(row=number, error=f"{error['loc'][-1]} : {error['msg']}")
            )
            continue
        if not data.has_identifier():
            report.invalid.append(ImportRowError(row=number, error="ni email ni téléphone"))
            continue
        identity = data.email or data.phone or ""
        if dry_run:
            try:  # programme inconnu : signalé dès l'aperçu, comme à l'import
                await references.get_target(session, data.target_code)
            except ServiceError as exc:
                report.invalid.append(ImportRowError(row=number, error=str(exc)))
                continue
            if identity in seen or await prospects.find_existing(session, data) is not None:
                report.existing += 1
            else:
                report.created += 1
            seen.add(identity)
            continue
        try:
            _, created, _ = await prospects.ingest_prospect(session, data)
        except ServiceError as exc:
            await session.rollback()
            report.invalid.append(ImportRowError(row=number, error=str(exc)))
            continue
        if created:
            report.created += 1
        else:
            report.existing += 1
    return report
