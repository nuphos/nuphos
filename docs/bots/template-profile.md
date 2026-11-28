# Bot template bundle profile

The backend accepts a template profile through the existing authenticated Bot bundle preview/apply routes. This is the import foundation for #3736, not a public catalog or a new creation UI.

Use `format: "nuphos-bot-bundle"`, bundle `version: 1`, and this source:

```json
{"application":"nuphos-template","templateId":"research-desk","version":"1.0.0"}
```

The source version and each skill's `version` use numeric `major.minor.patch`. Template IDs and provider references use lowercase, hyphen-separated keys. The profile accepts exactly one Bot, no chats, no memories, and no working-file declarations. Avatar assets and complete skill directories still use the existing archive admission and secret-scanning rules. Each template skill must declare its package version and include its directory, including `SKILL.md`, scripts, references and assets. Declaring a version does not prove a package is maintained or trusted.

The Bot may carry an optional `greeting`, 1–2000 characters of text it says first in its new private chat.

Optional top-level `requirements` describe dependencies only:

```json
[{"provider":"github","required":true,"reason":"Read repository issues"}]
```

No authenticated connection IDs, runtime/model bindings, or extra fields are accepted. Requirements are returned in the preview manifest and recorded in the Bot's `botTemplate` attribution for later guided setup. This stage does not resolve connection eligibility or claim the Bot is ready. Package provenance, catalog origin allowlisting, connection resolution, setup cards and public-page handoff are subsequent work. An uploaded source label is attribution, not verification that the bundle came from Nuphos.

Preview stages bytes and does not create a Bot. Apply persists template ID/version/requirements on the owned Bot and always creates template schedules disabled, even when both the apply selection and the source routine request activation. Existing authorization, destination checks and archive limits remain in force. Unsupported schedules are reported through the existing warnings. When the Bot has a `greeting`, apply posts it once, in the Bot's name, as the first message of the Bot's private chat. A retried apply does not post it again. That message's metadata lists the Triggers the apply created as `createdTriggers: [{ id, name }]`, so a client can name and link them.

Apply retries use the same batch's preallocated destination IDs. A deliberate new copy uses the existing `copyId` preview option; template ID/version are not a global uniqueness constraint. Grok Bot bundle behavior remains unchanged.
