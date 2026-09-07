# Rollback

No external state exists for this local candidate. Delete or quarantine the
candidate build output to roll it back locally.

For any future release, publish immutable versions, retain the last verified
artifact digest, and deprecate/replace a bad version rather than assuming it can
be unpublished. A remote release must first document how its endpoint can be
disabled without revoking or exposing customer API keys.

