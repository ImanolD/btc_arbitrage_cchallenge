/** Canonical project links, surfaced from the running system for judges. */
export const REPO_URL = "https://github.com/ImanolD/btc_arbitrage_cchallenge";

const BLOB = `${REPO_URL}/blob/master`;

export const DOC_LINKS = {
  repo: REPO_URL,
  architecture: `${BLOB}/docs/ARCHITECTURE.md`,
  criteria: `${BLOB}/docs/judging_criteria.md`,
  whyfilo: `${BLOB}/whyfilo.md`,
} as const;
