"use client";

import { useState } from "react";
import { Loading, Pager, ProspectLink, ScoreBadge, StageBadge } from "@/components/ui";
import { formatDate, fullName, label, CONSENT, STAGES } from "@/lib/labels";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Page, Prospect } from "@/lib/types";

const LIMIT = 25;
const LEVEL_BY_SCORE = (t: number) => (t >= 75 ? "very_hot" : t >= 50 ? "hot" : t >= 25 ? "warm" : "cold");

export default function ProspectsPage() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useApi<Page<Prospect>>(
    `/prospects${qs({ q, stage, limit: LIMIT, offset })}`,
  );

  return (
    <>
      <h1>Prospects</h1>
      <div className="toolbar">
        <input
          placeholder="Rechercher (nom, email)…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Toutes les étapes</option>
          {Object.entries(STAGES).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </div>
      <Loading loading={loading} error={error} />
      {data && (
        <>
          <table>
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Étape</th>
                <th>Score</th>
                <th>Consentement</th>
                <th>Créé le</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => {
                const m = p.campaigns[0];
                return (
                  <tr key={p.id}>
                    <td>
                      <ProspectLink id={p.id}>{fullName(p)}</ProspectLink>
                      <div className="muted">{p.email}</div>
                    </td>
                    <td>{m ? <StageBadge stage={m.conversion_stage} /> : "-"}</td>
                    <td>{m ? <ScoreBadge total={m.total_score} level={LEVEL_BY_SCORE(m.total_score)} /> : "-"}</td>
                    <td>{label(CONSENT, p.consent_status)}</td>
                    <td>{formatDate(p.created_at)}</td>
                  </tr>
                );
              })}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Aucun prospect.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
        </>
      )}
    </>
  );
}
