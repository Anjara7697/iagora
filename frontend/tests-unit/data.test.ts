import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { api, ApiError, isAbort } from "@/lib/api";
import { sharedGet } from "@/lib/sharedGet";

type Call = { url: string; method: string; signal: AbortSignal | null | undefined };

/** `fetch` simulé : chaque appel reste en attente jusqu'à `answer()` ou l'abandon de son signal. */
function fakeFetch() {
  const calls: (Call & { answer: (body: unknown) => void })[] = [];
  globalThis.fetch = ((url: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Abandon", "AbortError")));
      calls.push({
        url,
        method: init.method ?? "GET",
        signal,
        answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })),
      });
    })) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sharedGet : lectures partagées", () => {
  test("deux demandes simultanées de la même adresse : une seule requête, même réponse", async () => {
    const calls = fakeFetch();
    const a = sharedGet<{ total: number }>("/todo?limit=1");
    const b = sharedGet<{ total: number }>("/todo?limit=1");
    assert.equal(calls.length, 1);
    calls[0].answer({ total: 5 });
    assert.deepEqual(await Promise.all([a.promise, b.promise]), [{ total: 5 }, { total: 5 }]);
    a.release();
    b.release();
  });

  test("une fois la réponse reçue, une nouvelle demande repart au serveur", async () => {
    const calls = fakeFetch();
    const first = sharedGet("/campaigns");
    calls[0].answer([]);
    await first.promise;
    first.release();
    const second = sharedGet("/campaigns");
    assert.equal(calls.length, 2);
    calls[1].answer([]);
    await second.promise;
    second.release();
  });

  test("une lecture partie avant une écriture n'est plus partagée", async () => {
    const calls = fakeFetch();
    const before = sharedGet("/campaigns/1");
    const write = api("/campaigns/1", { method: "PATCH", body: { status: "active" } });
    calls[1].answer({ status: "active" });
    await write;
    const after = sharedGet("/campaigns/1");
    assert.equal(calls.length, 3, "nouvelle requête après l'écriture");
    calls[0].answer({ status: "draft" });
    calls[2].answer({ status: "active" });
    assert.deepEqual(await after.promise, { status: "active" });
    await before.promise;
    before.release();
    after.release();
  });

  test("relecture (`fresh`) : ne reprend pas une requête partie avant l'écriture", async () => {
    const calls = fakeFetch();
    const before = sharedGet("/prospects/1");
    const after = sharedGet("/prospects/1", { fresh: true });
    assert.equal(calls.length, 2);
    calls[0].answer({ version: 1 });
    calls[1].answer({ version: 2 });
    assert.deepEqual(await after.promise, { version: 2 });
    await before.promise;
    before.release();
    after.release();
  });

  test("abandonnée quand plus personne ne l'attend, gardée tant qu'un composant l'attend", async () => {
    const calls = fakeFetch();
    const a = sharedGet("/prospects?q=mar");
    const b = sharedGet("/prospects?q=mar");
    a.release();
    assert.equal(calls[0].signal?.aborted, false, "un composant attend encore");
    b.release();
    assert.equal(calls[0].signal?.aborted, true);
    await assert.rejects(a.promise, (error) => isAbort(error));
    // Une nouvelle demande ne reprend pas la requête abandonnée.
    const c = sharedGet("/prospects?q=mar");
    assert.equal(calls.length, 2, "une requête abandonnée n'est pas reprise");
    calls[1].answer({ items: [] });
    assert.deepEqual(await c.promise, { items: [] });
    c.release();
  });
});

describe("api : délai maximal et abandon", () => {
  // `AbortSignal.timeout` ne retient pas le processus Node (dans le navigateur, la page reste ouverte) : une minuterie
  // garde la boucle active le temps de ces tests.
  let keepAlive: ReturnType<typeof setInterval>;
  before(() => {
    keepAlive = setInterval(() => {}, 1000);
  });
  after(() => clearInterval(keepAlive));

  test("une lecture trop longue échoue avec un message lisible", async () => {
    fakeFetch();
    await assert.rejects(api("/dashboard/summary", { timeoutMs: 20 }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.match(error.message, /trop de temps/);
      return true;
    });
  });

  test("une écriture n'a pas de délai maximal (le serveur ne serait pas arrêté)", async () => {
    const calls = fakeFetch();
    const write = api("/agent/runs", { method: "POST", body: {}, timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls[0].signal ?? null, null);
    calls[0].answer({ ok: true });
    assert.deepEqual(await write, { ok: true });
  });

  test("un abandon voulu reste un abandon, pas une erreur réseau à afficher", async () => {
    fakeFetch();
    const controller = new AbortController();
    const reading = api("/prospects", { signal: controller.signal });
    controller.abort();
    await assert.rejects(reading, (error) => isAbort(error) && !(error instanceof ApiError));
  });

  test("serveur injoignable : message réseau", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    await assert.rejects(api("/prospects"), (error) => error instanceof ApiError && /Serveur injoignable/.test(error.message));
  });
});
