"""Client email standard : IMAP pour recevoir, SMTP pour envoyer (IONOS, ou tout autre hébergeur).

Les appels réseau de la bibliothèque standard sont bloquants : ils s'exécutent dans un thread.
Les identifiants ne sont jamais journalisés.
"""

import asyncio
import imaplib
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from app.config import Settings
from app.integrations.email.base import EmailError, InboundEmail, OutboundEmail
from app.integrations.email.parsing import parse_inbound

logger = logging.getLogger(__name__)
TIMEOUT = 30


class ImapSmtpClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._password = (
            settings.email_password.get_secret_value() if settings.email_password else ""
        )

    # --- Réception (IMAP) ---

    def _imap(self) -> imaplib.IMAP4_SSL:
        try:
            conn = imaplib.IMAP4_SSL(
                self._s.email_imap_host,
                self._s.email_imap_port,
                ssl_context=ssl.create_default_context(),
                timeout=TIMEOUT,
            )
            conn.login(self._s.email_username, self._password)
            return conn
        except (imaplib.IMAP4.error, OSError) as exc:
            raise EmailError(f"IMAP : connexion impossible ({type(exc).__name__})") from exc

    def _fetch_unseen(self, limit: int) -> list[InboundEmail]:
        conn = self._imap()
        try:
            conn.select(self._s.email_imap_folder)
            status, data = conn.uid("SEARCH", "UNSEEN")
            if status != "OK" or not data or not data[0]:
                return []
            found: list[InboundEmail] = []
            for uid in data[0].split()[:limit]:
                # BODY.PEEK : le message reste « non lu » tant qu'il n'a pas été traité.
                status, parts = conn.uid("FETCH", uid, "(BODY.PEEK[])")
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                found.append(parse_inbound(uid.decode(), parts[0][1]))
            return found
        except imaplib.IMAP4.error as exc:
            raise EmailError(f"IMAP : lecture impossible ({type(exc).__name__})") from exc
        finally:
            _quiet_logout(conn)

    def _mark_seen(self, uid: str) -> None:
        conn = self._imap()
        try:
            conn.select(self._s.email_imap_folder)
            conn.uid("STORE", uid, "+FLAGS", "(\\Seen)")
        except imaplib.IMAP4.error as exc:
            raise EmailError(f"IMAP : marquage impossible ({type(exc).__name__})") from exc
        finally:
            _quiet_logout(conn)

    async def fetch_unseen(self, limit: int = 50) -> list[InboundEmail]:
        return await asyncio.to_thread(self._fetch_unseen, limit)

    async def mark_seen(self, uid: str) -> None:
        await asyncio.to_thread(self._mark_seen, uid)

    # --- Envoi (SMTP) ---

    def _smtp(self) -> smtplib.SMTP:
        context = ssl.create_default_context()
        try:
            if self._s.email_smtp_security == "ssl":
                server: smtplib.SMTP = smtplib.SMTP_SSL(
                    self._s.email_smtp_host,
                    self._s.email_smtp_port,
                    timeout=TIMEOUT,
                    context=context,
                )
            else:
                server = smtplib.SMTP(
                    self._s.email_smtp_host, self._s.email_smtp_port, timeout=TIMEOUT
                )
                server.starttls(context=context)
            server.login(self._s.email_username, self._password)
            return server
        except (smtplib.SMTPException, OSError) as exc:
            raise EmailError(f"SMTP : connexion impossible ({type(exc).__name__})") from exc

    def _build(self, email: OutboundEmail) -> EmailMessage:
        sender = self._s.email_sender_address
        msg = EmailMessage()
        msg["From"] = formataddr((self._s.email_from_name, sender))
        msg["To"] = email.to_address
        msg["Subject"] = email.subject
        msg["Date"] = formatdate(localtime=False)
        msg["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1] or None)
        if email.in_reply_to:
            msg["In-Reply-To"] = email.in_reply_to
        if email.references:
            msg["References"] = " ".join(email.references)
        # Désinscription en un clic pour les clients mail (bonne pratique et conformité, S-03).
        msg["List-Unsubscribe"] = f"<mailto:{sender}?subject=STOP>"
        msg.set_content(email.text)
        return msg

    def _send(self, email: OutboundEmail) -> str:
        msg = self._build(email)
        server = self._smtp()
        try:
            server.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            raise EmailError(f"SMTP : envoi refusé ({type(exc).__name__})") from exc
        finally:
            _quiet_quit(server)
        return str(msg["Message-ID"])

    async def send(self, email: OutboundEmail) -> str:
        return await asyncio.to_thread(self._send, email)

    # --- Diagnostic ---

    def _check(self) -> dict[str, str]:
        result: dict[str, str] = {}
        try:
            _quiet_logout(self._imap())
            result["imap"] = "ok"
        except EmailError as exc:
            result["imap"] = str(exc)
        try:
            _quiet_quit(self._smtp())
            result["smtp"] = "ok"
        except EmailError as exc:
            result["smtp"] = str(exc)
        return result

    async def check(self) -> dict[str, str]:
        return await asyncio.to_thread(self._check)


def _quiet_logout(conn: imaplib.IMAP4_SSL) -> None:
    try:
        conn.logout()
    except (imaplib.IMAP4.error, OSError):
        logger.debug("Fermeture IMAP en erreur (ignorée)")


def _quiet_quit(server: smtplib.SMTP) -> None:
    try:
        server.quit()
    except (smtplib.SMTPException, OSError):
        logger.debug("Fermeture SMTP en erreur (ignorée)")
