"""Assemblage du graphe d'états (CdC §9.3).

START -> load_prospect -> identify_context -> enrich_prospect -> qualify_prospect
      -> calculate_score -> decide_next_action -> { continue | nurture | propose_meeting |
         book_meeting | human_handoff | opt_out | close } -> finalize -> END
"""

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.nodes import WorkflowNodes
from app.graph.ports import Deps
from app.graph.state import Action, SalesAgentState

_STRAIGHT = [
    "load_prospect",
    "identify_context",
    "enrich_prospect",
    "qualify_prospect",
    "calculate_score",
    "decide_next_action",
]
_NODES = [
    *_STRAIGHT,
    "generate_response",
    "send_message",
    "schedule_followup",
    "get_calendar_slots",
    "propose_meeting",
    "book_meeting",
    "human_handoff",
    "handle_opt_out",
    "close_conversation",
    "finalize",
]

_ROUTES = {
    Action.CONTINUE_CONVERSATION: "generate_response",
    Action.NURTURE: "generate_response",
    Action.PROPOSE_MEETING: "get_calendar_slots",
    Action.BOOK_MEETING: "book_meeting",
    Action.HUMAN_HANDOFF: "human_handoff",
    Action.OPT_OUT: "handle_opt_out",
    Action.CLOSE: "close_conversation",
}


def route_action(state: SalesAgentState) -> str:
    decision = state["decision"]
    if decision.action is Action.PROPOSE_MEETING and decision.answer_first:
        return "generate_response"  # D-33 : répondre d'abord, les créneaux suivent
    return _ROUTES[decision.action]


def after_reply(state: SalesAgentState) -> str:
    if state.get("needs_human"):
        return "human_handoff"
    if state["decision"].action is Action.PROPOSE_MEETING:
        return "get_calendar_slots"
    return "send_message"


def after_slots(state: SalesAgentState) -> str:
    if state.get("needs_human"):
        return "human_handoff"
    # Réponse déjà rédigée mais pas de créneau (agenda absent) : la réponse part seule.
    return "propose_meeting" if state.get("slots") else "send_message"


def handoff_or(next_node: str) -> Any:
    """Un noeud peut demander le transfert en cours de route (question hors base, agenda...)."""

    def _route(state: SalesAgentState) -> str:
        return "human_handoff" if state.get("needs_human") else next_node

    return _route


def after_send(state: SalesAgentState) -> str:
    return "schedule_followup" if state["decision"].action is Action.NURTURE else "finalize"


def build_workflow(deps: Deps) -> Any:
    """Compile le graphe. Les dépendances (modèle, base, agenda...) sont injectées : le graphe
    lui-même ne connaît aucun fournisseur."""
    nodes = WorkflowNodes(deps)
    graph = StateGraph(SalesAgentState)
    for name in _NODES:
        graph.add_node(name, getattr(nodes, name))

    graph.add_edge(START, _STRAIGHT[0])
    for current, following in zip(_STRAIGHT, _STRAIGHT[1:], strict=False):
        graph.add_edge(current, following)

    graph.add_conditional_edges("decide_next_action", route_action, sorted(set(_ROUTES.values())))
    graph.add_conditional_edges(
        "generate_response",
        after_reply,
        ["human_handoff", "get_calendar_slots", "send_message"],
    )
    graph.add_conditional_edges(
        "get_calendar_slots", after_slots, ["human_handoff", "propose_meeting", "send_message"]
    )
    graph.add_conditional_edges(
        "book_meeting", handoff_or("send_message"), ["human_handoff", "send_message"]
    )
    graph.add_edge("propose_meeting", "send_message")
    graph.add_conditional_edges("send_message", after_send, ["schedule_followup", "finalize"])
    graph.add_edge("schedule_followup", "finalize")
    graph.add_edge("human_handoff", "finalize")
    # Arrêt accompagné d'une demande à traiter (données personnelles, plainte) : transfert.
    graph.add_conditional_edges(
        "handle_opt_out",
        handoff_or("close_conversation"),
        ["human_handoff", "close_conversation"],
    )
    graph.add_edge("close_conversation", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()
