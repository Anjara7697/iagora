const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

async function getBackendStatus(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    return res.ok ? "connecté" : `erreur ${res.status}`;
  } catch {
    return "injoignable";
  }
}

export default async function Home() {
  const status = await getBackendStatus();
  return (
    <main>
      <h1>Commercial 2.0</h1>
      <p>Tableau de bord - initialisation du projet.</p>
      <p>Backend : {status}</p>
    </main>
  );
}
