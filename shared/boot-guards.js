// Boot guards to prevent duplicate listeners/intervals
export let __BOOTED__ = false; // Guard flag: prevent duplicate listeners/intervals
export let __INDEXER_BOOTED__ = false; // Guard flag: prevent duplicate Indexer listeners

export function setBooted(value = true) {
  __BOOTED__ = value;
}

export function setIndexerBooted(value = true) {
  __INDEXER_BOOTED__ = value;
}

