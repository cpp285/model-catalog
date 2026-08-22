import { getCatalog } from "../src/lib/catalog/query";

console.log(JSON.stringify(getCatalog("models").stats, null, 2));
