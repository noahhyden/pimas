## setProperty must refuse the __proto__ key

setProperty returns early on "__proto__" as a prototype-pollution guard; every write (setter, reconcile, produce draft) funnels through it, so never add a write path that bypasses it.
