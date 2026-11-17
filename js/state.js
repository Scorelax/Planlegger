// Felles app-tilstand. Fylles av sanntidsabonnementer fra databasen.
export const COLLECTIONS = ['storages', 'items', 'leftovers', 'shopping', 'recipes', 'products'];

export const state = {
  storages: [],   // lager: { name, icon, order }
  items: [],      // varer på lager: { name, storageId, qtyType: none|count|weight, count, weight, unit, staple, empty, lowWeight, bestBefore, addedAt }
  leftovers: [],  // middagsrester: { name, portions, storageId, addedAt }
  shopping: [],   // handleliste: { name, amount, storageId, staple, checked, itemId, reason, addedAt }
  recipes: [],    // oppskrifter: { title, minutes, servings, favorite, image, ingredients: [{ name, amount }], steps }
  products: [],   // varedatabase for autofullføring: { name, nameLower, storageId, qtyType, unit, staple }
  loaded: {},
  user: null,
};

export let db = null;
export const setDb = (d) => { db = d; };

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emitChange = () => listeners.forEach((fn) => fn());
