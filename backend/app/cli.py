"""Commandes d'administration : `python -m app.cli create-admin`."""

import argparse
import asyncio
import getpass
import os
import sys

from pydantic import ValidationError

from app.database.session import dispose_engine, get_sessionmaker
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
    args = parser.parse_args()

    if args.command == "create-admin":
        # Jamais en argument de ligne de commande (historique du shell) : variable ou saisie.
        password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Mot de passe : ")
        asyncio.run(_create_admin(args.username, args.email, password))


if __name__ == "__main__":
    main()
