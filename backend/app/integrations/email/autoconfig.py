"""Détection des serveurs IMAP/SMTP à partir d'une adresse email.

Ordre : fournisseur connu (domaine), hébergeur reconnu par ses serveurs MX (domaines
personnalisés : OVH, IONOS, Google Workspace, Microsoft 365…), base publique de Thunderbird
(ISPDB), puis paramètres devinés. L'administrateur peut toujours corriger avant d'enregistrer.
"""

import logging
import xml.etree.ElementTree as ET  # noqa: S405 - réponse bornée en taille, sans DTD
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)
TIMEOUT = 5.0
MAX_XML = 64_000


@dataclass(frozen=True)
class Detected:
    provider: str | None
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    smtp_security: str
    source: str  # preset | mx | ispdb | guess
    note: str | None = None


APP_PASSWORD = "Utilisez un « mot de passe d'application » (validation en deux étapes requise)."  # noqa: S105
_P = {
    "ovh": ("OVHcloud", "ssl0.ovh.net", 993, "ssl0.ovh.net", 587, "starttls", None),
    "ionos_fr": ("IONOS", "imap.ionos.fr", 993, "smtp.ionos.fr", 587, "starttls", None),
    "ionos_de": ("IONOS", "imap.ionos.de", 993, "smtp.ionos.de", 587, "starttls", None),
    "ionos_com": ("IONOS", "imap.ionos.com", 993, "smtp.ionos.com", 587, "starttls", None),
    "google": (
        "Google (Gmail / Workspace)",
        "imap.gmail.com", 993, "smtp.gmail.com", 587, "starttls", APP_PASSWORD,
    ),
    "microsoft": (
        "Microsoft 365 / Outlook",
        "outlook.office365.com", 993, "smtp.office365.com", 587, "starttls",
        "Microsoft refuse souvent la connexion par mot de passe : si le test échoue, la boîte "
        "devra être connectée par OAuth (prochain lot).",
    ),
    "gandi": ("Gandi", "mail.gandi.net", 993, "mail.gandi.net", 587, "starttls", None),
    "hostinger": ("Hostinger", "imap.hostinger.com", 993, "smtp.hostinger.com", 465, "ssl", None),
    "zoho": ("Zoho Mail", "imap.zoho.eu", 993, "smtp.zoho.eu", 465, "ssl", None),
    "infomaniak": (
        "Infomaniak", "mail.infomaniak.com", 993, "mail.infomaniak.com", 465, "ssl", None
    ),
    "orange": ("Orange", "imap.orange.fr", 993, "smtp.orange.fr", 465, "ssl", None),
    "free": ("Free", "imap.free.fr", 993, "smtp.free.fr", 465, "ssl", None),
    "sfr": ("SFR", "imap.sfr.fr", 993, "smtp.sfr.fr", 465, "ssl", None),
    "laposte": ("La Poste", "imap.laposte.net", 993, "smtp.laposte.net", 465, "ssl", None),
    "yahoo": (
        "Yahoo", "imap.mail.yahoo.com", 993, "smtp.mail.yahoo.com", 465, "ssl", APP_PASSWORD
    ),
    "icloud": (
        "iCloud", "imap.mail.me.com", 993, "smtp.mail.me.com", 587, "starttls", APP_PASSWORD
    ),
}  # fmt: skip
_DOMAINS = {
    "gmail.com": "google", "googlemail.com": "google",
    "outlook.com": "microsoft", "outlook.fr": "microsoft", "hotmail.com": "microsoft",
    "hotmail.fr": "microsoft", "live.com": "microsoft", "live.fr": "microsoft",
    "msn.com": "microsoft",
    "orange.fr": "orange", "wanadoo.fr": "orange", "free.fr": "free", "sfr.fr": "sfr",
    "neuf.fr": "sfr", "laposte.net": "laposte", "yahoo.fr": "yahoo", "yahoo.com": "yahoo",
    "icloud.com": "icloud", "me.com": "icloud", "mac.com": "icloud",
}  # fmt: skip
# Fragment du nom des serveurs MX -> hébergeur (domaines personnalisés).
_MX = [
    ("ovh.net", "ovh"), ("ionos.fr", "ionos_fr"), ("ionos.de", "ionos_de"),
    ("kundenserver.de", "ionos_de"), ("ionos.com", "ionos_com"), ("1and1", "ionos_com"),
    ("google.com", "google"), ("googlemail.com", "google"), ("outlook.com", "microsoft"),
    ("gandi.net", "gandi"), ("hostinger", "hostinger"), ("zoho", "zoho"),
    ("infomaniak", "infomaniak"),
]  # fmt: skip


def _preset(key: str, source: str) -> Detected:
    name, ih, ip, sh, sp, sec, note = _P[key]
    return Detected(name, ih, ip, sh, sp, sec, source, note)


def provider_for_mx(hosts: list[str]) -> str | None:
    for host in hosts:
        h = host.lower().rstrip(".")
        for fragment, key in _MX:
            if fragment in h:
                return key
    return None


async def _mx_hosts(http: httpx.AsyncClient, domain: str) -> list[str]:
    """Serveurs MX par DNS sur HTTPS (aucune dépendance DNS supplémentaire)."""
    r = await http.get("https://dns.google/resolve", params={"name": domain, "type": "MX"})
    if r.status_code != 200:
        return []
    answers = r.json().get("Answer") or []
    return [str(a.get("data", "")).split()[-1] for a in answers if a.get("type") == 15]


def parse_ispdb(xml: str, domain: str) -> Detected | None:
    root = ET.fromstring(xml)  # noqa: S314 - XML borné, entités externes non résolues
    imap = root.find(".//incomingServer[@type='imap']")
    smtps = root.findall(".//outgoingServer[@type='smtp']")
    if imap is None or not smtps:
        return None

    def text(node: ET.Element, tag: str) -> str:
        return (node.findtext(tag) or "").replace("%EMAILDOMAIN%", domain).strip()

    smtp = next((s for s in smtps if text(s, "socketType") == "STARTTLS"), smtps[0])
    name = root.findtext(".//displayShortName") or root.findtext(".//displayName")
    return Detected(
        provider=name,
        imap_host=text(imap, "hostname"),
        imap_port=int(text(imap, "port") or 993),
        smtp_host=text(smtp, "hostname"),
        smtp_port=int(text(smtp, "port") or 587),
        smtp_security="starttls" if text(smtp, "socketType") == "STARTTLS" else "ssl",
        source="ispdb",
    )


async def _ispdb(http: httpx.AsyncClient, domain: str) -> Detected | None:
    r = await http.get(f"https://autoconfig.thunderbird.net/v1.1/{domain}")
    if r.status_code != 200 or len(r.content) > MAX_XML:
        return None
    return parse_ispdb(r.text, domain)


async def detect(address: str, http: httpx.AsyncClient | None = None) -> Detected:
    domain = address.rsplit("@", 1)[-1].strip().lower()
    if domain in _DOMAINS:
        return _preset(_DOMAINS[domain], "preset")
    client = http or httpx.AsyncClient(timeout=TIMEOUT)
    try:
        try:
            key = provider_for_mx(await _mx_hosts(client, domain))
            if key:
                return _preset(key, "mx")
        except (httpx.HTTPError, ValueError):
            logger.info("Détection MX impossible pour %s", domain)
        try:
            found = await _ispdb(client, domain)
            if found:
                return found
        except (httpx.HTTPError, ValueError, ET.ParseError):
            logger.info("ISPDB indisponible pour %s", domain)
    finally:
        if http is None:
            await client.aclose()
    return Detected(
        None, f"imap.{domain}", 993, f"smtp.{domain}", 587, "starttls", "guess",
        "Paramètres devinés : à vérifier auprès de l'hébergeur de la boîte.",
    )  # fmt: skip
