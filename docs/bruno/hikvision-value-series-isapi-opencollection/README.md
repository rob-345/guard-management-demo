# Hikvision Value Series ISAPI OpenCollection

This collection is the YAML/OpenCollection version of the Hikvision terminal request pack.

Open the collection folder in Bruno, or clone the repo and open the folder that contains `opencollection.yml`.

`opencollection.yml` is the collection root manifest. Importing that file by itself can open an empty shell because the actual requests live in the sibling YAML files under the same folder tree.

Bruno YAML/OpenCollection support starts in Bruno 3.0.0, but 3.1.0+ is the safer target for this workflow.

Use `environments/local.yml` for the starting variables and fill in your terminal credentials.

This collection targets the Hikvision terminal directly, not the app API.
