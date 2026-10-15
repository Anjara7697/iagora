"""Exerce la migration sur des affectations existantes dans un schéma PostgreSQL isolé."""

import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"),
    reason="Migration et contraintes PostgreSQL réelles",
)
async def test_upgrade_preserves_existing_assignments_and_downgrade_restores_columns():
    path = Path(__file__).parents[1] / "alembic/versions/0009_campaign_ownership.py"
    spec = importlib.util.spec_from_file_location("ownership_migration", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    schema = "test_ownership_" + uuid4().hex
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA {schema}"))
            await conn.execute(text(f"SET LOCAL search_path TO {schema}"))
            await conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            await conn.execute(text("CREATE TABLE campaigns (id INTEGER PRIMARY KEY)"))
            await conn.execute(
                text(
                    "CREATE TABLE campaign_prospects "
                    "(id INTEGER PRIMARY KEY, assigned_advisor_id INTEGER)"
                )
            )
            await conn.execute(text("INSERT INTO users VALUES (7)"))
            await conn.execute(text("INSERT INTO campaigns VALUES (1)"))
            await conn.execute(text("INSERT INTO campaign_prospects VALUES (1, 7), (2, NULL)"))

            def upgrade(connection):
                with Operations.context(MigrationContext.configure(connection)):
                    migration.upgrade()

            await conn.run_sync(upgrade)
            rows = (
                await conn.execute(
                    text(
                        "SELECT assigned_advisor_id, assignment_is_override "
                        "FROM campaign_prospects ORDER BY id"
                    )
                )
            ).all()
            assert rows == [(7, True), (None, False)]
            assert (
                await conn.execute(text("SELECT responsible_advisor_id FROM campaigns"))
            ).scalar_one() is None
            await conn.execute(text("UPDATE campaigns SET responsible_advisor_id = 7"))

            def downgrade(connection):
                with Operations.context(MigrationContext.configure(connection)):
                    migration.downgrade()
                columns = {c["name"] for c in inspect(connection).get_columns("campaign_prospects")}
                assert columns == {"id", "assigned_advisor_id"}
                assert {c["name"] for c in inspect(connection).get_columns("campaigns")} == {"id"}

            await conn.run_sync(downgrade)
            assert (
                await conn.execute(
                    text("SELECT assigned_advisor_id FROM campaign_prospects ORDER BY id")
                )
            ).all() == [(7,), (None,)]
            await conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
    finally:
        await engine.dispose()
