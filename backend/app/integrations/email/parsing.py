"""Lecture d'un email reçu : expéditeur, texte utile, détection des messages automatiques.

Le contenu d'un email est une donnée NON FIABLE (hameçonnage, injection d'instructions) :
le texte et les pièces prises en charge sont bornés en taille ; aucun lien n'est suivi.
"""

import hashlib
import re
from datetime import UTC, datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser

from app.integrations.email.base import InboundEmail

MAX_TEXT = 10_000
MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
MAX_ATTACHMENTS = 3
_AUTOMATIC_SENDERS = re.compile(
    r"(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce|notifications?@)", re.I
)
_AUTOMATIC_SUBJECTS = re.compile(
    r"^(out of office|réponse automatique|automatic reply|auto:|undeliverable|"
    r"delivery status|failure notice|mail delivery)",
    re.I,
)
_QUOTE_STARTS = [
    re.compile(r"^le .{5,200}(a écrit|wrote)\s*:?\s*$", re.I),
    re.compile(r"^on .{5,200}wrote\s*:?\s*$", re.I),
    re.compile(r"^-{2,}\s*(message d.origine|original message|forwarded message)", re.I),
    re.compile(r"^_{5,}\s*$"),
    re.compile(r"^(de|from)\s*:.*$", re.I),  # en-tête d'un message cité
]


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._skip += 1
        if tag in {"br", "p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self._skip = max(0, self._skip - 1)

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _Text()
    parser.feed(html)
    return re.sub(r"\n{3,}", "\n\n", "".join(parser.parts)).strip()


def strip_quoted(text: str) -> str:
    """Garde ce que le prospect vient d'écrire : coupe la citation de la conversation précédente."""
    kept: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if stripped.startswith(">"):
            continue
        if any(p.match(stripped) for p in _QUOTE_STARTS) and kept:
            break
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def _body_text(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except (LookupError, UnicodeDecodeError):
        return ""
    text = str(content)
    return html_to_text(text) if part.get_content_type() == "text/html" else text


def is_automatic(msg: EmailMessage, address: str, subject: str) -> bool:
    auto = str(msg.get("Auto-Submitted", "no")).strip().lower()
    precedence = str(msg.get("Precedence", "")).strip().lower()
    return (
        auto not in {"", "no"}
        or precedence in {"bulk", "junk", "list", "auto_reply"}
        or msg.get("X-Autoreply") is not None
        or msg.get("X-Auto-Response-Suppress") is not None
        or bool(_AUTOMATIC_SENDERS.search(address))
        or bool(_AUTOMATIC_SUBJECTS.match(subject.strip()))
    )


def parse_inbound(uid: str, raw: bytes, *, now: datetime | None = None) -> InboundEmail:
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    assert isinstance(msg, EmailMessage)  # noqa: S101 - garanti par policy.default
    name, address = parseaddr(str(msg.get("From", "")))
    address = address.strip().lower()
    subject = " ".join(str(msg.get("Subject", "")).split())[:300]
    message_id = str(msg.get("Message-ID", "")).strip()
    if not message_id:  # rare : on fabrique un identifiant stable à partir du contenu
        message_id = f"<sha256-{hashlib.sha256(raw).hexdigest()[:32]}@local>"
    try:
        received = parsedate_to_datetime(str(msg.get("Date"))) if msg.get("Date") else None
    except (TypeError, ValueError):
        received = None
    references = str(msg.get("References", "")).split()
    results = str(msg.get("Authentication-Results", "")).lower()
    text = strip_quoted(_body_text(msg))[:MAX_TEXT]
    attachments: list[tuple[str, str, bytes]] = []
    for part in msg.iter_attachments():
        if len(attachments) >= MAX_ATTACHMENTS:
            break
        filename = (part.get_filename() or "document")[:120]
        kind = part.get_content_type()
        if kind not in {"application/pdf", "text/plain", "image/png", "image/jpeg"}:
            continue
        payload = part.get_payload(decode=True)
        if isinstance(payload, bytes) and len(payload) <= MAX_ATTACHMENT_BYTES:
            attachments.append((filename, kind, payload))
    return InboundEmail(
        uid=uid,
        message_id=message_id,
        from_address=address,
        from_name=" ".join(name.split())[:150],
        subject=subject,
        text=text,
        received_at=(received or now or datetime.now(UTC)).astimezone(UTC),
        in_reply_to=str(msg.get("In-Reply-To", "")).strip() or None,
        references=references[-20:],
        is_automatic=is_automatic(msg, address, subject),
        suspect="dmarc=fail" in results,
        attachments=attachments,
    )
