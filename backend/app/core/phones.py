"""Numéros de téléphone au format international E.164 (AUDIT-DATA-001).

`06 12 34 56 78`, `+33 6 12 34 56 78` et `0033612345678` désignent le même numéro : sans format
unique, la déduplication (F-05) et la liste d'opposition (S-03) les voyaient comme trois numéros.
Un numéro que la bibliothèque ne sait pas interpréter est gardé tel quel (nettoyé), jamais refusé.
"""

import re
from collections.abc import Iterable

import phonenumbers

_SEPARATORS = re.compile(r"[\s.\-()/]")


def _clean(value: str) -> str:
    phone = _SEPARATORS.sub("", value)
    return "+" + phone[2:] if phone.startswith("00") else phone


def normalize(value: str | None, region: str) -> str | None:
    """E.164 (`+33612345678`) quand le numéro est plausible, sinon la forme nettoyée."""
    if value is None:
        return None
    cleaned = _clean(value)
    if not cleaned:
        return None
    try:
        parsed = phonenumbers.parse(cleaned, region)
    except phonenumbers.NumberParseException:
        return cleaned
    if not phonenumbers.is_possible_number(parsed):
        return cleaned
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def legacy_forms(value: str | None, region: str) -> list[str]:
    """Formes sous lesquelles ce numéro a pu être enregistré avant E.164 (empreintes d'opposition
    anciennes) : E.164, national (`0612345678`), indicatif sans `+` (`33612345678`)."""
    e164 = normalize(value, region)
    if e164 is None:
        return []
    forms = [e164]
    if e164.startswith("+"):
        try:
            parsed = phonenumbers.parse(e164, None)
        except phonenumbers.NumberParseException:
            return forms
        national = _SEPARATORS.sub(
            "", phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL)
        )
        forms += [national, e164[1:]]
    return list(dict.fromkeys(forms))


def plan(
    rows: Iterable[tuple[int, str | None]], region: str
) -> tuple[dict[int, str], list[list[int]]]:
    """Prépare la mise au format des numéros existants, sans fusion.

    Renvoie les changements `{fiche: nouveau numéro}` et les groupes de fiches en collision : leurs
    numéros, une fois normalisés, désignent la même personne. Ceux-là ne sont pas modifiés
    (l'unicité resterait violée) : ils sont à examiner à la main."""
    present: list[tuple[int, str]] = [(pid, phone) for pid, phone in rows if phone]
    target: dict[int, str] = {pid: normalize(phone, region) or phone for pid, phone in present}
    by_number: dict[str, list[int]] = {}
    for pid, number in target.items():
        by_number.setdefault(number, []).append(pid)
    collisions = sorted(sorted(ids) for ids in by_number.values() if len(ids) > 1)
    colliding = {pid for group in collisions for pid in group}
    current = dict(present)
    changes = {
        pid: number
        for pid, number in target.items()
        if number != current[pid] and pid not in colliding
    }
    return changes, collisions
