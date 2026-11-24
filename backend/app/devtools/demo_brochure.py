"""Brochure FICTIVE de démonstration (PDF minimal, générée ici : aucun fichier réel dans Git, D-28).

Rattachée à la campagne du parcours guidé du simulateur pour montrer qu'un document de campagne
(D-42) est joint à un email quand le prospect le demande. Aucune information réelle : le contenu
reprend les faits fictifs de la base de démonstration."""

LABEL = "Brochure du programme (démonstration)"
FILENAME = "brochure-demonstration.pdf"
USAGE = "quand le prospect demande le programme, une brochure ou une présentation"
_LINES = (
    "Brochure de demonstration (FICTIVE)",
    "Master de demonstration, entierement en ligne.",
    "Duree fictive : 10 mois. Cout fictif : 6200 euros par an.",
    "Document de test : aucune information reelle.",
)


def brochure_pdf() -> bytes:
    """Un PDF d'une page, valide (table de références calculée), en police standard."""
    text = "BT /F1 16 Tf 72 760 Td 24 TL " + " ".join(f"({line}) '" for line in _LINES) + " ET"
    stream = text.encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R "
        b"/Resources << /Font << /F1 4 0 R >> >> >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)
