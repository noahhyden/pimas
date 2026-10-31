## Publishing is tokenless OIDC from a GitHub Release

`publish.yml` mints a short-lived npm credential from its `id-token` permission, so never add `NODE_AUTH_TOKEN` — a stray empty token env shadows OIDC and the publish fails. The trusted publisher is pinned to this repo and the `publish.yml` filename.
