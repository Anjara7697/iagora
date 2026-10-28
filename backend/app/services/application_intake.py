"""Repérer les candidatures annoncées dans les emails et dossiers lisibles.

Les indices suggèrent un examen humain ; ils ne constituent jamais une admission.
"""

import asyncio
import io
import re
import shutil
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.email.base import InboundEmail
from app.models import Campaign, CampaignTarget, Target
from app.models.enums import CampaignStatus

MAX_PAGES = 5
MAX_DOCUMENT_TEXT = 10_000
OCR_TIMEOUT_SECONDS = 15
OCR_IMAGE_SIZE = 1600
APPLICATION = re.compile(
    r"\b(?:candidature|dossier\s+d['’ ]?inscription|formulaire\s+d['’ ]?inscription|"
    r"depose\s+(?:mon|un)\s+dossier|envoye\s+(?:mon|un)\s+dossier)\b"
)


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(c for c in value if not unicodedata.combining(c))


@dataclass(frozen=True)
class DocumentEvidence:
    filename: str
    text: str
    note: str


def _ocr_image(payload: bytes) -> str:
    executable = shutil.which("tesseract")
    if executable is None:
        return ""
    result = subprocess.run(  # noqa: S603 - chemin du binaire résolu, sans shell
        [executable, "stdin", "stdout", "-l", "fra+eng"],
        input=payload,
        capture_output=True,
        timeout=OCR_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", "replace")[:MAX_DOCUMENT_TEXT]


def _ocr_pdf_page(pdf: Path, page_number: int, directory: Path) -> str:
    executable = shutil.which("pdftoppm")
    if executable is None:
        return ""
    output = directory / f"page-{page_number}"
    result = subprocess.run(  # noqa: S603 - chemin du binaire résolu, sans shell
        [
            executable,
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-singlefile",
            "-scale-to",
            str(OCR_IMAGE_SIZE),
            "-png",
            str(pdf),
            str(output),
        ],
        capture_output=True,
        timeout=OCR_TIMEOUT_SECONDS,
        check=False,
    )
    image = output.with_suffix(".png")
    if result.returncode != 0 or not image.exists():
        return ""
    try:
        return _ocr_image(image.read_bytes())
    finally:
        image.unlink(missing_ok=True)


def document_evidence(mail: InboundEmail) -> list[DocumentEvidence]:
    """Lit les pièces bornées ; les résultats OCR restent des indices à vérifier."""
    found = []
    for name, kind, payload in mail.attachments:
        if kind == "text/plain":
            content = payload.decode("utf-8", "replace")[:MAX_DOCUMENT_TEXT]
            found.append(DocumentEvidence(name, content, "Texte lu"))
        elif kind in {"image/png", "image/jpeg"}:
            try:
                content = _ocr_image(payload)
            except (OSError, subprocess.TimeoutExpired):
                content = ""
            note = "OCR à vérifier" if content.strip() else "Image non lue : à vérifier"
            found.append(DocumentEvidence(name, content, note))
        elif kind == "application/pdf":
            try:
                reader = PdfReader(io.BytesIO(payload), strict=False)
                if reader.is_encrypted:
                    found.append(DocumentEvidence(name, "", "PDF protégé : à vérifier"))
                    continue
                pages = [
                    (index, page.extract_text() or "")
                    for index, page in enumerate(reader.pages[:MAX_PAGES], 1)
                ]
                used_ocr = False
                if any(not page_text.strip() for _, page_text in pages):
                    try:
                        with tempfile.TemporaryDirectory(prefix="iagora-ocr-") as directory:
                            root = Path(directory)
                            pdf = root / "document.pdf"
                            pdf.write_bytes(payload)
                            for position, (index, page_text) in enumerate(pages):
                                if not page_text.strip():
                                    pages[position] = (index, _ocr_pdf_page(pdf, index, root))
                                    used_ocr |= bool(pages[position][1].strip())
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                content = "\n".join(page_text for _, page_text in pages)
                found.append(
                    DocumentEvidence(
                        name,
                        content[:MAX_DOCUMENT_TEXT],
                        ("OCR à vérifier" if used_ocr else "Texte lu")
                        if content.strip()
                        else "PDF sans texte : à vérifier",
                    )
                )
            except (PdfReadError, ValueError, OSError, KeyError):
                found.append(DocumentEvidence(name, "", "PDF illisible : à vérifier"))
    return found


async def suggest_campaigns(session: AsyncSession, text: str) -> list[str]:
    """Correspondance explicite avec les cibles des campagnes actives, sans classement opaque."""
    rows = await session.execute(
        select(Campaign.name, Target.name, Target.code)
        .join(CampaignTarget, CampaignTarget.campaign_id == Campaign.id)
        .join(Target, Target.id == CampaignTarget.target_id)
        .where(Campaign.status == CampaignStatus.ACTIVE)
    )
    haystack = normalized(text)
    return sorted(
        {
            name
            for name, target, code in rows
            if normalized(target) in haystack
            or any(len(token) >= 5 and token in haystack for token in normalized(code).split("_"))
        }
    )


async def review_sheet(
    session: AsyncSession,
    mail: InboundEmail,
    evidence: list[DocumentEvidence] | None = None,
) -> dict[str, str] | None:
    if mail.suspect:
        return None
    if evidence is None:
        evidence = await asyncio.to_thread(document_evidence, mail)
    text = "\n".join([mail.subject, mail.text, *(d.text for d in evidence)])
    if not APPLICATION.search(normalized(text)):
        return None
    other_emails = sorted(
        {address.casefold() for address in re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)}
        - {mail.from_address.casefold()}
    )
    campaigns = await suggest_campaigns(session, text)
    documents = ", ".join(f"{d.filename} ({d.note})" for d in evidence) or "aucun document lisible"
    excerpt = next((" ".join(d.text.split())[:180] for d in evidence if d.text.strip()), "")
    other_addresses = ", ".join(other_emails) if other_emails else "aucune"
    reason = (
        f"Message de {mail.from_address}. Documents : {documents}. "
        f"Extrait du dossier : {excerpt or 'indisponible'}. "
        f"Campagne suggérée : {campaigns[0] if len(campaigns) == 1 else 'à choisir'}. "
        f"Autres adresses dans le dossier : {other_addresses}. "
        "Vérifier la pièce dans la boîte email, l'identité, la campagne et la réception du dossier."
    )
    return {
        "reason": "candidature_a_verifier",
        "summary": reason[:1500],
        "pending_question": mail.text[:500] or mail.subject[:300],
        "recommended_action": "Vérifier le dossier et confirmer la candidature",
    }
