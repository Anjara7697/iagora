"""Découpage des documents en extraits (chunks) pour la recherche sémantique.

Un document est un fichier Markdown :

    ---
    title: Programme eBIHAR
    target: ebihar_students      (omis ou « all » : valable pour tous les programmes)
    ---
    ## Durée
    Texte…

On découpe par section (`##`), puis par paragraphes si une section dépasse la taille cible. Chaque
extrait est préfixé du titre du document et de sa section : « eBIHAR — Durée : … ». Ce contexte
améliore la recherche et permet à l'agent de citer la source.
"""

import hashlib
import re
from dataclasses import dataclass

MAX_CHARS = 900


class DocumentFormatError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedDocument:
    slug: str
    title: str
    target_code: str | None
    content_hash: str
    chunks: list["ChunkDraft"]


@dataclass(frozen=True)
class ChunkDraft:
    heading: str | None
    text: str  # texte complet, préfixé du contexte (c'est lui qui est vectorisé et cité)


def _split_front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("\n---", 1)
    if len(parts) != 2:
        raise DocumentFormatError("En-tête « --- » non refermé")
    meta: dict[str, str] = {}
    for line in parts[0].splitlines()[1:]:
        if not line.strip():
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise DocumentFormatError(f"Ligne d'en-tête invalide : {line!r}")
        meta[key.strip().lower()] = value.strip()
    return meta, parts[1].lstrip("\n")


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    pieces: list[str] = []
    current = ""
    for paragraph in re.split(r"\n\s*\n", text):
        if current and len(current) + len(paragraph) + 2 > MAX_CHARS:
            pieces.append(current)
            current = ""
        if len(paragraph) > MAX_CHARS:  # paragraphe géant : coupe par phrases
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
                if current and len(current) + len(sentence) + 1 > MAX_CHARS:
                    pieces.append(current)
                    current = ""
                current = f"{current} {sentence}".strip()
        else:
            current = f"{current}\n\n{paragraph}".strip()
    if current:
        pieces.append(current)
    return pieces


def parse_document(slug: str, raw: str) -> ParsedDocument:
    meta, body = _split_front_matter(raw)
    title = meta.get("title")
    if not title:
        raise DocumentFormatError("L'en-tête doit contenir « title: … »")
    target = meta.get("target", "").strip() or None
    if target and target.lower() == "all":
        target = None

    sections: list[tuple[str | None, str]] = []
    heading: str | None = None
    lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if "".join(lines).strip():
                sections.append((heading, "\n".join(lines).strip()))
            heading, lines = line[3:].strip(), []
        else:
            lines.append(line)
    if "".join(lines).strip():
        sections.append((heading, "\n".join(lines).strip()))
    if not sections:
        raise DocumentFormatError("Document vide")

    chunks = [
        ChunkDraft(head, f"{title} — {head} : {piece}" if head else f"{title} : {piece}")
        for head, content in sections
        for piece in _split_long(content)
    ]
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return ParsedDocument(slug, title, target, digest, chunks)
