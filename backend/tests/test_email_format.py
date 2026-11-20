from email import message_from_bytes, policy

from app.config import DEFAULT_AI_NOTICE, DEFAULT_AI_NOTICE_REVIEWED, Settings
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


def test_a_reviewed_message_says_a_counsellor_read_it():
    """D-32 : brouillon validé par un conseiller -> « relu par un conseiller » ; message parti sans
    relecture (mode automatique) -> mention d'un message rédigé par l'assistant."""
    reviewed = email_format.render("Bonjour", settings(), ai_generated=True, reviewed=True)
    assert DEFAULT_AI_NOTICE_REVIEWED in reviewed.text and DEFAULT_AI_NOTICE not in reviewed.text
    assert "relu par un conseiller" in reviewed.html
    auto = email_format.render("Bonjour", settings(), ai_generated=True)
    assert DEFAULT_AI_NOTICE in auto.text and DEFAULT_AI_NOTICE_REVIEWED not in auto.text


def test_the_reviewed_notice_can_be_reworded_but_not_blanked_out():
    custom = "Réponse préparée avec notre assistant IA et relue par l'équipe."
    out = email_format.render(
        "Bonjour", settings(email_ai_notice_reviewed=custom), ai_generated=True, reviewed=True
    )
    assert custom in out.text
    blank = email_format.render(
        "Bonjour", settings(email_ai_notice_reviewed="  "), ai_generated=True, reviewed=True
    )
    assert DEFAULT_AI_NOTICE_REVIEWED in blank.text


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


DATUM = {
    "email_brand_name": "Datum Academy",
    "email_header_tagline": "Nous ouvrons la voie aux leaders IT de demain",
    "email_signature_team": "L'équipe admissions",
    "email_signature_org": "Datum Academy",
    "email_contact_email": "contact@datum.example",
    "email_postal_address": "ESTIA 2 Technopole\n97 allée de l'École, 64210 Bidart",
    "email_social_links": (
        "LinkedIn | https://linkedin.example/datum\nSite | https://datum.example\nmauvais lien"
    ),
}


def test_datum_design_header_signature_and_links():
    """D-40 : bandeau sombre avec la phrase d'accroche, signature de l'école et liens du pied, en
    HTML comme en texte brut ; une ligne de lien mal écrite est ignorée."""
    out = email_format.render("Bonjour Camille,\n\nMerci.", settings(**DATUM), ai_generated=True)
    assert "Nous ouvrons la voie aux leaders IT de demain" in out.html
    assert "L&#x27;équipe admissions" in out.html or "L'équipe admissions" in out.html
    assert 'href="mailto:contact@datum.example"' in out.html
    assert 'href="https://linkedin.example/datum"' in out.html and ">Site</a>" in out.html
    assert "mauvais lien" not in out.html and "64210 Bidart" in out.html
    signature, _, notices = out.text.partition("\n-- \n")
    assert "L'équipe admissions\nDatum Academy\ncontact@datum.example" in signature
    assert "LinkedIn : https://linkedin.example/datum" in signature
    assert DEFAULT_AI_NOTICE in notices


def test_a_banner_image_replaces_the_drawn_header_and_everything_is_escaped():
    cfg = settings(
        **{**DATUM, "email_header_tagline": "<b>accroche</b>", "email_signature_team": "<script>"},
        email_header_image_url="https://datum.example/bandeau.png",
    )
    html = email_format.render("Bonjour", cfg, ai_generated=True).html
    assert 'src="https://datum.example/bandeau.png"' in html and 'alt="Datum Academy"' in html
    assert "<script>" not in html and "&lt;script&gt;" in html
    unsafe = settings(email_header_image_url="http://datum.example/x.png", email_contact_email="x")
    html = email_format.render("Bonjour", unsafe, ai_generated=True).html
    assert "x.png" not in html and "mailto:" not in html


def test_an_embedded_banner_comes_first_and_only_safe_sources_are_kept():
    cfg = settings(email_header_image_url="https://datum.example/bandeau.png")
    html = email_format.render(
        "Bonjour", cfg, ai_generated=True, banner_src="cid:bandeau@iagora"
    ).html
    assert 'src="cid:bandeau@iagora"' in html and "datum.example/bandeau.png" not in html
    unsafe = email_format.render("Bonjour", cfg, ai_generated=True, banner_src="javascript:x").html
    assert "javascript:" not in unsafe and "datum.example/bandeau.png" in unsafe
