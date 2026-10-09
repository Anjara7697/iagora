"""Consignes données au modèle de langage (en français, vouvoiement).

Les règles d'exactitude (NF-10), de ton (F-15) et de transparence sont dans le prompt ET
vérifiées après coup par du code (policy.ungrounded_claims) : on ne se fie pas au prompt seul.
"""

from collections.abc import Sequence
from typing import Any
from zoneinfo import ZoneInfo

from app.graph.policy import FIELD_LABELS
from app.graph.ports import ChatMessage, HistoryMessage, Passage, ProspectContext, Slot

PARIS = ZoneInfo("Europe/Paris")
_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MONTHS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]  # fmt: skip

PROGRAMS = {
    "ebihar_students": "le programme eBIHAR (étudiants)",
    "compagnons_pros": "le programme Les Compagnons (professionnels en montée en compétences)",
    "master_candidates": "le Master eBIHAR (candidats en recherche d'alternance)",
    "master_companies": "le Master eBIHAR (entreprises partenaires accueillant des apprentis)",
}

IDENTITY = (
    "Tu es l'assistant virtuel de DATUM Academy, une école de formation en Data, Big Data, "
    "Intelligence Artificielle et Cloud Computing. Tu es une IA : ne te fais jamais passer pour "
    "un humain, et dis-le franchement si on te le demande. Tu aides des prospects à s'orienter "
    "vers le bon programme et vers un échange avec un conseiller."
)

RULES = """Règles absolues :
- Vouvoie le prospect. Ton professionnel, chaleureux, clair, orienté conseil. Pas de pression, pas \
de promesse, pas de formule marketing générique.
- N'invente JAMAIS une information : prix, tarifs, dates, durées, conditions d'admission, \
financements, diplômes, taux de réussite, disponibilités. Appuie-toi uniquement sur les extraits \
fournis ci-dessous. Si l'information n'y figure pas, dis-le simplement et propose de la \
transmettre à un conseiller.
- Ne redemande jamais une information que tu connais déjà. Pose au maximum UNE question par message.
- Réponse courte : 120 mots maximum, sans liste à rallonge, sans émoji.
- N'écris que le message destiné au prospect, sans préambule ni commentaire."""


def format_slot(slot: Slot) -> str:
    start = slot.start.astimezone(PARIS)
    return (
        f"{_DAYS[start.weekday()]} {start.day} {_MONTHS[start.month - 1]} "
        f"à {start.hour}h{start.minute:02d}"
    )


def greeting(ctx: ProspectContext) -> str:
    return f"Bonjour {ctx.first_name}," if ctx.first_name else "Bonjour,"


def to_chat(history: Sequence[HistoryMessage], limit: int = 12) -> list[ChatMessage]:
    """Mémoire courte : les derniers messages, du point de vue du modèle."""
    return [
        ChatMessage(
            role="user" if m.role == "prospect" else "assistant",
            content=m.content,
        )
        for m in history[-limit:]
    ]


def known_profile(ctx: ProspectContext, profile: dict[str, Any]) -> str:
    # Minimisation (S-01) : prénom et informations de qualification seulement, jamais
    # l'email, le téléphone ni les identifiants de réseaux.
    lines = [f"- {k} : {v}" for k, v in profile.items() if v]
    if ctx.first_name:
        lines.insert(0, f"- prénom : {ctx.first_name}")
    return "\n".join(lines) or "(rien de connu pour l'instant)"


def qualification_system(
    ctx: ProspectContext, profile: dict[str, Any], slots: Sequence[Slot]
) -> str:
    target = PROGRAMS.get(ctx.target_code or "", "les programmes de DATUM Academy")
    slot_text = (
        "\n".join(f"{i}. {format_slot(s)}" for i, s in enumerate(slots, start=1))
        if slots
        else "(aucun créneau en attente)"
    )
    return f"""Tu analyses le DERNIER message d'un prospect de DATUM Academy intéressé par {target}.
Remplis le schéma demandé, sans rien inventer :
- intent : question (demande une information), interested (montre de l'intérêt), meeting_request \
(veut un rendez-vous ou un appel), slot_choice (choisit un des créneaux ci-dessous), \
meeting_declined (refuse le rendez-vous proposé), not_interested (n'est pas intéressé), opt_out \
(demande l'arrêt des messages), needs_advisor (demande explicitement un humain ou une décision \
commerciale), other.
- needs_human : vrai si la demande exige un conseiller (décision commerciale, cas particulier, \
réclamation, situation sensible).
- confidence : ta confiance dans cette lecture, de 0 à 1.
- chosen_slot : numéro du créneau choisi, seulement si intent = slot_choice.
- Champs de profil (study_level, goal, etc.) : seulement ce que le prospect dit explicitement dans \
ses messages ; sinon laisse vide.
Informations déjà connues :
{known_profile(ctx, profile)}
Créneaux proposés en attente de réponse :
{slot_text}"""


def reply_system(
    ctx: ProspectContext,
    profile: dict[str, Any],
    passages: Sequence[Passage],
    missing: Sequence[str],
    *,
    mode: str,
) -> str:
    target = PROGRAMS.get(ctx.target_code or "", "les programmes de DATUM Academy")
    if passages:
        knowledge = "\n".join(f"[{p.source}] {p.text}" for p in passages)
    else:
        knowledge = "(aucun extrait disponible : n'avance aucun fait précis)"
    if mode == "nurture":
        goal = (
            "Entretiens la relation avec ce prospect encore peu engagé : message court et "
            "chaleureux, qui apporte un élément utile tiré des extraits (s'il y en a), sans "
            "insister et sans demande de rendez-vous. Invite-le à poser ses questions."
        )
    elif ctx.history:
        goal = "Réponds au dernier message du prospect de façon utile et personnalisée."
    else:
        goal = (
            "Écris le premier message à ce prospect : présente-toi brièvement, rappelle ce qui "
            f"l'amène ({target}) et pose UNE question simple pour mieux le comprendre."
        )
    if missing and mode != "nurture":
        label = FIELD_LABELS.get(missing[0], missing[0])
        ask = f"Si c'est naturel, termine par UNE question sur {label}."
    else:
        ask = "Ne pose pas de question de qualification."
    return f"""{IDENTITY}

{RULES}

Contexte : le prospect s'intéresse à {target}. Campagne : {ctx.campaign_name or "non précisée"}.
Ce que l'on sait de lui :
{known_profile(ctx, profile)}

Extraits de la base de connaissances validée (seule source de faits) :
{knowledge}

Mission : {goal}
{ask}"""


def strict_retry_note(claims: Sequence[str]) -> str:
    return (
        "\n\nATTENTION : ta réponse précédente contenait des informations chiffrées non "
        f"présentes dans les extraits ({', '.join(claims)}). Réécris-la SANS aucun chiffre, prix, "
        "durée ni date qui ne figure pas dans les extraits ou dans les messages du prospect."
    )
