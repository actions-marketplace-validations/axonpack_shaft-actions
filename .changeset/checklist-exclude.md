---
'shaft': patch
---

- **Checklists that leave files out**: a checklist the API sends with `exclude` globs, as a community checklist can, is skipped when every changed file it would cover matches one ("Only files it leaves out changed"). When it runs, its step tells the model to leave those files out.
