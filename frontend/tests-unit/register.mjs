// Lance les tests unitaires des modules TypeScript de `src/lib` avec Node seul (`node --test`), sans
// dépendance : Node retire les types à l'exécution, ce crochet résout l'alias `@/` et les imports sans
// extension, comme le fait Next.js.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
