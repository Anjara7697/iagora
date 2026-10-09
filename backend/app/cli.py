"""Commandes d'administration : `python -m app.cli create-admin`."""

import argparse
import asyncio
import getpass
import os
import sys

from pydantic import ValidationError

from app import kb_commands
from app.database.session import dispose_engine, get_sessionmaker
from app.devtools import commands
from app.models.enums import UserRole
from app.schemas.user import UserCreate
from app.services import users
from app.services.errors import ConflictError


async def _create_admin(username: str, email: str, password: str) -> None:
    try:
        data = UserCreate(username=username, email=email, password=password, role=UserRole.ADMIN)
    except ValidationError as exc:
        sys.exit(f"Données invalides : {exc.errors()[0]['msg']}")
    try:
        async with get_sessionmaker()() as session:
            user = await users.create_user(session, data, actor="cli")
    except ConflictError as exc:
        sys.exit(exc.message)
    finally:
        await dispose_engine()
    print(f"Administrateur créé : {user.email} (id {user.id})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="Créer un compte administrateur")
    admin.add_argument("--username", required=True)
    admin.add_argument("--email", required=True)
    seed_cmd = sub.add_parser(
        "seed-demo", help="Créer des prospects et conversations de démonstration"
    )
    seed_cmd.add_argument(
        "--reset", action="store_true", help="Supprimer puis recréer les données de démo"
    )
    scn = sub.add_parser("scenario", help="Rejouer les scénarios de recette de l'agent")
    scn.add_argument("names", nargs="*", help="Scénarios à jouer (tous par défaut)")
    scn.add_argument(
        "--live", action="store_true", help="Utiliser le vrai modèle (par défaut : faux modèle)"
    )
    scn.add_argument("--report", help="Écrire un rapport Markdown à ce chemin")
    scn.add_argument(
        "--cleanup", action="store_true", help="Supprimer les prospects de recette ensuite"
    )
    chat_cmd = sub.add_parser("chat", help="Converser avec l'agent en jouant le prospect")
    chat_cmd.add_argument("--fake", action="store_true", help="Faux modèle (sans clé)")
    chat_cmd.add_argument("--target", default="ebihar_students", help="Cible du prospect simulé")
    chat_cmd.add_argument("--trace", action="store_true", help="Afficher la trace détaillée")
    ingest = sub.add_parser("kb-ingest", help="Ajouter/mettre à jour des documents (.md) du RAG")
    ingest.add_argument("path", help="Fichier .md ou dossier de fichiers .md")
    sub.add_parser("kb-list", help="Lister les documents de la base de connaissances")
    search = sub.add_parser("kb-search", help="Tester la recherche (scores, seuil de pertinence)")
    search.add_argument("query")
    search.add_argument("--target", help="Code de cible (ex. ebihar_students)")
    search.add_argument("--limit", type=int, default=4)
    sub.add_parser("kb-reindex", help="Recalculer les vecteurs (après changement de modèle)")
    delete = sub.add_parser("kb-delete", help="Supprimer un document (ou tous ceux de démo)")
    delete.add_argument("slug", nargs="?")
    delete.add_argument("--demo", action="store_true", help="Supprimer les documents FICTIFS")
    sub.add_parser("kb-eval", help="(dev) Évaluer la recherche sur des questions types")
    args = parser.parse_args()

    if args.command == "seed-demo":
        asyncio.run(commands.cmd_seed(reset=args.reset))
    elif args.command == "scenario":
        fake = not args.live
        code = asyncio.run(
            commands.cmd_scenarios(args.names, fake=fake, report=args.report, cleanup=args.cleanup)
        )
        sys.exit(code)
    elif args.command == "chat":
        asyncio.run(commands.cmd_chat(fake=args.fake, target=args.target, trace=args.trace))
    elif args.command == "kb-ingest":
        asyncio.run(kb_commands.cmd_kb_ingest(args.path))
    elif args.command == "kb-list":
        asyncio.run(kb_commands.cmd_kb_list())
    elif args.command == "kb-search":
        asyncio.run(kb_commands.cmd_kb_search(args.query, args.target, args.limit))
    elif args.command == "kb-reindex":
        asyncio.run(kb_commands.cmd_kb_reindex())
    elif args.command == "kb-delete":
        if not args.slug and not args.demo:
            sys.exit("Indiquez un document ou --demo.")
        asyncio.run(kb_commands.cmd_kb_delete(args.slug, args.demo))
    elif args.command == "kb-eval":
        sys.exit(asyncio.run(commands.cmd_kb_eval()))
    elif args.command == "create-admin":
        # Jamais en argument de ligne de commande (historique du shell) : variable ou saisie.
        password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Mot de passe : ")
        asyncio.run(_create_admin(args.username, args.email, password))


if __name__ == "__main__":
    main()
