from app.config import Settings
from app.integrations.email.base import EmailClient
from app.integrations.email.imap_smtp import ImapSmtpClient


def has_credentials(settings: Settings) -> bool:
    return bool(settings.email_username and settings.email_password)


def create_email_client(settings: Settings, *, require_enabled: bool = True) -> EmailClient | None:
    """Client email, ou None si le connecteur est incomplet (ou désactivé, sauf demande contraire :
    l'administrateur peut tester la connexion avant d'activer la boucle de fond)."""
    if not has_credentials(settings) or (require_enabled and not settings.email_enabled):
        return None
    return ImapSmtpClient(settings)
