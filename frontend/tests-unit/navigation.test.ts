import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  campaignHref,
  campaignListHref,
  campaignListReturnHref,
  campaignReturnHref,
  readCampaignList,
  readCampaignView,
} from "@/lib/campaignNav";
import { conversationHref, isFiltered, readConversationView } from "@/lib/conversationNav";
import { knowledgeHref, readKnowledgeView } from "@/lib/knowledgeNav";
import { prospectTabHref, readProspectTab } from "@/lib/prospectNav";
import { prospectResultsHref, prospectReturnHref, readProspectResults } from "@/lib/prospectResults";

/** Adresse relue puis réécrite : doit revenir identique (règle 6 des parcours). */
const query = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("Campagnes", () => {
  test("liste : aller-retour de l'adresse et valeurs inconnues ignorées", () => {
    const href = "/campaigns?status=draft&mine=true&page=3";
    assert.equal(campaignListHref(readCampaignList(query(href))), href);
    assert.deepEqual(readCampaignList(query("/campaigns?status=supprimée&page=-2&mine=1")), { status: "", mine: false, page: 1 });
    assert.equal(readCampaignList(query("/campaigns?page=1e9")).page, 1);
  });

  test("fiche : onglet, étape et page des prospects ; étape ignorée hors de l'onglet Prospects", () => {
    const href = "/campaigns/7?tab=prospects&stage=qualified&page=2";
    assert.equal(campaignHref(7, readCampaignView(query(href))), href);
    assert.equal(campaignHref(7, readCampaignView(query("?tab=sources&stage=qualified&page=2"))), "/campaigns/7?tab=sources");
    assert.equal(campaignHref(7, readCampaignView(query("?tab=inconnu"))), "/campaigns/7");
  });

  test("adresse de retour : reconstruite, jamais suivie telle quelle", () => {
    assert.equal(campaignListReturnHref("/campaigns?status=active&x=1"), "/campaigns?status=active");
    for (const unsafe of ["https://exemple.com/campaigns", "//exemple.com", "/campaignsX", "/prospects", "", null])
      assert.equal(campaignListReturnHref(unsafe), null, String(unsafe));
    assert.equal(campaignReturnHref("/campaigns/12?tab=sources&evil=1"), "/campaigns/12?tab=sources");
    for (const unsafe of ["/campaigns/0", "/campaigns/abc", "/campaigns/12/../../admin", "https://exemple.com/campaigns/1"])
      assert.equal(campaignReturnHref(unsafe), null, unsafe);
  });

  test("le retour vers la liste filtrée suit la fiche", () => {
    const view = readCampaignView(query(`?from=${encodeURIComponent("/campaigns?status=draft")}`));
    assert.equal(view.from, "/campaigns?status=draft");
    assert.equal(campaignHref(3, view), "/campaigns/3?from=%2Fcampaigns%3Fstatus%3Ddraft");
  });
});

describe("Prospects", () => {
  test("liste : aller-retour de l'adresse avec tous les filtres", () => {
    const href = "/prospects?q=dupont&stage=qualified&campaign=4&source=9&demo=exclude&target_code=ebihar_students&mine=true&view=table&offset=50";
    const state = readProspectResults(query(href));
    assert.equal(prospectResultsHref(state), href);
  });

  test("valeurs invalides ramenées au défaut", () => {
    const state = readProspectResults(query("?stage=xx&campaign=-1&source=9&offset=-5&view=kanban&level=brulant"));
    assert.equal(state.stage, "");
    assert.equal(state.campaign, "");
    assert.equal(state.sourceFilter, "", "une source n'a de sens qu'avec une campagne");
    assert.equal(state.offset, 0);
    assert.equal(state.view, "pipeline");
    assert.equal(state.levelFilter, "");
  });

  test("adresse de retour depuis une fiche : reconstruite, jamais suivie telle quelle", () => {
    assert.equal(prospectReturnHref("/prospects?q=a&inconnu=1"), "/prospects?q=a");
    assert.equal(prospectReturnHref("/prospects"), "/prospects");
    for (const unsafe of ["https://exemple.com/prospects", "//exemple.com/prospects", "/prospects/1", "/admin", null])
      assert.equal(prospectReturnHref(unsafe), null, String(unsafe));
  });

  test("fiche : onglet dans l'adresse, paramètres de retour conservés", () => {
    assert.equal(readProspectTab(query("?tab=journey")), "journey");
    assert.equal(readProspectTab(query("?tab=__proto__")), "overview");
    assert.equal(
      prospectTabHref(5, "decisions", query("?tab=journey&from=%2Fprospects%3Fq%3Da&task=t1&autre=1")),
      "/prospects/5?tab=decisions&from=%2Fprospects%3Fq%3Da&task=t1",
    );
    assert.equal(prospectTabHref(5, "overview", query("")), "/prospects/5");
  });
});

describe("Conversations", () => {
  test("aller-retour de l'adresse", () => {
    const href = "/conversations?q=dupont&status=handed_off&owner=me&channel=email&page=2&id=c1";
    assert.equal(conversationHref(readConversationView(query(href))), href);
  });

  test("valeurs inconnues et longueurs bornées", () => {
    const view = readConversationView(query(`?status=x&owner=x&channel=x&page=0&q=${"a".repeat(150)}&id=${"b".repeat(101)}`));
    assert.equal(view.status, "");
    assert.equal(view.owner, "");
    assert.equal(view.channel, "");
    assert.equal(view.page, 1);
    assert.equal(view.q.length, 100);
    assert.equal(view.id, null);
    assert.equal(isFiltered(view), true);
    assert.equal(isFiltered(readConversationView(query("?page=3&id=c1"))), false, "page et élément ouvert ne sont pas des filtres");
  });
});

describe("Base de connaissances", () => {
  test("aller-retour de l'adresse et identifiant de document vérifié", () => {
    const href = "/knowledge?tab=test&q=dur%C3%A9e&programme=common&status=reindex&doc=ebihar-duree";
    assert.equal(knowledgeHref(readKnowledgeView(query(href))), href);
    const view = readKnowledgeView(query("?tab=x&programme=x&status=x&doc=../secret"));
    assert.deepEqual(view, { tab: "documents", q: "", programme: "", status: "", doc: null });
  });
});
