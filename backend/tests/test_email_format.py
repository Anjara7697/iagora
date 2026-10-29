from email import message_from_bytes, policy

from app.config import DEFAULT_AI_NOTICE, Settings
from app.integrations.email.base import OutboundEmail
from app.integrations.email.imap_smtp import ImapSmtpClient
from app.services import email_format


def settings(**over) -> Settings:
    return Settings(_env_file=None, email_username="agent@datum.test", **over)


def test_ai_notice_is_always_added_to_agent_messages():
    out = email_format.render("Bonjour Marie,\n\nVoici les dates.", settings(), ai_generated=True)
    assert DEFAULT_AI_NOTICE in out.text
    assert DEFAULT_AI_NOTICE in out.html
    assert out.text.index(DEFAULT_AI_NOTICE) < out.text.index("STOP")
    assert out.text.startswith("Bonjour Marie,")


def test_ai_notice_cannot_be_blanked_out():
    out = email_format.render("Bonjour", settings(email_ai_notice="   "), ai_generated=True)
    assert DEFAULT_AI_NOTICE in out.text


def test_the_notice_wording_can_be_changed():
    custom = "Réponse préparée par notre assistant IA."
    out = email_format.render("Bonjour", settings(email_ai_notice=custom), ai_generated=True)
    assert custom in out.text and DEFAULT_AI_NOTICE not in out.text


def test_human_messages_do_not_claim_to_be_ai():
    out = email_format.render("Bonjour, ici Nadia.", settings(), ai_generated=False)
    assert "assistant virtuel" not in out.text and "assistant virtuel" not in out.html
    assert "STOP" in out.text  # la désinscription reste proposée


def test_body_is_escaped_and_links_are_clickable():
    body = 'Bonjour <script>alert(1)</script> & "merci"\nLien : https://zoom.us/j/123?pwd=a&b=1.'
    out = email_format.render(body, settings(), ai_generated=True)
    assert "<script>" not in out.html and "&lt;script&gt;" in out.html
    assert '<a href="https://zoom.us/j/123?pwd=a&amp;b=1"' in out.html
    assert "</a>." in out.html  # la ponctuation finale reste hors du lien
    assert "javascript:" not in out.html


def test_bullets_become_a_list_and_paragraphs_keep_line_breaks():
    body = "Voici les options :\n- Lundi 10h\n- Mardi 14h\n\nDites-moi laquelle.\nMerci"
    html = email_format.render(body, settings(), ai_generated=True).html
    assert html.count("<li") == 2 and "<ul" in html
    assert "Dites-moi laquelle.<br>Merci" in html


def test_brand_name_color_and_logo():
    cfg = settings(
        email_brand_name="DATUM <Academy>",
        email_brand_color="#0a7a4b",
        email_logo_url="https://datum.example/logo.png",
    )
    html = email_format.render("Bonjour", cfg, ai_generated=True).html
    assert "#0a7a4b" in html and 'src="https://datum.example/logo.png"' in html
    assert "DATUM &lt;Academy&gt;" in html  # le nom de marque est échappé aussi


def test_invalid_brand_settings_fall_back_to_safe_defaults():
    cfg = settings(email_brand_color="red;}</style>", email_logo_url="javascript:alert(1)")
    html = email_format.render("Bonjour", cfg, ai_generated=True).html
    assert "red;}" not in html and "javascript:" not in html and "<img" not in html
    assert "DATUM Academy" in html


def test_sent_message_is_multipart_with_text_as_reference():
    rendered = email_format.render("Bonjour Marie", settings(), ai_generated=True)
    client = ImapSmtpClient(settings(email_smtp_host="smtp.test"))
    msg = client._build(
        OutboundEmail(
            to_address="marie@acme.test", subject="Re: x", text=rendered.text, html=rendered.html
        )
    )
    parsed = message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert parsed.get_content_type() == "multipart/alternative"
    plain = parsed.get_body(preferencelist=("plain",))
    html = parsed.get_body(preferencelist=("html",))
    assert plain is not None and DEFAULT_AI_NOTICE in plain.get_content()
    assert html is not None and "<html" in html.get_content()
    assert parsed["List-Unsubscribe"]


def test_text_only_message_stays_plain():
    client = ImapSmtpClient(settings(email_smtp_host="smtp.test"))
    msg = client._build(OutboundEmail(to_address="a@b.test", subject="x", text="Bonjour"))
    assert msg.get_content_type() == "text/plain"
