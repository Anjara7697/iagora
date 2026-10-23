"""Messagerie configurée depuis la console : chiffrement, détection des serveurs, API."""

import asyncio

import httpx
import pytest
from app.api.v1 import integrations
from app.config import Settings, get_settings
from app.core import vault
from app.integrations.email import autoconfig
from app.main import app
from app.models.enums import UserRole
from app.services import email_config

API = "/api/v1"


def base(**over) -> Settings:
    return Settings(_env_file=None, **over)


FORM = {
    "address": "Contact@Exemple.fr",
    "password": "s3cret-mot-de-passe",
    "imap_host": "ssl0.ovh.net",
    "imap_port": 993,
    "imap_folder": "INBOX/test",
    "smtp_host": "ssl0.ovh.net",
    "smtp_port": 587,
    "smtp_security": "starttls",
    "from_name": "DATUM Academy",
    "enabled": True,
    "send_enabled": False,
    "sandbox_recipients": ["Moi@Gmail.com"],
}


# --- Chiffrement --------------------------------------------------------------------------------


def test_vault_round_trip_and_key_change():
    s = base(jwt_secret_key="a" * 40)
    token = vault.encrypt(s, "mot-de-passe")
    assert "mot-de-passe" not in token and vault.decrypt(s, token) == "mot-de-passe"
    with pytest.raises(vault.VaultError):
        vault.decrypt(base(jwt_secret_key="b" * 40), token)
    own = base(jwt_secret_key="a" * 40, connectors_secret_key="clé-dédiée")
    assert vault.decrypt(own, vault.encrypt(own, "x")) == "x"
    with pytest.raises(vault.VaultError):
        vault.decrypt(own, token)


# --- Détection des serveurs ---------------------------------------------------------------------


def _http(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_known_provider_is_detected_without_network():
    found = asyncio.run(autoconfig.detect("jean@gmail.com", _http(lambda r: httpx.Response(500))))
    assert found.imap_host == "imap.gmail.com" and found.source == "preset" and found.note


def test_custom_domain_is_recognised_by_its_mx_servers():
    def handler(request):
        assert request.url.host == "dns.google"
        return httpx.Response(200, json={"Answer": [{"type": 15, "data": "1 mx1.mail.ovh.net."}]})

    found = asyncio.run(autoconfig.detect("contact@ecole.example", _http(handler)))
    assert (found.provider, found.imap_host, found.source) == ("OVHcloud", "ssl0.ovh.net", "mx")


ISPDB = """<clientConfig version="1.1"><emailProvider id="x">
<displayShortName>Exemple</displayShortName>
<incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>993</port>
<socketType>SSL</socketType></incomingServer>
<outgoingServer type="smtp"><hostname>smtp.exemple.net</hostname><port>465</port>
<socketType>SSL</socketType></outgoingServer>
<outgoingServer type="smtp"><hostname>smtp.exemple.net</hostname><port>587</port>
<socketType>STARTTLS</socketType></outgoingServer>
</emailProvider></clientConfig>"""


def test_thunderbird_database_is_used_when_mx_is_unknown():
    def handler(request):
        if request.url.host == "dns.google":
            return httpx.Response(200, json={"Answer": [{"type": 15, "data": "10 mx.inconnu."}]})
        return httpx.Response(200, text=ISPDB)

    found = asyncio.run(autoconfig.detect("a@exemple.net", _http(handler)))
    assert found.source == "ispdb" and found.imap_host == "imap.exemple.net"
    assert (found.smtp_port, found.smtp_security) == (587, "starttls")


def test_guess_when_nothing_is_reachable():
    def handler(request):
        raise httpx.ConnectError("hors ligne")

    found = asyncio.run(autoconfig.detect("a@petit-domaine.fr", _http(handler)))
    assert found.source == "guess" and found.imap_host == "imap.petit-domaine.fr" and found.note


# --- Configuration effective --------------------------------------------------------------------


def test_console_configuration_overrides_env_and_keeps_password():
    s = base(email_username="env@exemple.fr", email_imap_host="imap.env")
    doc = email_config.to_document(s, dict(FORM), None, 1)
    assert doc["address"] == "contact@exemple.fr" and doc["sandbox_recipients"] == ["moi@gmail.com"]
    assert "password" not in doc and "s3cret" not in str(doc)
    effective = email_config.apply(s, doc)
    assert effective.email_password.get_secret_value() == "s3cret-mot-de-passe"
    assert effective.email_imap_host == "ssl0.ovh.net" and effective.email_enabled
    assert effective.email_imap_folder == "INBOX/test"
    again = email_config.to_document(s, {**FORM, "password": None}, doc, 1)
    assert again["password_enc"] == doc["password_enc"]
    assert email_config.apply(s, None) is s


# --- API ----------------------------------------------------------------------------------------


@pytest.fixture
def env_settings():
    app.dependency_overrides[get_settings] = lambda: base(email_imap_host="imap.env.test")
    yield
    app.dependency_overrides.pop(get_settings, None)


async def test_config_api_saves_without_ever_returning_the_password(client, env_settings):
    first = (await client.get(f"{API}/integrations/email/config")).json()
    assert first["source"] == "env" and first["imap_host"] == "imap.env.test"
    no_pw = {**FORM, "password": None}
    assert (await client.put(f"{API}/integrations/email/config", json=no_pw)).status_code == 422
    r = await client.put(f"{API}/integrations/email/config", json=FORM)
    assert r.status_code == 200 and "s3cret" not in r.text
    saved = (await client.get(f"{API}/integrations/email/config")).json()
    assert saved["source"] == "console" and saved["password_set"] is True
    assert "s3cret" not in str(saved) and saved["imap_folder"] == "INBOX/test"
    status = (await client.get(f"{API}/integrations/email")).json()
    assert status["configured"] and status["enabled"] and status["imap_host"] == "ssl0.ovh.net"
    # Mot de passe vide : celui enregistré est conservé.
    assert (await client.put(f"{API}/integrations/email/config", json=no_pw)).status_code == 200
    assert (await client.delete(f"{API}/integrations/email/config")).status_code == 204
    assert (await client.get(f"{API}/integrations/email/config")).json()["source"] == "env"


async def test_test_endpoint_checks_form_values_and_lists_folders(
    client, env_settings, monkeypatch
):
    seen = {}

    class Fake:
        def __init__(self, settings):
            seen["host"] = settings.email_imap_host
            seen["password"] = settings.email_password.get_secret_value()

        async def check(self):
            return {"imap": "ok", "smtp": "ok"}

        async def folders(self):
            return [("INBOX", "INBOX"), ("Programm&AOk-", "Programmé")]

    monkeypatch.setattr(integrations, "ImapSmtpClient", Fake)
    r = await client.post(f"{API}/integrations/email/test", json=FORM)
    assert r.status_code == 200
    body = r.json()
    assert (
        body["imap"] == "ok" and {"name": "Programm&AOk-", "label": "Programmé"} in body["folders"]
    )
    assert seen == {"host": "ssl0.ovh.net", "password": "s3cret-mot-de-passe"}
    # Rien n'a été enregistré par le test.
    assert (await client.get(f"{API}/integrations/email/config")).json()["source"] == "env"


async def test_autodetect_endpoint(client, monkeypatch):
    async def fake_detect(address):
        return autoconfig.Detected("OVHcloud", "ssl0.ovh.net", 993, "ssl0.ovh.net", 587,
                                   "starttls", "mx")  # fmt: skip

    monkeypatch.setattr(autoconfig, "detect", fake_detect)
    r = await client.post(f"{API}/integrations/email/autodetect", json={"address": "a@b.fr"})
    assert r.json()["provider"] == "OVHcloud"


async def test_configuration_is_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/email/config")).status_code == 403
    assert (await advisor.put(f"{API}/integrations/email/config", json=FORM)).status_code == 403
    assert (await advisor.post(f"{API}/integrations/email/test", json=FORM)).status_code == 403


def test_folder_names_are_decoded_for_display():
    from app.integrations.email.imap_smtp import decode_folder, parse_list_line

    assert decode_folder("Objets envoy&AOk-s") == "Objets envoyés"
    assert parse_list_line(b'(\\HasNoChildren) "/" "INBOX/IA GORA_TEST"') == (
        "INBOX/IA GORA_TEST",
        "INBOX/IA GORA_TEST",
    )
    assert parse_list_line(b'(\\Noselect \\HasChildren) "/" Archives') is None
