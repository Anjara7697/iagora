"use client";

import { SearchX, UserPlus, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, FilterChipGroup, Notice, Tag, TextInput } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, PageHeader, Screen, cx, initialsOf as initials } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { CompactList, CompactRow, DataTable, Table } from "@/components/ds/table";
import { ListToolbar, countLabel } from "@/components/ds/toolbar";
import { NARROW, useMediaQuery } from "@/lib/useMediaQuery";
import {
  CreateMemberPanel,
  MemberPanel,
  TemporaryPassword,
  memberState,
  type Secret,
} from "@/components/team/TeamPanels";
import { ROLE_LABELS, formatDate } from "@/lib/labels";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";
import type { Page, Role, User } from "@/lib/types";

type RoleFilter = Role | "";
type TeamView = { q: string; role: RoleFilter; member: number | null };

/** Recherche, rôle et membre ouvert dans l'adresse (règle 6) ; une valeur inconnue est ignorée. */
function readView(params: URLSearchParams): TeamView {
  const role = params.get("role") ?? "";
  const member = Number(params.get("member"));
  return {
    q: params.get("q") ?? "",
    role: role in ROLE_LABELS ? (role as Role) : "",
    member: Number.isInteger(member) && member > 0 ? member : null,
  };
}

function teamHref(view: TeamView) {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.role) params.set("role", view.role);
  if (view.member) params.set("member", String(view.member));
  const query = params.toString();
  return `/team${query ? `?${query}` : ""}`;
}

/** Initiales du membre, estompées pour un compte désactivé. */
function MemberAvatar({ member }: { member: User }) {
  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full type-body-sm font-semibold",
        member.is_active ? "bg-accent-soft text-accent-soft-foreground" : "bg-surface-tertiary text-muted",
      )}
      aria-hidden="true"
    >
      {initials(member.username)}
    </span>
  );
}

export default function TeamPage() {
  return (
    <Suspense>
      <Team />
    </Suspense>
  );
}

function Team() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const members = useApi<Page<User>>(isAdmin ? "/users?limit=200" : null, { keepPrevious: true });
  const view = readView(useSearchParams());
  // Relit l'adresse courante : deux changements rapprochés (frappe, filtre) ne s'écrasent pas.
  const navigate = (patch: Partial<TeamView>) =>
    replaceUrl(teamHref({ ...readView(new URLSearchParams(window.location.search)), ...patch }));
  const [creating, setCreating] = useState(false);
  const narrow = useMediaQuery(NARROW);
  const [secret, setSecret] = useState<Secret | null>(null);

  if (user && !isAdmin)
    return (
      <Screen>
        <Notice tone="warning">Cette page est réservée aux administrateurs.</Notice>
      </Screen>
    );

  const all = members.data?.items ?? [];
  const needle = view.q.trim().toLocaleLowerCase("fr");
  const shown = all.filter(
    (m) => (!view.role || m.role === view.role) && `${m.username} ${m.email}`.toLocaleLowerCase("fr").includes(needle),
  );
  const filtered = !!view.q || !!view.role;
  const active = all.filter((m) => m.is_active).length;
  const opened = all.find((m) => m.id === view.member) ?? null;
  const panelOpen = creating || opened !== null;

  return (
    <Screen className="max-w-[1100px]">
      <PageHeader
        {...reveal(0)}
        title="Équipe"
        subtitle="Les conseillers s’ajoutent ici, sans passer par le serveur. Chaque nouveau membre reçoit un mot de passe temporaire et choisit le sien à la première connexion."
        actions={
          <Btn variant="primary" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            Ajouter un membre
          </Btn>
        }
      />

      {/* Affiché dans le panneau tant qu'il est ouvert, sur la page ensuite. */}
      {secret && !panelOpen && <TemporaryPassword secret={secret} onDone={() => setSecret(null)} />}

      {members.error ? (
        <ErrorState message={`Chargement de l’équipe impossible : ${members.error.message}`} onRetry={members.reload} />
      ) : (
        <section className="flex flex-col gap-4" aria-label="Membres de l’équipe">
          {/* Barre au-dessus du tableau (règle 5) : recherche et rôle à gauche, compteur à droite. */}
          <ListToolbar
            {...reveal(1)}
            label="Recherche et filtres des membres"
            count={
              members.data
                ? `${countLabel(shown.length, "membre", filtered ? all.length : null)} · ${active} actif${active > 1 ? "s" : ""}`
                : ""
            }
          >
            <TextInput
              type="search"
              aria-label="Rechercher un membre"
              className="w-full sm:w-64"
              fullWidth={false}
              value={view.q}
              placeholder="Nom ou email…"
              onChange={(e) => navigate({ q: e.target.value })}
            />
            <FilterChipGroup
              label="Rôle"
              value={view.role}
              onChange={(role) => navigate({ role })}
              options={[
                { value: "" as RoleFilter, text: "Tous" },
                ...(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r as RoleFilter, text: ROLE_LABELS[r] })),
              ]}
            />
          </ListToolbar>

          {narrow && shown.length > 0 ? (
            // Sous 640 px : nom et état, puis email, rôle et ancienneté (règle 4, UX-04).
            <CompactList label="Liste des membres">
              {shown.map((m) => {
                const state = memberState(m);
                return (
                  <CompactRow
                    key={m.id}
                    onPress={() => navigate({ member: m.id })}
                    selected={m.id === view.member}
                    leading={<MemberAvatar member={m} />}
                    title={
                      <>
                        {m.username}
                        {m.id === user?.id && <span className="font-normal text-muted"> · vous</span>}
                      </>
                    }
                    aside={<Tag tone={state.tone}>{state.label}</Tag>}
                  >
                    <span className="type-caption break-all text-muted">{m.email}</span>
                    <span className="type-caption text-muted">
                      {ROLE_LABELS[m.role]} · membre depuis le {formatDate(m.created_at ?? null)}
                    </span>
                  </CompactRow>
                );
              })}
            </CompactList>
          ) : (
          <DataTable
            {...reveal(2)}
            label="Liste des membres"
            minWidth={680}
            isLoading={members.loading && !members.data}
            loadingLabel="Chargement de l’équipe…"
            columns={[
              { id: "member", label: "Membre", className: "min-w-[240px]" },
              { id: "role", label: "Rôle" },
              { id: "state", label: "État" },
              { id: "since", label: "Membre depuis" },
            ]}
            emptyState={
              filtered ? (
                <EmptyPanel
                  icon={SearchX}
                  title="Aucun membre ne correspond"
                  description={[view.q && `Recherche « ${view.q.trim()} »`, view.role && ROLE_LABELS[view.role]].filter(Boolean).join(" · ")}
                  action={
                    <Btn variant="secondary" onClick={() => navigate({ q: "", role: "" })}>
                      Afficher tous les membres
                    </Btn>
                  }
                />
              ) : (
                <EmptyPanel
                  icon={UsersRound}
                  title="Aucun membre pour l’instant"
                  description="Ajoutez les conseillers qui traiteront les échanges avec les prospects."
                  action={
                    <Btn variant="primary" onClick={() => setCreating(true)}>
                      <UserPlus className="size-4" aria-hidden="true" />
                      Ajouter un membre
                    </Btn>
                  }
                />
              )
            }
          >
            {shown.map((m, i) => {
              const state = memberState(m);
              const row = reveal(3 + i, 40);
              return (
                <Table.Row
                  key={m.id}
                  id={m.id}
                  onAction={() => navigate({ member: m.id })}
                  className={cx("cursor-pointer", m.id === view.member && "bg-accent-soft/50", row.className)}
                  style={row.style}
                >
                  <Table.Cell>
                    <span className="flex items-center gap-3">
                      <MemberAvatar member={m} />
                      <span className="flex min-w-0 flex-col">
                        <strong className="type-body font-semibold text-foreground">
                          {m.username}
                          {m.id === user?.id && <span className="font-normal text-muted"> · vous</span>}
                        </strong>
                        <span className="type-body-sm text-muted">{m.email}</span>
                      </span>
                    </span>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">{ROLE_LABELS[m.role]}</Table.Cell>
                  <Table.Cell>
                    <Tag tone={state.tone}>{state.label}</Tag>
                  </Table.Cell>
                  <Table.Cell className="type-caption whitespace-nowrap text-muted tabular-nums">
                    {formatDate(m.created_at ?? null)}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </DataTable>
          )}
        </section>
      )}

      <CreateMemberPanel
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          if (created.temporary_password) setSecret({ who: created.username, password: created.temporary_password });
          members.reload();
        }}
      />
      <MemberPanel
        member={creating ? null : opened}
        self={opened?.id === user?.id}
        secret={secret}
        onClose={() => navigate({ member: null })}
        onChanged={members.reload}
        onPassword={setSecret}
        onSecretDone={() => setSecret(null)}
      />
    </Screen>
  );
}
