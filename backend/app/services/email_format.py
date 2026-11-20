"""Mise en forme des emails sortants : texte brut et HTML, mention IA et désinscription.

Le texte reste la version de référence (`text/plain`) ; la version HTML est une simple mise en page
du même contenu, aux couleurs de l'école. Le corps écrit par l'agent est toujours échappé : aucun
HTML venu d'un modèle ou d'un prospect n'atteint le message.
"""

import html
import re
from dataclasses import dataclass

from app.config import (
    DEFAULT_AI_NOTICE,
    DEFAULT_AI_NOTICE_REVIEWED,
    DEFAULT_BRAND_COLOR,
    DEFAULT_BRAND_NAME,
    Settings,
)

_URL = re.compile(r"https?://[^\s<>\"']+")
_BULLET = re.compile(r"^\s*[-*•]\s+(.+)$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_TRAILING = ".,;:!?)»"
_FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_HEADER = "#0b3a4c"  # bleu nuit du bandeau, sous la couleur de l'école (aperçu DATUM)
_SIGNATURE_BG = "#e8eff3"
_EMAIL = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[a-zA-Z]{2,}$")


@dataclass(frozen=True)
class RenderedEmail:
    text: str
    html: str


def ai_notice(settings: Settings, *, reviewed: bool) -> str:
    """Mention IA (D-32) : « relu par un conseiller » si un conseiller a validé le brouillon,
    sinon celle d'un message parti sans relecture. Jamais vide."""
    if reviewed:
        return settings.email_ai_notice_reviewed.strip() or DEFAULT_AI_NOTICE_REVIEWED
    return settings.email_ai_notice.strip() or DEFAULT_AI_NOTICE


def footer_lines(settings: Settings, *, ai_generated: bool, reviewed: bool = False) -> list[str]:
    """Pied de message : mention IA (si l'agent a rédigé) puis phrase de désinscription."""
    lines: list[str] = []
    if ai_generated:
        lines.append(ai_notice(settings, reviewed=reviewed))
    unsubscribe = settings.email_footer.strip()
    if unsubscribe:
        lines.append(unsubscribe)
    return lines


def footer_text(settings: Settings, *, ai_generated: bool = True, reviewed: bool = False) -> str:
    return "\n".join(footer_lines(settings, ai_generated=ai_generated, reviewed=reviewed))


def _linkify(escaped: str, color: str) -> str:
    def link(match: re.Match[str]) -> str:
        url = match.group(0)
        trail = ""
        while url and url[-1] in _TRAILING:
            url, trail = url[:-1], url[-1] + trail
        return f'<a href="{url}" style="color:{color};text-decoration:underline;">{url}</a>{trail}'

    return _URL.sub(link, escaped)


def _segments(body: str) -> list[tuple[str, list[str]]]:
    """Découpe le corps en paragraphes (`p`) et listes à puces (`ul`), dans l'ordre d'écriture."""
    segments: list[tuple[str, list[str]]] = []
    for chunk in re.split(r"\n\s*\n", body.strip().replace("\r\n", "\n")):
        current: tuple[str, list[str]] | None = None
        for line in chunk.split("\n"):
            if not line.strip():
                continue
            bullet = _BULLET.match(line)
            kind, value = ("ul", bullet.group(1).strip()) if bullet else ("p", line.rstrip())
            if current is None or current[0] != kind:
                current = (kind, [])
                segments.append(current)
            current[1].append(value)
    return segments


def _body_html(body: str, color: str) -> str:
    def inline(value: str) -> str:
        return _linkify(html.escape(value, quote=False), color)

    blocks: list[str] = []
    for kind, lines in _segments(body):
        if kind == "ul":
            items = "".join(f'<li style="margin:0 0 4px;">{inline(x)}</li>' for x in lines)
            blocks.append(f'<ul style="margin:0 0 14px;padding-left:22px;">{items}</ul>')
        else:
            inner = "<br>".join(inline(x) for x in lines)
            blocks.append(f'<p style="margin:0 0 14px;">{inner}</p>')
    return "".join(blocks)


def _https(value: str) -> str | None:
    value = value.strip()
    return value if value.startswith("https://") and not re.search(r"[\s\"'<>]", value) else None


def social_links(settings: Settings) -> list[tuple[str, str]]:
    """Liens du pied (D-40) : une ligne « Libellé | https://… » par lien, les autres ignorées."""
    links = []
    for line in settings.email_social_links.splitlines():
        label, _, url = line.partition("|")
        if label.strip() and (safe := _https(url)):
            links.append((label.strip(), safe))
    return links


def signature_lines(settings: Settings) -> list[str]:
    """Signature de l'école sous le message (D-40) : équipe, établissement, contact, adresse."""
    lines = [settings.email_signature_team.strip(), settings.email_signature_org.strip()]
    lines.append(settings.email_contact_email.strip())
    lines += [x.strip() for x in settings.email_postal_address.splitlines()]
    return [x for x in lines if x]


def _header(settings: Settings, color: str, banner_src: str | None = None) -> str:
    """En-tête (D-40, D-41) : le bandeau chargé (intégré à l'email) ou hébergé par l'école, sinon un
    bandeau sombre aux couleurs de l'école (logo ou nom, phrase d'accroche), lisible sans images."""
    name = html.escape(settings.email_brand_name.strip() or DEFAULT_BRAND_NAME)
    banner = _inline_src(banner_src) or _https(settings.email_header_image_url)
    if banner:
        return (
            f'<tr><td style="padding:0;"><img src="{html.escape(banner)}" alt="{name}" width="600" '
            'style="display:block;border:0;width:100%;max-width:600px;height:auto;'
            'border-radius:8px 8px 0 0;"></td></tr>'
        )
    logo = _https(settings.email_logo_url)
    mark = (
        f'<img src="{html.escape(logo)}" alt="{name}" height="40" '
        'style="display:block;border:0;height:40px;max-width:240px;width:auto;">'
        if logo
        else f'<span style="font-family:{_FONT};font-size:26px;font-weight:800;'
        f'letter-spacing:0.5px;color:#ffffff;">{name}</span>'
    )
    tagline = settings.email_header_tagline.strip()
    tagline_html = (
        f'<p style="margin:10px 0 0;font-family:{_FONT};font-size:13px;color:#d7e6ee;">'
        f"{html.escape(tagline, quote=False)}</p>"
        if tagline
        else ""
    )
    return (
        f'<tr><td bgcolor="{_HEADER}" style="padding:26px 28px;background:{_HEADER};'
        f"background-image:linear-gradient(135deg,{color} 0%,{_HEADER} 70%);"
        f'border-radius:8px 8px 0 0;">{mark}{tagline_html}</td></tr>'
    )


def _inline_src(value: str | None) -> str | None:
    """Image intégrée : `cid:` à l'envoi, `data:image/…;base64,` dans l'aperçu de Paramètres."""
    if not value:
        return None
    ok = re.fullmatch(r"cid:[\w.@-]+|data:image/(?:png|jpeg);base64,[A-Za-z0-9+/=]+", value)
    return value if ok else None


def _signature(settings: Settings, color: str) -> str:
    team = settings.email_signature_team.strip()
    org = settings.email_signature_org.strip()
    contact = settings.email_contact_email.strip()
    address = [x.strip() for x in settings.email_postal_address.splitlines() if x.strip()]
    links = social_links(settings)
    if not (team or org or contact or address or links):
        return ""
    parts = []
    if team:
        parts.append(
            f'<p style="margin:0 0 2px;font-size:15px;font-weight:700;color:{_HEADER};">'
            f"{html.escape(team, quote=False)}</p>"
        )
    if org:
        parts.append(
            f'<p style="margin:0 0 10px;color:#5b6670;">{html.escape(org, quote=False)}</p>'
        )
    if contact and _EMAIL.match(contact):
        safe = html.escape(contact)
        parts.append(
            f'<p style="margin:0 0 2px;"><a href="mailto:{safe}" '
            f'style="color:{color};text-decoration:none;">{safe}</a></p>'
        )
    for line in address:
        parts.append(f'<p style="margin:0;color:#5b6670;">{html.escape(line, quote=False)}</p>')
    if links:
        anchors = ' <span style="color:#a0aab3;">·</span> '.join(
            f'<a href="{html.escape(url)}" style="color:{color};text-decoration:none;">'
            f"{html.escape(label, quote=False)}</a>"
            for label, url in links
        )
        parts.append(f'<p style="margin:12px 0 0;">{anchors}</p>')
    return (
        f'<tr><td bgcolor="{_SIGNATURE_BG}" style="padding:22px 28px;background:{_SIGNATURE_BG};'
        f'font-family:{_FONT};font-size:13px;line-height:1.55;">{"".join(parts)}</td></tr>'
    )


def render(
    body: str,
    settings: Settings,
    *,
    ai_generated: bool,
    reviewed: bool = False,
    banner_src: str | None = None,
) -> RenderedEmail:
    """Texte brut et HTML d'un message (D-40) : en-tête de l'école, corps, signature de l'école,
    puis mention IA et désinscription. Le texte brut reste la version de référence."""
    lines = footer_lines(settings, ai_generated=ai_generated, reviewed=reviewed)
    signature = signature_lines(settings)
    links_text = [f"{label} : {url}" for label, url in social_links(settings)]
    text = body.rstrip()
    if signature or links_text:
        text += "\n\n" + "\n".join(signature + links_text)
    if lines:
        text += "\n\n-- \n" + "\n".join(lines)

    color = settings.email_brand_color
    if not _COLOR.match(color):
        color = DEFAULT_BRAND_COLOR
    footer_html = ""
    for index, line in enumerate(lines):
        badge = ""
        if ai_generated and index == 0:
            badge = (
                f'<span style="display:inline-block;margin-right:6px;padding:0 5px;'
                f"border:1px solid {color};border-radius:4px;color:{color};"
                'font-size:11px;font-weight:700;line-height:16px;">IA</span>'
            )
        footer_html += f'<p style="margin:0 0 6px;">{badge}{html.escape(line, quote=False)}</p>'
    footer_block = (
        f'<tr><td style="padding:14px 28px 20px;font-family:{_FONT};font-size:12px;'
        f'line-height:1.5;color:#6b7280;">{footer_html}</td></tr>'
        if footer_html
        else ""
    )
    document = (
        '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"></head>'
        '<body style="margin:0;padding:0;background:#f4f5f7;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#f4f5f7;"><tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3e6ea;'
        'border-radius:8px;">'
        f"{_header(settings, color, banner_src)}"
        f'<tr><td style="padding:26px 28px 10px;font-family:{_FONT};font-size:15px;'
        f'line-height:1.6;color:#1f2933;">{_body_html(body, color)}</td></tr>'
        f"{_signature(settings, color)}"
        f"{footer_block}"
        "</table></td></tr></table></body></html>"
    )
    return RenderedEmail(text=text, html=document)
