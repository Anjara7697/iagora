"""Catalogue de scénarios de recette (CdC §12.2 et cas complémentaires).

Un scénario décrit un prospect fictif, ce qu'il écrit, et ce que l'on *attend* de l'agent. Les
mêmes scénarios servent à deux usages :
- tests automatiques et recette hors ligne (`--fake`) : un faux modèle scripté, déterministe ;
- essai avec le vrai modèle (`--live`) : on vérifie des propriétés robustes (bonne décision,
  motif de transfert, aucun chiffre inventé), jamais le texte exact, qui varie d'un appel à l'autre.

Les faits des extraits de connaissance ci-dessous sont FICTIFS : ils servent uniquement à tester.
"""

from dataclasses import dataclass, field
from typing import Any

from app.graph.ports import LLMUnavailableError, Passage
from app.graph.state import Qualification

ANY: Any = object()  # « peu importe »


@dataclass
class Expect:
    """Ce qui doit être vrai après un tour. Un champ laissé à `ANY` n'est pas vérifié."""

    action: str | None = None
    action_in: list[str] = field(default_factory=list)  # plusieurs décisions acceptables
    stage_in: list[str] = field(default_factory=list)
    handoff_reason: Any = ANY  # None : aucun transfert attendu
    reply: bool | None = None  # True : un message est rédigé ; False : aucun message
    reply_includes: list[str] = field(default_factory=list)
    reply_excludes: list[str] = field(default_factory=list)
    stage_after: str | None = None
    consent: str | None = None
    conversation: str | None = None  # open / handed_off / closed
    appointment: bool | None = None
    follow_up: bool | None = None
    profile_keys: list[str] = field(default_factory=list)


@dataclass
class Turn:
    says: str | None  # message du prospect ; None : l'agent écrit le premier message
    expect: Expect
    # Comportement du faux modèle pour ce tour (ignoré avec le vrai modèle).
    qualification: Qualification | Exception | None = None
    reply: str | Exception | None = None


@dataclass
class Scenario:
    name: str
    title: str
    cdc_ref: str
    turns: list[Turn]
    target_code: str = "ebihar_students"
    profile: dict[str, str] = field(default_factory=dict)
    knowledge: list[Passage] = field(default_factory=list)
    preset_follow_up: bool = False  # une relance est déjà programmée avant le premier tour
    fake_only: bool = False  # nécessite d'injecter une panne : impossible avec le vrai modèle


DEMO_FACT = Passage(
    source="demo-ebihar (FICTIF)",
    text="Le programme de démonstration dure 18 mois et se déroule en alternance.",
)

SCENARIOS: list[Scenario] = [
    Scenario(
        name="cold_prospect",
        title="Prospect peu engagé : message neutre, réponse sans transfert ni pression",
        cdc_ref="§12.2 n°1",
        turns=[
            Turn(
                says="Bonjour, je regardais un peu votre site.",
                qualification=Qualification(intent="other"),
                reply="Bonjour Camille, merci pour votre message. N'hésitez pas à me poser vos questions.",
                # Le vrai modèle lit « je regardais votre site » tantôt comme « autre », tantôt comme
                # « intéressé » : les deux décisions sont légitimes. On vérifie ce qui compte.
                expect=Expect(
                    action_in=["nurture", "continue_conversation"],
                    handoff_reason=None,
                    reply=True,
                    stage_in=["to_follow_up", "in_conversation"],
                ),
            )
        ],
    ),
    Scenario(
        name="hot_prospect_meeting",
        title="Prospect chaud : demande de rendez-vous, créneaux réels, réservation",
        cdc_ref="§12.2 n°2",
        profile={"study_level": "Bac+3", "goal": "devenir data analyst"},
        turns=[
            Turn(
                says="Je voudrais prendre rendez-vous avec un conseiller.",
                qualification=Qualification(intent="meeting_request", sentiment="positive"),
                expect=Expect(
                    action="propose_meeting",
                    reply=True,
                    reply_includes=["Répondez avec le numéro"],
                    stage_after="meeting_proposed",
                ),
            ),
            Turn(
                says="Le deuxième créneau me convient.",
                qualification=Qualification(intent="slot_choice", chosen_slot=2),
                expect=Expect(
                    action="book_meeting",
                    reply=True,
                    reply_includes=["zoom.example"],
                    stage_after="meeting_scheduled",
                    appointment=True,
                ),
            ),
        ],
    ),
    Scenario(
        name="unknown_question",
        title="Question hors base : transfert au conseiller avec fiche",
        cdc_ref="§12.2 n°3",
        turns=[
            Turn(
                says="Quel est le coût exact de la formation et peut-elle être financée par mon CPF ?",
                qualification=Qualification(intent="question"),
                expect=Expect(
                    action="continue_conversation",
                    handoff_reason="question_hors_base",
                    reply=True,
                    conversation="handed_off",
                ),
            )
        ],
    ),
    Scenario(
        name="opt_out",
        title="Demande d'arrêt : opt-out enregistré, plus aucune communication",
        cdc_ref="§12.2 n°4",
        turns=[
            Turn(
                says="STOP, ne m'écrivez plus.",
                expect=Expect(
                    action="opt_out",
                    reply=False,
                    consent="opted_out",
                    conversation="closed",
                    stage_after="lost",
                ),
            )
        ],
    ),
    Scenario(
        name="llm_unavailable",
        title="Modèle indisponible : nouveaux essais puis transfert",
        cdc_ref="§12.2 n°5",
        fake_only=True,
        turns=[
            Turn(
                says="Pouvez-vous m'expliquer le programme ?",
                qualification=LLMUnavailableError("quota dépassé"),
                reply=LLMUnavailableError("quota dépassé"),
                expect=Expect(
                    action="human_handoff",
                    handoff_reason="llm_indisponible",
                    conversation="handed_off",
                ),
            )
        ],
    ),
    Scenario(
        name="kb_answer",
        title="Question couverte par la base de connaissances : réponse sourcée",
        cdc_ref="F-14, NF-10",
        knowledge=[DEMO_FACT],
        turns=[
            Turn(
                says="Combien de temps dure le programme ?",
                qualification=Qualification(intent="question"),
                reply="Le programme de démonstration dure 18 mois et se déroule en alternance.",
                expect=Expect(
                    handoff_reason=None,
                    reply=True,
                    reply_excludes=["€", "euros"],
                    conversation="open",
                ),
            )
        ],
    ),
    Scenario(
        name="invented_figures_trap",
        title="Piège : le prospect demande un prix que la base ne contient pas",
        cdc_ref="NF-10",
        turns=[
            Turn(
                says="Combien coûte la formation ?",
                qualification=Qualification(intent="interested"),
                reply="La formation coûte 4500 euros et dure 18 mois.",  # invention : doit être bloquée
                expect=Expect(reply_excludes=["4500", "4 500", "€"]),
            )
        ],
    ),
    Scenario(
        name="sensitive_message",
        title="Situation sensible : transfert immédiat à un humain",
        cdc_ref="F-20",
        turns=[
            Turn(
                says="Je vais porter plainte contre votre école.",
                qualification=Qualification(intent="other"),
                expect=Expect(
                    action="human_handoff",
                    handoff_reason="situation_sensible",
                    conversation="handed_off",
                ),
            )
        ],
    ),
    Scenario(
        name="asks_for_advisor",
        title="Le prospect demande un conseiller humain",
        cdc_ref="F-20",
        turns=[
            Turn(
                says="Je préfère parler directement à un conseiller.",
                qualification=Qualification(intent="needs_advisor"),
                expect=Expect(
                    action="human_handoff",
                    handoff_reason="demande_conseiller",
                    conversation="handed_off",
                ),
            )
        ],
    ),
    Scenario(
        name="not_interested",
        title="Pas intéressé : clôture sans relance",
        cdc_ref="§6.2",
        turns=[
            Turn(
                says="Non merci, ça ne m'intéresse pas.",
                qualification=Qualification(intent="not_interested", sentiment="negative"),
                expect=Expect(
                    action="close",
                    reply=False,
                    stage_after="lost",
                    conversation="closed",
                    follow_up=False,
                ),
            )
        ],
    ),
    Scenario(
        name="first_contact",
        title="Premier contact : l'agent écrit le premier message",
        cdc_ref="F-06",
        turns=[
            Turn(
                says=None,
                reply="Bonjour Camille, je suis l'assistant virtuel de DATUM Academy. Qu'est-ce qui vous amène ?",
                expect=Expect(
                    action="continue_conversation",
                    handoff_reason=None,
                    reply=True,
                    stage_after="contacted",
                ),
            )
        ],
    ),
    Scenario(
        name="meeting_with_advisor_wording",
        title="« Rendez-vous avec un conseiller » : l'agent organise le rendez-vous",
        cdc_ref="F-18",
        turns=[
            Turn(
                says="Je voudrais prendre rendez-vous avec un conseiller.",
                # Pire cas observé avec le vrai modèle : il hésite entre rendez-vous et conseiller.
                qualification=Qualification(intent="needs_advisor", needs_human=True),
                expect=Expect(
                    action="propose_meeting",
                    handoff_reason=None,
                    reply=True,
                    reply_includes=["Répondez avec le numéro"],
                    stage_after="meeting_proposed",
                ),
            )
        ],
    ),
    Scenario(
        name="catalogue_question",
        title="« Quelles formations proposez-vous ? » : réponse avec la liste validée",
        cdc_ref="F-14",
        turns=[
            Turn(
                says="Quelles formations proposez-vous ?",
                qualification=Qualification(intent="question", asks_catalogue=True),
                reply="Nous proposons eBIHAR pour les étudiants, Les Compagnons pour les professionnels et le Master eBIHAR en alternance.",
                expect=Expect(handoff_reason=None, reply=True, conversation="open"),
            )
        ],
    ),
    Scenario(
        name="follow_up_cancelled_on_reply",
        title="Le prospect répond : la relance programmée est annulée",
        cdc_ref="F-16",
        # Une relance existe déjà : le résultat ne dépend pas de la façon dont le modèle classe
        # un premier message neutre. Le prospect répond, la relance doit disparaître.
        preset_follow_up=True,
        turns=[
            Turn(
                says="Finalement oui, je suis en Bac+3 et l'alternance m'intéresse.",
                qualification=Qualification(intent="interested", study_level="Bac+3"),
                reply="Avec plaisir, quel est votre projet après cette formation ?",
                expect=Expect(handoff_reason=None, reply=True, follow_up=False),
            ),
        ],
    ),
    Scenario(
        name="progressive_qualification",
        title="Qualification progressive : informations conservées, jamais redemandées",
        cdc_ref="F-09",
        turns=[
            Turn(
                says="Je suis en Bac+3 d'informatique.",
                qualification=Qualification(
                    intent="interested", study_level="Bac+3", field_of_study="informatique"
                ),
                reply="Merci Camille. Quel est votre projet après cette formation ?",
                expect=Expect(handoff_reason=None, reply=True, profile_keys=["study_level"]),
            ),
            Turn(
                says="Je voudrais devenir data analyst.",
                qualification=Qualification(intent="interested", goal="devenir data analyst"),
                reply="Très bien, le programme peut vous y préparer. Souhaitez-vous en savoir plus ?",
                expect=Expect(
                    handoff_reason=None, reply=True, profile_keys=["study_level", "goal"]
                ),
            ),
        ],
    ),
]


def get_scenarios(names: list[str] | None = None) -> list[Scenario]:
    if not names:
        return list(SCENARIOS)
    by_name = {s.name: s for s in SCENARIOS}
    unknown = [n for n in names if n not in by_name]
    if unknown:
        raise KeyError(f"Scénario(s) inconnu(s) : {unknown}. Disponibles : {sorted(by_name)}")
    return [by_name[n] for n in names]
