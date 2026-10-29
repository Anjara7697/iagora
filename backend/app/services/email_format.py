"""Mise en forme des emails sortants : texte brut et HTML, mention IA et désinscription.

Le texte reste la version de référence (`text/plain`) ; la version HTML est une simple mise en page
du même contenu, aux couleurs de l'école. Le corps écrit par l'agent est toujours échappé : aucun
HTML venu d'un modèle ou d'un prospect n'atteint le message.
"""

import html
import re
from dataclasses import dataclass

from app.config import DEFAULT_AI_NOTICE, DEFAULT_BRAND_COLOR, DEFAULT_BRAND_NAME, Settings

_URL = re.compile(r"https?://[^\s<>\"']+")
_BULLET = re.compile(r"^\s*[-*•]\s+(.+)$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_TRAILING = ".,;:!?)»"
_FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


@dataclass(frozen=True)
class RenderedEmail:
    text: str
    html: str


def footer_lines(settings: Settings, *, ai_generated: bool) -> list[str]:
    """Pied de message : mention IA (si l'agent a rédigé) puis phrase de désinscription."""
    lines: list[str] = []
    if ai_generated:
        lines.append(settings.email_ai_notice.strip() or DEFAULT_AI_NOTICE)
    unsubscribe = settings.email_footer.strip()
    if unsubscribe:
        lines.append(unsubscribe)
    return lines


def footer_text(settings: Settings, *, ai_generated: bool = True) -> str:
    return "\n".join(footer_lines(settings, ai_generated=ai_generated))


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


def _brand(settings: Settings, color: str) -> str:
    name = html.escape(settings.email_brand_name.strip() or DEFAULT_BRAND_NAME)
    logo = settings.email_logo_url.strip()
    if logo.startswith("https://"):
        return (
            f'<img src="{html.escape(logo)}" alt="{name}" height="36" '
            'style="display:block;border:0;height:36px;max-width:220px;width:auto;">'
        )
    return (
        f'<span style="font-family:{_FONT};font-size:18px;font-weight:700;color:{color};">'
        f"{name}</span>"
    )


def render(body: str, settings: Settings, *, ai_generated: bool) -> RenderedEmail:
    """Texte brut et HTML d'un message : corps, puis pied de message séparé."""
    lines = footer_lines(settings, ai_generated=ai_generated)
    text = f"{body.rstrip()}\n\n-- \n" + "\n".join(lines) if lines else body

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
        '<tr><td style="padding:0 28px 22px;">'
        '<div style="border-top:1px solid #e3e6ea;padding-top:14px;'
        f'font-family:{_FONT};font-size:12px;line-height:1.5;color:#6b7280;">{footer_html}</div></td></tr>'
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
        f'border-top:4px solid {color};border-radius:8px;">'
        f'<tr><td style="padding:22px 28px 6px;">{_brand(settings, color)}</td></tr>'
        f'<tr><td style="padding:14px 28px 10px;font-family:{_FONT};font-size:15px;'
        f'line-height:1.6;color:#1f2933;">{_body_html(body, color)}</td></tr>'
        f"{footer_block}"
        "</table></td></tr></table></body></html>"
    )
    return RenderedEmail(text=text, html=document)
